// Connections: the tools a person uses every day (Jira, Linear, their calendar),
// joined to mine so their data can fill widgets.
//
// A connection is a checklist the person works through (sign in, or paste a
// token, or tick off a step) and, once connected, a way for mine to reach the
// service. Sources then pull data from it on a schedule into a collection, and
// widgets show that collection. Widgets stay offline; only mine's main process
// talks to the service, and only it ever holds a token.
//
// mine's catalogue of services lives in resources/services. An agent can also
// design a connection for anything else, as long as it says where data comes
// from and what the person has to do.

export const CONNECTION_ID = /^[a-z0-9][a-z0-9-]{0,47}$/

/** A value the person types in: a site address, an email, a token. */
export type Field = {
  key: string
  label: string
  placeholder?: string
  /** Tokens and secret addresses: kept encrypted, never shown again, never sent to an agent. */
  secret?: boolean
  /** An address: "yourteam.atlassian.net" is kept as "https://yourteam.atlassian.net". */
  url?: boolean
  help?: string
}

/**
 * How mine reaches a service, in the order it prefers them.
 * - mcp: the service's own remote MCP server.
 * - api: its web API, read with plain GET requests.
 * oauth means signing in through the browser; fields means the person pastes
 * what's needed (an API token, a secret calendar address).
 * Header values and the base address can use {{key}} for a field's value and
 * {{base64:a:b}} for "a:b" in base64 (Basic auth).
 */
export type Way =
  | { kind: 'mcp'; url: string; auth: 'oauth'; scopes?: string[]; client?: string; label?: string }
  | { kind: 'mcp'; url: string; auth: 'fields'; fields: Field[]; headers: Record<string, string>; label?: string }
  | {
      kind: 'api'
      base: string
      /** The only hosts a token is ever sent to. {{key}} takes the host from a field. */
      hosts: string[]
      auth: 'fields'
      fields: Field[]
      headers: Record<string, string>
      /** A GET that proves it works, and the field of the answer that names the account. */
      test?: { path: string; account?: string }
      label?: string
    }
  | {
      kind: 'api'
      base: string
      hosts: string[]
      auth: 'oauth'
      oauth: { authorize: string; token: string; scopes: string[]; client: string; extra?: Record<string, string> }
      test?: { path: string; account?: string }
      label?: string
    }
  | { kind: 'local'; auth: 'none'; label?: string }

export type CommandFormat = 'json' | 'jsonl' | 'lines'
export type CommandCall = { command: string; args: string[]; cwd?: string; format?: CommandFormat }
export type ToolCall = { tool: string; args?: Record<string, unknown> }
export type ApiCall = { path: string; query?: Record<string, string>; format?: 'json' | 'ics' }

const quoteArg = (a: string) => (a && !/[\s"'`$&|<>;(){}^%!]/.test(a) ? a : `"${a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`)

export const commandLine = (c: { command: string; args: string[] }) => [c.command, ...c.args].map(quoteArg).join(' ')

export const isCommandCall = (c: SourceDef['call']): c is CommandCall => 'command' in c
export const isToolCall = (c: SourceDef['call']): c is ToolCall => 'tool' in c

/** One thing the person does to connect. mine adds sign-in, fields and the test itself. */
export type Step = {
  id: string
  kind: 'link' | 'confirm' | 'note' | 'field' | 'signin' | 'test'
  label: string
  /** link: where to go (opens in the browser). */
  url?: string
  /** field: which field. */
  field?: string
  detail?: string
}

/** A service in mine's catalogue (resources/services/<id>.json). */
export type ServiceDef = {
  id: string
  name: string
  /** What people use it for, in a few words. */
  what: string
  group: 'Work' | 'Code' | 'Docs' | 'Calendar' | 'Messages' | 'Design' | 'Business' | 'Automation'
  colour: string
  /** Its logo, a file in resources/services/logos (see the NOTICE there). */
  logo?: string
  /** Hosts widgets may open links to (an issue, an event), e.g. ["*.atlassian.net"]. */
  opens?: string[]
  ways: Way[]
  /** Extra steps for a way, by its index, shown before mine's own. */
  steps?: Record<string, Omit<Step, 'id'>[]>
  /** Ready-made sources for a way, by its index. */
  sources?: Record<string, Omit<SourceDef, 'id' | 'connection'>[]>
}

/** Whether a way can be used now: sign-in needs mine registered with some services. */
export type WayInfo = { index: number; kind: Way['kind']; auth: Way['auth']; label: string; ready: boolean; why?: string }
export type ServiceInfo = Omit<ServiceDef, 'ways'> & { ways: WayInfo[] }

export type ConnectionStatus = 'todo' | 'connecting' | 'connected' | 'broken'

export type Connection = {
  id: string
  /** The catalogue service, when it's one of mine's. */
  service?: string
  name: string
  colour?: string
  /** Why the agent suggested it, in the person's terms. */
  why?: string
  way: Way
  /** Which of the service's ways it uses. */
  wayIndex?: number
  steps: Step[]
  status: ConnectionStatus
  account?: string
  error?: string
  /** The non-secret field values (a site address, an email). */
  fields: Record<string, string>
  /** Which secret fields have a value. The values never leave the main process. */
  secrets: string[]
  /** Steps the person ticked off. */
  done: string[]
  opens?: string[]
  by: 'agent' | 'person'
  createdAt: number
  connectedAt?: number
}

/** How a source picks documents out of what the service sends back. */
export type Pick = {
  /** Path to the list, e.g. "issues" or "data.items". Without it, the answer itself (or [answer]). */
  items?: string
  /** Path to each item's own id. */
  id?: string
  /**
   * Each document field, from a path into the item ("fields.status.name") or a
   * template ("{{@site}}/browse/{{key}}"), where {{path}} reads the item and
   * {{@key}} a connection field, or a fixed value after "=" ("=Jira").
   * Without fields, items are kept as they are.
   */
  fields?: Record<string, string>
}

/** Pulls data from a connection into a collection, every so often. The person approves each one. */
export type SourceDef = {
  id: string
  connection: string
  title: string
  /** What it fetches, in plain words, for the approval card. */
  what: string
  call: ToolCall | ApiCall | CommandCall
  /** Minutes between syncs (5 at least). */
  every: number
  into: string
  pick?: Pick
}

export type SourceInfo = SourceDef & {
  approved: boolean
  by: 'agent' | 'person'
  /** For MCP tools: whether the server says the tool only reads. null when it doesn't say. */
  readOnly?: boolean | null
  lastRun?: number
  lastError?: string
  count?: number
}

export type ConnectionsState = { services: ServiceInfo[]; connections: Connection[]; sources: SourceInfo[] }

/** The standard collections mine's own widgets show, so any service can fill them. */
export const STANDARD_COLLECTIONS = {
  work: 'Work items from any tool: title, key, status, statusGroup (todo|doing|done), project, due (ISO date), priority, url, service, changed (ISO).',
  agenda: 'Calendar events: title, start (ISO; a date when allDay), end, allDay, where, url, service.',
  messages: 'Things waiting for the person: sender, subject, preview, at (ISO), unread, channel, url, service.',
} as const

// --- reading answers -------------------------------------------------------------

/** Follow a dotted path ("fields.status.name", "items.0.id") into a value. */
export function atPath(v: unknown, path: string): unknown {
  if (!path) return v
  let cur: any = v
  for (const part of path.split('.')) {
    if (cur == null) return undefined
    cur = cur[part]
  }
  return cur
}

/** Fill {{path}} from the item and {{@key}} from the connection's fields. */
export function fillTemplate(t: string, item: unknown, fields: Record<string, string>) {
  return t.replace(/\{\{\s*(@?)([^}\s]+)\s*\}\}/g, (_m, at: string, p: string) => {
    const v = at ? fields[p] : atPath(item, p)
    return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  })
}

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v])

function listOf(answer: unknown, path?: string): unknown[] {
  if (!path) return asList(answer)
  const direct = atPath(answer, path)
  if (direct !== undefined || !Array.isArray(answer)) return asList(direct)
  return answer.flatMap((page) => asList(atPath(page, path)))
}

/** Turn a service's answer into documents for a collection. */
export function pickDocs(answer: unknown, pick: Pick | undefined, fields: Record<string, string>, max = 500): { id: string; doc: Record<string, unknown> }[] {
  const items = listOf(answer, pick?.items)
  return items.slice(0, max).map((item, i) => {
    const rawId = pick?.id ? atPath(item, pick.id) : (item as any)?.id ?? (item as any)?.key ?? (item as any)?.uid
    const id = String(rawId ?? i)
    if (!pick?.fields) return { id, doc: item && typeof item === 'object' && !Array.isArray(item) ? { ...(item as object) } : { value: item } }
    const doc: Record<string, unknown> = {}
    for (const [k, p] of Object.entries(pick.fields)) {
      const v = p.startsWith('=') ? p.slice(1) : p.includes('{{') ? fillTemplate(p, item, fields) : atPath(item, p)
      if (v !== undefined && v !== '') doc[k] = v
    }
    return { id, doc }
  })
}

/** A file- and id-safe slug. */
export const slug = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'item'

/** Does a host match a pattern like "*.atlassian.net"? */
export function hostMatches(host: string, pattern: string) {
  const h = host.toLowerCase()
  const p = pattern.toLowerCase()
  return p.startsWith('*.') ? h.endsWith(p.slice(1)) && h.length > p.length - 1 : h === p
}

/** How many of a connection's steps are still to do. */
export function stepsLeft(c: Connection) {
  return c.steps.filter((s) => !stepDone(c, s)).length
}

export function stepDone(c: Connection, s: Step) {
  if (s.kind === 'field') return !!s.field && (!!c.fields[s.field] || c.secrets.includes(s.field))
  if (s.kind === 'signin' || s.kind === 'test') return c.status === 'connected'
  if (s.kind === 'note') return true
  return c.done.includes(s.id)
}
