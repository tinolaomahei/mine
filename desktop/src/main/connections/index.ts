import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import {
  CONNECTION_ID,
  STANDARD_COLLECTIONS,
  atPath,
  hostMatches,
  pickDocs,
  slug,
  stepsLeft,
  type Connection,
  type ConnectionsState,
  type Field,
  type ServiceDef,
  type ServiceInfo,
  type SourceDef,
  type SourceInfo,
  type Step,
  type Way,
  type WayInfo,
} from '@shared/connections'
import { approve, forget, hashOf, isApproved } from '../approvals'
import { COLLECTION, data } from '../data-store'
import { deleteSecrets, getSecret, setSecret } from '../secrets'
import { apiGet, fill } from './api'
import { McpClient, resultData, Unauthorized, type RemoteTool } from './mcp-client'
import { cancelSignIn, NeedsClient, refresh, signIn, type OAuthClient, type Tokens } from './oauth'

// The person's connections to the tools they use, and the sources that pull
// data from them into collections. See src/shared/connections.ts.
//
// Rules this file keeps:
// - Tokens and secret fields live in the keychain-encrypted secret store and
//   never go to the window or to an agent. Requests go only to a connection's
//   own hosts.
// - A source an agent defines doesn't run until the person approves it with a
//   click (the same signed approvals as commands and widgets).
// - An agent calling a tool that might change something asks the person first.

const userDir = () => app.getPath('userData')
const storeFile = () => join(userDir(), 'connections.json')
const servicesDir = () => join(__dirname, '../../resources/services')

type SavedSource = SourceDef & { by: 'agent' | 'person'; createdAt: number }
type Run = { lastRun?: number; lastError?: string; count?: number }
type Saved = { connections: Connection[]; sources: SavedSource[]; runs: Record<string, Run> }

let getWin: () => BrowserWindow | undefined = () => undefined
let store: Saved = { connections: [], sources: [], runs: {} }
let catalogue: ServiceDef[] = []
const clients = new Map<string, McpClient>()
const toolCache = new Map<string, RemoteTool[]>()
const timers = new Map<string, NodeJS.Timeout>()

// --- files --------------------------------------------------------------------------

function load() {
  try {
    const raw = JSON.parse(readFileSync(storeFile(), 'utf8'))
    store = { connections: raw.connections ?? [], sources: raw.sources ?? [], runs: raw.runs ?? {} }
  } catch {
    store = { connections: [], sources: [], runs: {} }
  }
  // a sign-in that was under way when mine closed isn't any more
  for (const c of store.connections) if (c.status === 'connecting') c.status = 'todo'
}

function save() {
  mkdirSync(userDir(), { recursive: true })
  const tmp = `${storeFile()}.tmp`
  writeFileSync(tmp, JSON.stringify(store, null, 1))
  renameSync(tmp, storeFile())
  broadcast()
}

function loadCatalogue() {
  try {
    catalogue = readdirSync(servicesDir())
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(servicesDir(), f), 'utf8')) as ServiceDef)
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    catalogue = []
  }
}

/**
 * Apps mine is registered as with services that need that (GitHub, Slack,
 * Google...). resources/oauth-clients.json ships with mine; a file of the same
 * name in userData adds to it. `cimd` is the https address of mine's client ID
 * metadata document, once it's hosted.
 */
function oauthConfig(): { cimd?: string; clients: Record<string, OAuthClient> } {
  const read = (f: string) => {
    try {
      return JSON.parse(readFileSync(f, 'utf8'))
    } catch {
      return {}
    }
  }
  const a = read(join(__dirname, '../../resources/oauth-clients.json'))
  const b = read(join(userDir(), 'oauth-clients.json'))
  return { cimd: b.cimd || a.cimd || undefined, clients: { ...(a.clients ?? {}), ...(b.clients ?? {}) } }
}

// --- state for the window and agents ----------------------------------------------

function wayInfo(w: Way, index: number, service: string): WayInfo {
  const label = w.label ?? (w.auth === 'oauth' ? 'Sign in' : 'Use an API token')
  if (w.auth === 'oauth') {
    const key = w.kind === 'mcp' ? w.client : w.oauth.client
    if (key && !oauthConfig().clients[key]?.id) return { index, kind: w.kind, auth: w.auth, label, ready: false, why: `mine isn’t registered with ${service} yet, so signing in isn’t open.` }
  }
  return { index, kind: w.kind, auth: w.auth, label, ready: true }
}

const serviceInfo = (s: ServiceDef): ServiceInfo => ({ ...s, ways: s.ways.map((w, i) => wayInfo(w, i, s.name)) })

const runOf = (id: string): Run => store.runs[id] ?? {}
const sourceHash = (s: SourceDef) => hashOf(JSON.stringify([s.connection, s.title, s.what, s.call, s.every, s.into, s.pick ?? null]))

function sourceInfo(s: SavedSource): SourceInfo {
  const tool = 'tool' in s.call ? toolCache.get(s.connection)?.find((t) => t.name === (s.call as { tool: string }).tool) : undefined
  return {
    ...s,
    approved: isApproved('source', s.id, sourceHash(s)),
    readOnly: 'tool' in s.call ? (tool ? tool.annotations?.readOnlyHint ?? null : null) : true,
    ...runOf(s.id),
  }
}

export function connectionsState(): ConnectionsState {
  return { services: catalogue.map(serviceInfo), connections: store.connections, sources: store.sources.map(sourceInfo) }
}

function broadcast() {
  const w = getWin()
  if (w && !w.isDestroyed()) w.webContents.send('connections:changed', connectionsState())
}

const find = (id: string) => {
  const c = store.connections.find((x) => x.id === id)
  if (!c) throw new Error('There’s no connection like that.')
  return c
}

const update = (c: Connection, patch: Partial<Connection>) => {
  Object.assign(c, patch)
  save()
}

// --- values, hosts and headers ------------------------------------------------------

const secretName = (id: string, key: string) => `conn:${id}:${key}`
const fieldsOf = (w: Way): Field[] => (w.auth === 'fields' ? w.fields : [])

/** Every field value, secrets included. Only for building requests here. */
function values(c: Connection) {
  const v: Record<string, string> = { ...c.fields }
  for (const f of fieldsOf(c.way)) if (f.secret) v[f.key] = getSecret(secretName(c.id, f.key)) ?? ''
  return v
}

/** The hosts this connection's details may go to. */
function hostsOf(c: Connection): string[] {
  if (c.way.kind === 'mcp') return [new URL(c.way.url).host]
  const v = values(c)
  return c.way.hosts
    .map((h) => {
      if (!h.includes('{{')) return h
      try {
        return new URL(fill(h, v)).host
      } catch {
        return ''
      }
    })
    .filter(Boolean)
}

const tokensOf = (c: Connection): Tokens | null => {
  const t = getSecret(secretName(c.id, 'oauth'))
  return t ? (JSON.parse(t) as Tokens) : null
}

async function headersFor(c: Connection, fresh = false): Promise<Record<string, string>> {
  if (c.way.auth === 'fields') {
    const v = values(c)
    return Object.fromEntries(Object.entries(c.way.headers).map(([k, t]) => [k, fill(t, v)]))
  }
  let t = tokensOf(c)
  if (!t) throw new Error(`${c.name} isn’t signed in yet.`)
  if (t.refresh && (fresh || (t.expires && t.expires - Date.now() < 60_000))) {
    t = await refresh(t)
    setSecret(secretName(c.id, 'oauth'), JSON.stringify(t))
  }
  return { Authorization: `Bearer ${t.access}` }
}

function mcpFor(c: Connection) {
  if (c.way.kind !== 'mcp') throw new Error(`${c.name} isn’t an MCP connection.`)
  let m = clients.get(c.id)
  if (!m) {
    m = new McpClient(c.way.url, () => headersFor(c))
    clients.set(c.id, m)
  }
  return m
}

type Call = SourceDef['call']

/** One request to a service, with a single retry after refreshing an expired sign-in. */
async function callService(c: Connection, call: Call): Promise<unknown> {
  const once = async (fresh: boolean): Promise<unknown> => {
    if (c.way.kind === 'mcp') {
      if (!('tool' in call)) throw new Error(`${c.name} is reached through its tools; name a tool.`)
      if (fresh) await headersFor(c, true)
      const r = await mcpFor(c).call(call.tool, call.args ?? {})
      const value = resultData(r)
      if (r?.isError) throw new Error(typeof value === 'string' ? value : JSON.stringify(value).slice(0, 400))
      return value
    }
    if (!('path' in call)) throw new Error(`${c.name} is reached through its web API; give a path.`)
    return apiGet({ base: fill(c.way.base, values(c)), hosts: hostsOf(c), headers: await headersFor(c, fresh), path: call.path, query: call.query, format: call.format })
  }
  try {
    return await once(false)
  } catch (err) {
    const unauthorized = err instanceof Unauthorized || (err as { unauthorized?: boolean }).unauthorized
    if (!unauthorized) throw err
    if (c.way.auth === 'oauth' && tokensOf(c)?.refresh) {
      try {
        return await once(true)
      } catch {
        /* fall through: signed out */
      }
    }
    update(c, { status: 'broken', error: c.way.auth === 'oauth' ? 'Signed out. Sign in again.' : (err as Error).message })
    throw err
  }
}

// --- making connections -------------------------------------------------------------

function stepsFor(way: Way, extra: Omit<Step, 'id'>[] = []): Step[] {
  const steps: Step[] = extra.map((s, i) => ({ ...s, id: `s${i + 1}` }))
  if (way.auth === 'oauth') steps.push({ id: 'signin', kind: 'signin', label: way.label ?? 'Sign in' })
  else {
    for (const f of way.fields) steps.push({ id: `f-${f.key}`, kind: 'field', field: f.key, label: f.label, detail: f.help })
    steps.push({ id: 'test', kind: 'test', label: 'Check it works' })
  }
  return steps
}

const uniqueId = (base: string) => {
  let id = slug(base)
  for (let n = 2; store.connections.some((c) => c.id === id); n++) id = `${slug(base)}-${n}`
  return id
}

/** Put one of mine's services on the person's checklist (or return it if it's there). */
export function addService(serviceId: string, by: 'agent' | 'person', opts: { why?: string; way?: number; fields?: Record<string, string> } = {}): Connection {
  const s = catalogue.find((x) => x.id === serviceId)
  if (!s) throw new Error(`mine doesn’t know ${serviceId}. Describe the connection instead.`)
  const existing = store.connections.find((c) => c.service === s.id)
  if (existing) {
    if (opts.why && !existing.why) update(existing, { why: opts.why })
    if (opts.way !== undefined && existing.status !== 'connected') useWay(existing.id, opts.way)
    return existing
  }
  const infos = s.ways.map((w, i) => wayInfo(w, i, s.name))
  const index = opts.way !== undefined && infos[opts.way] ? opts.way : (infos.find((w) => w.ready)?.index ?? 0)
  const way = s.ways[index]
  const c: Connection = {
    id: uniqueId(s.id),
    service: s.id,
    name: s.name,
    colour: s.colour,
    why: opts.why,
    way,
    wayIndex: index,
    steps: stepsFor(way, s.steps?.[index]),
    status: 'todo',
    fields: {},
    secrets: [],
    done: [],
    opens: s.opens,
    by,
    createdAt: Date.now(),
  }
  for (const [k, v] of Object.entries(opts.fields ?? {})) {
    const f = fieldsOf(way).find((x) => x.key === k)
    if (f && !f.secret) c.fields[k] = normalise(f, String(v))
  }
  store.connections.push(c)
  save()
  return c
}

/** Switch a connection to another of its service's ways (say, a token instead of signing in). */
export function useWay(id: string, index: number) {
  const c = find(id)
  const s = catalogue.find((x) => x.id === c.service)
  const way = s?.ways[index]
  if (!s || !way) throw new Error('There’s no other way to connect that.')
  forgetCredentials(c)
  update(c, { way, wayIndex: index, steps: stepsFor(way, s.steps?.[index]), status: 'todo', error: undefined, account: undefined, fields: {}, secrets: [], done: [] })
}

const https = (u: string) => {
  try {
    return new URL(u).protocol === 'https:'
  } catch {
    return false
  }
}

/** A connection an agent designed, for a service mine doesn't know. Checked before it's kept. */
export function addCustom(input: Record<string, any>): Connection {
  const name = String(input.name ?? '').trim().slice(0, 60)
  if (!name) throw new Error('Give the connection a name.')
  const w = input.way as Way | undefined
  if (!w || (w.kind !== 'mcp' && w.kind !== 'api')) throw new Error('way.kind must be "mcp" (a remote MCP server) or "api" (a web API read with GETs).')
  const fields = (w.auth === 'fields' ? w.fields : []) ?? []
  if (w.auth !== 'oauth' && w.auth !== 'fields') throw new Error('way.auth must be "oauth" or "fields".')
  for (const f of fields) if (!/^[a-z][a-zA-Z0-9_]{0,31}$/.test(String(f?.key)) || !f.label) throw new Error('Each field needs a key (letters and digits) and a label.')
  if (w.kind === 'mcp' && !https(w.url)) throw new Error('way.url must be the MCP server’s https address.')
  if (w.kind === 'api') {
    if (!w.base || !Array.isArray(w.hosts) || !w.hosts.length) throw new Error('An api way needs base and hosts (the only hosts the token may go to).')
    if (w.auth === 'oauth' && (!https(w.oauth?.authorize) || !https(w.oauth?.token))) throw new Error('oauth needs https authorize and token addresses.')
  }
  if (w.auth === 'fields' && typeof w.headers !== 'object') throw new Error('A fields way needs headers, e.g. { "Authorization": "Bearer {{token}}" }.')
  const steps = (Array.isArray(input.steps) ? input.steps : [])
    .filter((s: any) => ['link', 'confirm', 'note'].includes(s?.kind) && s.label)
    .map((s: any) => ({ kind: s.kind, label: String(s.label).slice(0, 200), ...(s.kind === 'link' && https(s.url) ? { url: String(s.url) } : {}), ...(s.detail ? { detail: String(s.detail).slice(0, 400) } : {}) }))
  const c: Connection = {
    id: uniqueId(name),
    name,
    why: input.why ? String(input.why).slice(0, 300) : undefined,
    way: w,
    steps: stepsFor(w, steps),
    status: 'todo',
    fields: {},
    secrets: [],
    done: [],
    opens: Array.isArray(input.opens) ? input.opens.map(String).slice(0, 10) : undefined,
    by: 'agent',
    createdAt: Date.now(),
  }
  store.connections.push(c)
  save()
  return c
}

function normalise(f: Field, value: string) {
  let v = value.trim()
  if (f.url && v) {
    if (!/^https?:\/\//i.test(v)) v = `https://${v}`
    const u = new URL(v)
    if (u.protocol !== 'https:') throw new Error('That address needs to start with https://.')
    v = (u.pathname === '/' && !u.search ? u.origin : u.toString()).replace(/\/$/, '')
  }
  return v
}

function forgetCredentials(c: Connection) {
  deleteSecrets(`conn:${c.id}:`)
  clients.delete(c.id)
  toolCache.delete(c.id)
}

export async function setField(id: string, key: string, value: string) {
  const c = find(id)
  const f = fieldsOf(c.way).find((x) => x.key === key)
  if (!f) throw new Error('That isn’t one of its fields.')
  const v = normalise(f, value)
  if (f.secret) {
    if (v) setSecret(secretName(c.id, key), v)
    else deleteSecrets(secretName(c.id, key))
    const secrets = c.secrets.filter((k) => k !== key).concat(v ? [key] : [])
    update(c, { secrets, status: c.status === 'connected' ? 'todo' : c.status, error: undefined })
  } else update(c, { fields: { ...c.fields, [key]: v }, status: c.status === 'connected' ? 'todo' : c.status, error: undefined })
  clients.delete(c.id)
  // everything's in: try it straight away
  if (fieldsOf(c.way).every((x) => c.fields[x.key] || c.secrets.includes(x.key))) void test(c.id).catch(() => {})
}

export function tick(id: string, step: string, done: boolean) {
  const c = find(id)
  update(c, { done: done ? [...new Set([...c.done, step])] : c.done.filter((s) => s !== step) })
}

/** Prove a connection works, and learn whose account it is. */
export async function test(id: string) {
  const c = find(id)
  try {
    let account: string | undefined
    if (c.way.kind === 'mcp') {
      const m = mcpFor(c)
      m.reset()
      const tools = await m.tools()
      toolCache.set(c.id, tools)
      account = m.serverName ? `${m.serverName} · ${tools.length} tools` : `${tools.length} tools`
    } else if (c.way.test) {
      const r = await callService(c, { path: c.way.test.path })
      const a = c.way.test.account ? atPath(r, c.way.test.account) : undefined
      account = a ? String(a) : Array.isArray(r) ? `${r.length} upcoming events` : undefined
    }
    update(c, { status: 'connected', account, error: undefined, connectedAt: c.connectedAt ?? Date.now() })
    schedule()
    for (const s of store.sources) if (s.connection === c.id && sourceInfo(s).approved) void runSource(s.id).catch(() => {})
    return { ok: true, account }
  } catch (err) {
    if (c.status !== 'broken') update(c, { status: c.secrets.length || tokensOf(c) ? 'broken' : 'todo', error: (err as Error).message })
    return { ok: false, error: (err as Error).message }
  }
}

export async function startSignIn(id: string) {
  const c = find(id)
  if (c.way.auth !== 'oauth') throw new Error(`${c.name} connects with a token, not by signing in.`)
  const cfg = oauthConfig()
  update(c, { status: 'connecting', error: undefined })
  try {
    const tokens =
      c.way.kind === 'mcp'
        ? await signIn({ kind: 'mcp', url: c.way.url, scopes: c.way.scopes, registered: c.way.client ? cfg.clients[c.way.client] : undefined, cimd: cfg.cimd })
        : await signIn({ kind: 'direct', ...c.way.oauth, registered: cfg.clients[c.way.oauth.client] ?? { id: '' } })
    setSecret(secretName(c.id, 'oauth'), JSON.stringify(tokens))
    clients.delete(c.id)
    return await test(c.id)
  } catch (err) {
    const msg = err instanceof NeedsClient ? `${(err as Error).message} Try another way below, if there is one.` : (err as Error).message
    update(c, { status: 'todo', error: msg })
    return { ok: false, error: msg }
  }
}

export function removeConnection(id: string) {
  const c = find(id)
  for (const s of store.sources.filter((x) => x.connection === c.id)) removeSource(s.id, false)
  forgetCredentials(c)
  store.connections = store.connections.filter((x) => x.id !== c.id)
  save()
  schedule()
}

// --- sources --------------------------------------------------------------------------

function checkSource(input: Record<string, any>): SourceDef {
  const c = find(String(input.connection ?? ''))
  const title = String(input.title ?? '').trim().slice(0, 80)
  if (!title) throw new Error('Give the source a title.')
  const into = String(input.into ?? '')
  if (!COLLECTION.test(into)) throw new Error(`"${into}" isn't a collection name. Use lowercase letters, digits, - and _.`)
  const call = input.call ?? {}
  if (c.way.kind === 'mcp' && typeof call.tool !== 'string') throw new Error(`${c.name} is an MCP connection: call needs { tool, args }.`)
  if (c.way.kind === 'api' && typeof call.path !== 'string') throw new Error(`${c.name} is a web API connection: call needs { path, query?, format? }.`)
  const pick = input.pick && typeof input.pick === 'object' ? input.pick : undefined
  if (pick?.fields && Object.values(pick.fields).some((v) => typeof v !== 'string')) throw new Error('pick.fields maps each field to a path or template string.')
  const every = Math.min(1440, Math.max(5, Math.round(Number(input.every) || 15)))
  const def: SourceDef = {
    id: input.id && CONNECTION_ID.test(String(input.id)) ? String(input.id) : '',
    connection: c.id,
    title,
    what: String(input.what ?? title).slice(0, 300),
    call: c.way.kind === 'mcp' ? { tool: String(call.tool), args: call.args ?? {} } : { path: String(call.path), query: call.query, format: call.format === 'ics' ? 'ics' : call.format === 'json' ? 'json' : undefined },
    every,
    into,
    pick,
  }
  if (!def.id) {
    let id = slug(`${c.id}-${title}`)
    for (let n = 2; store.sources.some((s) => s.id === id); n++) id = `${slug(`${c.id}-${title}`)}-${n}`
    def.id = id
  }
  return def
}

/** Keep a source. An agent's waits for the person's approval; the person's own is approved by their click. */
export function saveSource(input: Record<string, any>, by: 'agent' | 'person') {
  const def = checkSource(input)
  const saved: SavedSource = { ...def, by, createdAt: store.sources.find((s) => s.id === def.id)?.createdAt ?? Date.now() }
  store.sources = [...store.sources.filter((s) => s.id !== def.id), saved]
  if (by === 'person') approve('source', def.id, sourceHash(def))
  save()
  schedule()
  if (by === 'person') void runSource(def.id).catch(() => {})
  return sourceInfo(saved)
}

/** Only from the window's Approve button. */
export function approveSource(id: string) {
  const s = store.sources.find((x) => x.id === id)
  if (!s) throw new Error('There’s no source like that.')
  approve('source', s.id, sourceHash(s))
  save()
  schedule()
  void runSource(s.id).catch(() => {})
}

export function removeSource(id: string, persist = true) {
  const s = store.sources.find((x) => x.id === id)
  if (!s) return false
  try {
    data.sync(userDir(), s.into, s.id, [])
  } catch {
    /* the collection may be gone */
  }
  forget('source', s.id)
  store.sources = store.sources.filter((x) => x.id !== id)
  delete store.runs[id]
  clearInterval(timers.get(id))
  timers.delete(id)
  if (persist) save()
  return true
}

const running = new Set<string>()

export async function runSource(id: string) {
  const s = store.sources.find((x) => x.id === id)
  if (!s) throw new Error('There’s no source like that.')
  if (!sourceInfo(s).approved) throw new Error(`“${s.title}” needs your OK before it runs.`)
  const c = find(s.connection)
  if (c.status !== 'connected') throw new Error(`${c.name} isn’t connected yet.`)
  if (running.has(id)) return runOf(id)
  running.add(id)
  try {
    const answer = await callService(c, s.call)
    const docs = pickDocs(answer, s.pick, c.fields)
    if (s.into in STANDARD_COLLECTIONS) for (const d of docs) d.doc.service ??= c.name
    const count = data.sync(userDir(), s.into, s.id, docs)
    store.runs[id] = { lastRun: Date.now(), count }
  } catch (err) {
    store.runs[id] = { ...runOf(id), lastRun: Date.now(), lastError: (err as Error).message }
  } finally {
    running.delete(id)
    save()
  }
  return runOf(id)
}

export async function syncAll(connection?: string) {
  const list = store.sources.filter((s) => (!connection || s.connection === connection) && sourceInfo(s).approved)
  const ok = list.filter((s) => store.connections.find((c) => c.id === s.connection)?.status === 'connected')
  await Promise.all(ok.map((s) => runSource(s.id).catch(() => null)))
  return ok.length
}

/** Every approved source of a connected connection syncs on its own clock. */
function schedule() {
  for (const t of timers.values()) clearInterval(t)
  timers.clear()
  for (const s of store.sources) {
    const c = store.connections.find((x) => x.id === s.connection)
    if (c?.status !== 'connected' || !sourceInfo(s).approved) continue
    timers.set(s.id, setInterval(() => void runSource(s.id).catch(() => {}), s.every * 60_000))
  }
}

// --- for agents -------------------------------------------------------------------------

/** What an agent sees: no secrets, no tokens, just what's there and what's left to do. */
export function agentView() {
  const st = connectionsState()
  return {
    services: st.services.map((s) => ({ id: s.id, name: s.name, what: s.what, group: s.group, ways: s.ways.map((w) => ({ index: w.index, label: w.label, kind: w.kind, ready: w.ready, ...(w.why ? { why: w.why } : {}) })), readyMadeSources: Object.values(s.sources ?? {}).flat().map((x) => x.title) })),
    connections: st.connections.map((c) => ({
      id: c.id,
      name: c.name,
      service: c.service,
      status: c.status,
      account: c.account,
      error: c.error,
      reachedBy: c.way.kind === 'mcp' ? `MCP tools at ${c.way.url}` : `web API at ${c.way.base.includes('{{') ? '(the person’s address)' : c.way.base}`,
      stepsLeft: stepsLeft(c),
      fields: c.fields,
    })),
    sources: st.sources.map(({ id, connection, title, into, every, approved, lastRun, lastError, count }) => ({ id, connection, title, into, every, approved, lastRun, lastError, count })),
    standardCollections: STANDARD_COLLECTIONS,
  }
}

type Ask = (tool: string, input: unknown, run?: string, outside?: string) => Promise<{ allow: boolean; message?: string }>

async function agentCall(req: Record<string, any>, ask: Ask) {
  const c = find(String(req.connection ?? ''))
  if (c.status !== 'connected') throw new Error(`${c.name} isn’t connected yet. The person has ${stepsLeft(c)} step(s) left on its checklist.`)
  if (c.way.kind === 'mcp') {
    const tool = String(req.tool ?? '')
    if (!toolCache.has(c.id)) toolCache.set(c.id, await mcpFor(c).tools())
    const t = toolCache.get(c.id)!.find((x) => x.name === tool)
    if (!t) throw new Error(`${c.name} has no tool called ${tool}. See connection_tools.`)
    // anything that might change something in their account is the person's call
    if (t.annotations?.readOnlyHint !== true) {
      const r = await ask(`${c.name}: ${tool}`, req.args ?? {}, req.run ? String(req.run) : undefined, c.name)
      if (!r.allow) throw new Error(r.message ?? 'The person said no.')
    }
    return callService(c, { tool, args: req.args ?? {} })
  }
  return callService(c, { path: String(req.path ?? ''), query: req.query, format: req.format })
}

async function agentTools(req: Record<string, any>) {
  const c = find(String(req.connection ?? ''))
  if (c.status !== 'connected') throw new Error(`${c.name} isn’t connected yet.`)
  if (c.way.kind === 'mcp') {
    const tools = await mcpFor(c).tools()
    toolCache.set(c.id, tools)
    broadcast()
    return tools.map((t) => ({ name: t.name, description: t.description?.slice(0, 600), readOnly: t.annotations?.readOnlyHint ?? null, inputSchema: t.inputSchema }))
  }
  const s = catalogue.find((x) => x.id === c.service)
  const index = c.wayIndex ?? -1
  return {
    kind: 'web API (GET only)',
    base: c.way.base.includes('{{') ? fill(c.way.base, c.fields) : c.way.base,
    hosts: hostsOf(c),
    readyMadeSources: index >= 0 ? s?.sources?.[index] ?? [] : [],
  }
}

// --- wiring -------------------------------------------------------------------------------

/** Widgets may open links, but only to the person's own services. */
export function openLink(url: string) {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false
  const ok = store.connections.some((c) => [...(c.opens ?? []), ...hostsOf(c)].some((h) => hostMatches(u.host, h)))
  if (ok) void shell.openExternal(u.toString())
  return ok
}

export function wireConnections(win: () => BrowserWindow | undefined) {
  getWin = win
  loadCatalogue()
  load()
  schedule()
  // catch up after a while closed, without slowing the start
  setTimeout(() => {
    for (const s of store.sources) {
      const due = (runOf(s.id).lastRun ?? 0) + s.every * 60_000 < Date.now()
      if (due && sourceInfo(s).approved && store.connections.find((c) => c.id === s.connection)?.status === 'connected') void runSource(s.id).catch(() => {})
    }
  }, 8000)

  const h = (name: string, fn: (...a: any[]) => unknown) =>
    ipcMain.handle(`connections:${name}`, async (_e, ...args) => {
      try {
        return { ok: true, value: await fn(...args) }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    })
  ipcMain.handle('connections:list', () => connectionsState())
  h('add', (service: string, way?: number) => addService(String(service), 'person', { way: typeof way === 'number' ? way : undefined }).id)
  h('use-way', (id: string, index: number) => useWay(String(id), Number(index)))
  h('remove', (id: string) => removeConnection(String(id)))
  h('set-field', (id: string, key: string, value: string) => setField(String(id), String(key), String(value ?? '')))
  h('tick', (id: string, step: string, done: boolean) => tick(String(id), String(step), !!done))
  h('sign-in', (id: string) => startSignIn(String(id)))
  h('cancel-sign-in', () => cancelSignIn())
  h('test', (id: string) => test(String(id)))
  // the person adding one of mine's ready-made sources: their click is the approval
  h('add-source', (connection: string, title: string) => {
    const c = find(String(connection))
    const s = catalogue.find((x) => x.id === c.service)
    const index = c.wayIndex ?? -1
    const def = (index >= 0 ? s?.sources?.[index] ?? [] : []).find((x) => x.title === title)
    if (!def) throw new Error('There’s no ready-made source like that.')
    return saveSource({ ...def, connection: c.id }, 'person').id
  })
  // only ever from the Approve button
  h('approve-source', (id: string) => approveSource(String(id)))
  h('remove-source', (id: string) => removeSource(String(id)))
  h('sync', (connection?: string) => syncAll(connection ? String(connection) : undefined))
  ipcMain.handle('connections:open', (_e, url: string) => openLink(String(url)))
}

/** What mine's MCP server (run by the agent) can ask for, over the pipe. */
export function connectionsPipe(ask: Ask) {
  return {
    connections: () => agentView(),
    suggestConnection: (req: Record<string, any>) => {
      const c = req.service ? addService(String(req.service), 'agent', { why: req.why, way: typeof req.way === 'number' ? req.way : undefined, fields: req.fields }) : addCustom(req)
      return { id: c.id, name: c.name, status: c.status, steps: c.steps.map((s) => s.label), stepsLeft: stepsLeft(c) }
    },
    connectionTools: (req: Record<string, any>) => agentTools(req),
    connectionCall: async (req: Record<string, any>) => {
      const v = await agentCall(req, ask)
      const text = typeof v === 'string' ? v : JSON.stringify(v)
      return text.length > 20_000 ? `${text.slice(0, 20_000)}\n… (cut at 20,000 characters; ask for less)` : text
    },
    saveSource: (req: Record<string, any>) => saveSource(req, 'agent'),
    removeSource: (req: Record<string, any>) => removeSource(String(req.id ?? '')),
    syncSource: (req: Record<string, any>) => runSource(String(req.id ?? '')),
  }
}
