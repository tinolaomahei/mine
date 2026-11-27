import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { shell } from 'electron'
import { getSecret, setSecret } from '../secrets'

// Signing in to a service through the browser: OAuth 2.1 with PKCE and a
// loopback redirect (RFC 8252), the way a desktop app should.
//
// For a service's MCP server, mine finds everything itself (RFC 9728 protected
// resource metadata, then the authorisation server's metadata) and gets a
// client id without anyone registering mine by hand, in the order the MCP spec
// asks: a client registered ahead of time, else mine's client ID metadata
// document, else dynamic client registration. Some services still need mine
// registered with them first; those come from oauth-clients.json.
//
// Tokens never leave the main process.

export type OAuthClient = { id: string; secret?: string }
export type AuthMethod = 'none' | 'client_secret_post' | 'client_secret_basic'
export type Tokens = {
  access: string
  refresh?: string
  /** ms since epoch */
  expires?: number
  scope?: string
  tokenUrl: string
  client: OAuthClient
  method: AuthMethod
  resource?: string
}

type AsMeta = {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
  client_id_metadata_document_supported?: boolean
  code_challenge_methods_supported?: string[]
  token_endpoint_auth_methods_supported?: string[]
  scopes_supported?: string[]
  authorization_response_iss_parameter_supported?: boolean
}

export class NeedsClient extends Error {}

const TIMEOUT = 20_000
const PORT = 47823
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function getJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

/** The canonical resource id for an MCP server's address (RFC 8707). */
export function canonical(url: string) {
  const u = new URL(url)
  u.hash = ''
  return u.toString()
}

async function asMetadata(issuer: string): Promise<AsMeta | null> {
  const i = new URL(issuer)
  const path = i.pathname === '/' ? '' : i.pathname.replace(/\/$/, '')
  const tries = path
    ? [`${i.origin}/.well-known/oauth-authorization-server${path}`, `${i.origin}/.well-known/openid-configuration${path}`, `${i.origin}${path}/.well-known/openid-configuration`]
    : [`${i.origin}/.well-known/oauth-authorization-server`, `${i.origin}/.well-known/openid-configuration`]
  for (const t of tries) {
    const m = await getJson(t)
    if (m?.authorization_endpoint && m?.token_endpoint) return m as AsMeta
  }
  return null
}

export type Discovered = { as: AsMeta; resource: string; scopes?: string[] }

/** Find who signs people in to an MCP server, and what to ask for. */
export async function discoverMcp(url: string): Promise<Discovered> {
  let www = ''
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mine', version: '0.1.0' } } }),
      signal: AbortSignal.timeout(TIMEOUT),
    })
    www = r.headers.get('www-authenticate') ?? ''
  } catch (err) {
    throw new Error(`Couldn’t reach ${new URL(url).host}: ${(err as Error).message}`)
  }
  const u = new URL(url)
  const hinted = www.match(/resource_metadata="([^"]+)"/)?.[1]
  const challenged = www.match(/scope="([^"]+)"/)?.[1]
  const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '')
  let prm: any = null
  for (const t of hinted ? [hinted] : [`${u.origin}/.well-known/oauth-protected-resource${path}`, `${u.origin}/.well-known/oauth-protected-resource`]) {
    prm = await getJson(t)
    if (prm?.authorization_servers?.length) break
    prm = null
  }
  // older servers have no resource metadata: the server is its own authorisation server
  const issuer = prm?.authorization_servers?.[0] ?? u.origin
  const as = await asMetadata(issuer)
  if (!as) throw new Error(`${u.host} doesn’t say how to sign in.`)
  if (as.issuer && as.issuer.replace(/\/$/, '') !== issuer.replace(/\/$/, '')) throw new Error(`${u.host}’s sign-in details don’t match who it says signs people in.`)
  const scopes = challenged ? challenged.split(/\s+/) : prm?.scopes_supported?.length ? prm.scopes_supported : undefined
  return { as, resource: prm?.resource ?? canonical(url), scopes }
}

// --- the loopback redirect ---------------------------------------------------------

const PAGE = (title: string, body: string) => `<!doctype html><meta charset="utf-8"><title>mine</title>
<style>body{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#faf7f2;color:#2a1f2d}
main{max-width:26rem;padding:2rem;text-align:center}h1{font-size:1.5rem;margin:0 0 .5rem;letter-spacing:-.02em}p{margin:0;color:#6d5f70}
@media (prefers-color-scheme:dark){body{background:#1b161d;color:#f1ebf2}p{color:#b9aebb}}</style>
<main><h1>${title}</h1><p>${body}</p></main>`

type Loopback = { redirect: string; wait: (state: string) => Promise<{ code: string; iss?: string }>; close: () => void }

function listen(server: Server, port: number) {
  return new Promise<number>((ok, fail) => {
    server.once('error', fail)
    server.listen(port, '127.0.0.1', () => ok((server.address() as AddressInfo).port))
  })
}

/** A one-shot local server that catches the browser coming back. */
async function loopback(): Promise<Loopback> {
  type Back = { code?: string; iss?: string; state?: string; error?: string }
  let got: ((v: Back) => void) | undefined
  // a browser that's quick to come back can beat the wait below; keep what it brought
  const early: Back[] = []
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (u.pathname !== '/callback') {
      res.writeHead(404).end()
      return
    }
    const error = u.searchParams.get('error')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(error ? PAGE('That didn’t work.', 'You can close this tab and try again in mine.') : PAGE('You’re connected.', 'You can close this tab and go back to mine.'))
    const back: Back = { code: u.searchParams.get('code') ?? undefined, state: u.searchParams.get('state') ?? undefined, iss: u.searchParams.get('iss') ?? undefined, error: error ? u.searchParams.get('error_description') || error : undefined }
    if (got) got(back)
    else early.push(back)
  })
  // a fixed port when it's free, so registered redirect addresses match; any port otherwise
  const port = await listen(server, PORT).catch(() => listen(server, 0))
  return {
    redirect: `http://127.0.0.1:${port}/callback`,
    wait: (state) =>
      new Promise((ok, fail) => {
        const t = setTimeout(() => fail(new Error('Signing in took too long. Try again when you’re ready.')), 10 * 60_000)
        got = (v) => {
          if (v.state !== state) return // someone else's request; keep waiting
          clearTimeout(t)
          if (v.error || !v.code) fail(new Error(v.error ?? 'The sign-in didn’t come back with a code.'))
          else ok({ code: v.code, iss: v.iss })
        }
        for (const v of early.splice(0)) got(v)
      }),
    close: () => server.close(),
  }
}

// --- getting a client id -----------------------------------------------------------

async function cimdReachable(url: string) {
  const doc = await getJson(url)
  return !!doc && doc.client_id === url
}

/** A client id for this authorisation server: registered ahead, mine's metadata document, or registered now. */
async function clientFor(as: AsMeta, redirect: string, registered: OAuthClient | undefined, cimd: string | undefined): Promise<{ client: OAuthClient; method: AuthMethod }> {
  const methods = as.token_endpoint_auth_methods_supported ?? ['client_secret_basic']
  if (registered?.id) return { client: registered, method: registered.secret ? (methods.includes('client_secret_post') ? 'client_secret_post' : 'client_secret_basic') : 'none' }
  if (as.client_id_metadata_document_supported && cimd && (await cimdReachable(cimd))) return { client: { id: cimd }, method: 'none' }
  if (as.registration_endpoint) {
    const key = `oauth.dcr:${as.issuer}:${redirect}`
    const saved = getSecret(key)
    if (saved) return JSON.parse(saved)
    const method: AuthMethod = methods.includes('none') ? 'none' : methods.includes('client_secret_post') ? 'client_secret_post' : 'client_secret_basic'
    const r = await fetch(as.registration_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_name: 'mine',
        client_uri: 'https://mine.computer',
        redirect_uris: [redirect],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: method,
        application_type: 'native',
      }),
      signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!r.ok) throw new Error(`Couldn’t register mine with ${new URL(as.issuer).host} (${r.status}): ${(await r.text()).slice(0, 200)}`)
    const j = (await r.json()) as { client_id: string; client_secret?: string }
    const out = { client: { id: String(j.client_id), secret: j.client_secret ? String(j.client_secret) : undefined }, method: j.client_secret ? method : ('none' as AuthMethod) }
    setSecret(key, JSON.stringify(out))
    return out
  }
  throw new NeedsClient(`${new URL(as.issuer).host} only lets apps sign in once they’re registered with it, and mine isn’t yet.`)
}

// --- tokens ------------------------------------------------------------------------

async function tokenRequest(tokenUrl: string, client: OAuthClient, method: AuthMethod, params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams(params)
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }
  if (method === 'client_secret_basic' && client.secret) headers.authorization = 'Basic ' + Buffer.from(`${encodeURIComponent(client.id)}:${encodeURIComponent(client.secret)}`).toString('base64')
  else {
    body.set('client_id', client.id)
    if (method === 'client_secret_post' && client.secret) body.set('client_secret', client.secret)
  }
  const r = await fetch(tokenUrl, { method: 'POST', headers, body, signal: AbortSignal.timeout(TIMEOUT) })
  const text = await r.text()
  let j: any
  try {
    j = JSON.parse(text)
  } catch {
    j = Object.fromEntries(new URLSearchParams(text)) // GitHub answers in form encoding unless asked nicely
  }
  if (!r.ok || !j.access_token) throw new Error(`Sign-in failed: ${j.error_description || j.error || r.status}`)
  return j
}

const toTokens = (j: any, base: Omit<Tokens, 'access' | 'refresh' | 'expires' | 'scope'>, old?: Tokens): Tokens => ({
  ...base,
  access: String(j.access_token),
  refresh: j.refresh_token ? String(j.refresh_token) : old?.refresh,
  expires: j.expires_in ? Date.now() + Number(j.expires_in) * 1000 : undefined,
  scope: j.scope ? String(j.scope) : old?.scope,
})

export type SignInPlan =
  | { kind: 'mcp'; url: string; scopes?: string[]; registered?: OAuthClient; cimd?: string }
  | { kind: 'direct'; authorize: string; token: string; scopes: string[]; registered: OAuthClient; extra?: Record<string, string> }

let cancelCurrent: (() => void) | undefined
export const cancelSignIn = () => cancelCurrent?.()

/** Open the browser for the person to sign in, and come back with tokens. */
export async function signIn(plan: SignInPlan): Promise<Tokens> {
  cancelCurrent?.()
  const lb = await loopback()
  const cancelled = new Promise<never>((_, fail) => (cancelCurrent = () => fail(new Error('Signing in was cancelled.'))))
  try {
    let authorize: string, tokenUrl: string, scopes: string[] | undefined, resource: string | undefined, issuer: string | undefined, issRequired = false
    let client: OAuthClient, method: AuthMethod
    if (plan.kind === 'mcp') {
      const d = await discoverMcp(plan.url)
      if (d.as.code_challenge_methods_supported && !d.as.code_challenge_methods_supported.includes('S256')) throw new Error('That service doesn’t support a safe sign-in (PKCE), so mine won’t use it.')
      ;({ client, method } = await clientFor(d.as, lb.redirect, plan.registered, plan.cimd))
      authorize = d.as.authorization_endpoint
      tokenUrl = d.as.token_endpoint
      resource = d.resource
      issuer = d.as.issuer
      issRequired = !!d.as.authorization_response_iss_parameter_supported
      scopes = plan.scopes ?? d.scopes
      if (scopes && d.as.scopes_supported?.includes('offline_access') && !scopes.includes('offline_access')) scopes = [...scopes, 'offline_access']
    } else {
      if (!plan.registered.id) throw new NeedsClient('mine isn’t registered with this service yet.')
      client = plan.registered
      method = client.secret ? 'client_secret_post' : 'none'
      authorize = plan.authorize
      tokenUrl = plan.token
      scopes = plan.scopes
    }
    const verifier = b64url(randomBytes(32))
    const state = b64url(randomBytes(16))
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: client.id,
      redirect_uri: lb.redirect,
      state,
      code_challenge: b64url(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
      ...(scopes?.length ? { scope: scopes.join(' ') } : {}),
      ...(resource ? { resource } : {}),
      ...(plan.kind === 'direct' ? plan.extra : {}),
    })
    const at = new URL(authorize)
    for (const [k, v] of q) at.searchParams.set(k, v)
    await shell.openExternal(at.toString())
    const back = await Promise.race([lb.wait(state), cancelled])
    if (issuer && (back.iss ? back.iss !== issuer : issRequired)) throw new Error('The sign-in came back from somewhere unexpected, so mine ignored it.')
    const j = await tokenRequest(tokenUrl, client, method, {
      grant_type: 'authorization_code',
      code: back.code,
      redirect_uri: lb.redirect,
      code_verifier: verifier,
      ...(resource ? { resource } : {}),
    })
    return toTokens(j, { tokenUrl, client, method, resource })
  } finally {
    cancelCurrent = undefined
    lb.close()
  }
}

/** A fresh access token from the refresh token. */
export async function refresh(t: Tokens): Promise<Tokens> {
  if (!t.refresh) throw new Error('Signed out. Sign in again.')
  const j = await tokenRequest(t.tokenUrl, t.client, t.method, {
    grant_type: 'refresh_token',
    refresh_token: t.refresh,
    ...(t.resource ? { resource: t.resource } : {}),
  })
  return toTokens(j, { tokenUrl: t.tokenUrl, client: t.client, method: t.method, resource: t.resource }, t)
}
