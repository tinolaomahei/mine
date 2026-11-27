// A small client for a service's remote MCP server (the streamable HTTP
// transport): initialise once, list its tools, call them. Answers come back as
// JSON or as a short event stream; both are read whole.

export type RemoteTool = {
  name: string
  title?: string
  description?: string
  inputSchema?: unknown
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string }
}

export class Unauthorized extends Error {}

const PROTOCOL = '2025-06-18'
const TIMEOUT = 45_000

export class McpClient {
  private session?: string
  private protocol = PROTOCOL
  private ready?: Promise<void>
  private next = 1
  serverName?: string

  constructor(
    private url: string,
    private headers: () => Promise<Record<string, string>>,
  ) {}

  private async post(body: object, expectReply: boolean): Promise<any> {
    const h: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': this.protocol,
      ...(await this.headers()),
    }
    if (this.session) h['mcp-session-id'] = this.session
    const r = await fetch(this.url, { method: 'POST', headers: h, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT) })
    if (r.status === 401 || r.status === 403) throw new Unauthorized(`${new URL(this.url).host} said no (${r.status}).`)
    if (r.status === 404 && this.session) {
      // the session ended on their side; start again
      this.session = undefined
      this.ready = undefined
      throw new Error('session-gone')
    }
    const sid = r.headers.get('mcp-session-id')
    if (sid) this.session = sid
    if (!expectReply) return null
    if (!r.ok) throw new Error(`${new URL(this.url).host} answered ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const type = r.headers.get('content-type') ?? ''
    const text = await r.text()
    const id = (body as { id?: number }).id
    let msg: any
    if (type.includes('text/event-stream')) {
      for (const block of text.split(/\r?\n\r?\n/)) {
        const data = block
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n')
        if (!data) continue
        try {
          const m = JSON.parse(data)
          if (m.id === id) msg = m
        } catch {
          /* not ours */
        }
      }
    } else msg = JSON.parse(text)
    if (!msg) throw new Error(`${new URL(this.url).host} didn’t answer.`)
    if (msg.error) throw new Error(msg.error.message ?? 'The service returned an error.')
    return msg.result
  }

  private init() {
    this.ready ??= (async () => {
      const r = await this.post(
        { jsonrpc: '2.0', id: this.next++, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'mine', version: '0.1.0' } } },
        true,
      )
      if (r?.protocolVersion) this.protocol = r.protocolVersion
      this.serverName = r?.serverInfo?.title ?? r?.serverInfo?.name
      await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, false)
    })().catch((err) => {
      this.ready = undefined
      throw err
    })
    return this.ready
  }

  async request(method: string, params?: object): Promise<any> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.init()
        return await this.post({ jsonrpc: '2.0', id: this.next++, method, ...(params ? { params } : {}) }, true)
      } catch (err) {
        if ((err as Error).message === 'session-gone' && attempt === 0) continue
        throw err
      }
    }
  }

  async tools(): Promise<RemoteTool[]> {
    const out: RemoteTool[] = []
    let cursor: string | undefined
    for (let page = 0; page < 10; page++) {
      const r = await this.request('tools/list', cursor ? { cursor } : undefined)
      out.push(...(r?.tools ?? []))
      cursor = r?.nextCursor
      if (!cursor) break
    }
    return out
  }

  async call(name: string, args: Record<string, unknown> = {}) {
    return this.request('tools/call', { name, arguments: args })
  }

  /** Forget the session, e.g. after signing in again. */
  reset() {
    this.session = undefined
    this.ready = undefined
  }
}

/** What a tool call's result means as data: its structured content, else its text read as JSON. */
export function resultData(r: any): unknown {
  if (r?.structuredContent !== undefined) return r.structuredContent
  const texts = (r?.content ?? []).filter((c: any) => c?.type === 'text').map((c: any) => String(c.text))
  const parsed = texts.map((t: string) => {
    try {
      return JSON.parse(t)
    } catch {
      return t
    }
  })
  return parsed.length === 1 ? parsed[0] : parsed
}
