import { hostMatches } from '@shared/connections'

// Reading a service's web API: plain GETs, with the person's token only ever
// sent to the hosts the connection names. Calendars come as ICS and are turned
// into events here.

const TIMEOUT = 30_000

/** Fill {{key}} and {{base64:a:b}} from the person's values. */
export function fill(t: string, values: Record<string, string>) {
  return t.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (_m, key: string) => {
    if (key.startsWith('base64:')) {
      const [a, b] = key.slice(7).split(':')
      return Buffer.from(`${values[a] ?? ''}:${values[b] ?? ''}`).toString('base64')
    }
    return values[key] ?? ''
  })
}

/** Times a query can ask for: {{$now}}, {{$today}}, {{$in:7d}}, {{$ago:1d}}. */
export function fillTime(t: string) {
  return t.replace(/\{\{\s*\$(now|today|in:(\d+)([hdw])|ago:(\d+)([hdw]))\s*\}\}/g, (_m, what: string, n1, u1, n2, u2) => {
    const unit = { h: 3600e3, d: 86400e3, w: 7 * 86400e3 } as Record<string, number>
    if (what === 'now') return new Date().toISOString()
    if (what === 'today') return new Date().toISOString().slice(0, 10)
    if (n1) return new Date(Date.now() + Number(n1) * unit[u1]).toISOString()
    return new Date(Date.now() - Number(n2) * unit[u2]).toISOString()
  })
}

export function allowedHost(url: URL, hosts: string[]) {
  return url.protocol === 'https:' && hosts.some((h) => hostMatches(url.host, h))
}

export async function apiGet(opts: {
  base: string
  hosts: string[]
  headers: Record<string, string>
  path: string
  query?: Record<string, string>
  format?: 'json' | 'ics'
}): Promise<unknown> {
  let url = new URL(/^https?:\/\//.test(opts.path) ? opts.path : opts.base.replace(/\/$/, '') + (opts.path && !opts.path.startsWith('/') ? '/' : '') + opts.path)
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, fillTime(String(v)))
  for (let hop = 0; hop < 4; hop++) {
    if (!allowedHost(url, opts.hosts)) throw new Error(`mine only sends this connection’s details to ${opts.hosts.join(', ')}, not ${url.host}.`)
    const r = await fetch(url, { headers: { accept: opts.format === 'ics' ? 'text/calendar' : 'application/json', ...opts.headers }, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT) })
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      url = new URL(r.headers.get('location')!, url)
      continue
    }
    const text = await r.text()
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error(`${url.host} said no (${r.status}). The token may be wrong or missing access.`), { unauthorized: true })
    if (!r.ok) throw new Error(`${url.host} answered ${r.status}: ${text.slice(0, 200)}`)
    if (opts.format === 'ics' || /^BEGIN:VCALENDAR/.test(text.trimStart())) return parseIcs(text)
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  throw new Error('Too many redirects.')
}

// --- ICS ---------------------------------------------------------------------------

type Ev = { title: string; start: string; end?: string; allDay: boolean; where?: string; url?: string; id: string }

/** Wall-clock time in a time zone to a real instant. Unknown zones are read as local time. */
function zoned(y: number, mo: number, d: number, h: number, mi: number, s: number, tz?: string) {
  if (!tz) return new Date(y, mo - 1, d, h, mi, s)
  try {
    const guess = Date.UTC(y, mo - 1, d, h, mi, s)
    const offset = (at: number) => {
      const p = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
          .formatToParts(new Date(at))
          .map((x) => [x.type, x.value]),
      )
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - at
    }
    const first = guess - offset(guess)
    return new Date(guess - offset(first))
  } catch {
    return new Date(y, mo - 1, d, h, mi, s)
  }
}

function icsDate(value: string, params: Record<string, string>): { at: Date; allDay: boolean } | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/)
  if (!m) return null
  const [, y, mo, d, h, mi, s, z] = m
  if (!h) return { at: new Date(+y, +mo - 1, +d), allDay: true }
  if (z) return { at: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), allDay: false }
  return { at: zoned(+y, +mo, +d, +h, +mi, +s, params.TZID), allDay: false }
}

const unescape = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/** Events from an ICS calendar, a day back to two weeks ahead, with simple repeats expanded. */
export function parseIcs(text: string, from = Date.now() - 86400e3, to = Date.now() + 14 * 86400e3): Ev[] {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  const events: Record<string, string | Record<string, string>>[][] = []
  let cur: { name: string; params: Record<string, string>; value: string }[] | null = null
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = []
    else if (line === 'END:VEVENT') {
      if (cur) events.push(cur as never)
      cur = null
    } else if (cur) {
      const i = line.indexOf(':')
      if (i < 0) continue
      const [name, ...ps] = line.slice(0, i).split(';')
      cur.push({ name: name.toUpperCase(), params: Object.fromEntries(ps.map((p) => p.split('=') as [string, string])), value: line.slice(i + 1) })
    }
  }
  const out: Ev[] = []
  const overrides = new Map<string, Ev | null>()
  for (const raw of events as unknown as { name: string; params: Record<string, string>; value: string }[][]) {
    const get = (n: string) => raw.find((p) => p.name === n)
    const all = (n: string) => raw.filter((p) => p.name === n)
    const ds = get('DTSTART')
    const start = ds && icsDate(ds.value, ds.params)
    if (!start) continue
    const de = get('DTEND')
    const end = de && icsDate(de.value, de.params)
    const dur = end ? end.at.getTime() - start.at.getTime() : start.allDay ? 86400e3 : 3600e3
    const uid = get('UID')?.value ?? `${start.at.getTime()}`
    const cancelled = get('STATUS')?.value === 'CANCELLED'
    const base = { title: unescape(get('SUMMARY')?.value ?? '(No title)'), allDay: start.allDay, where: get('LOCATION') ? unescape(get('LOCATION')!.value) : undefined, url: get('URL')?.value }
    const make = (at: Date): Ev => ({
      ...base,
      id: `${uid}@${at.getTime()}`,
      start: start.allDay ? ymd(at) : at.toISOString(),
      end: start.allDay ? ymd(new Date(at.getTime() + dur)) : new Date(at.getTime() + dur).toISOString(),
    })
    const rid = get('RECURRENCE-ID')
    if (rid) {
      const r = icsDate(rid.value, rid.params)
      if (r) overrides.set(`${uid}@${r.at.getTime()}`, cancelled ? null : make(start.at))
      continue
    }
    if (cancelled) continue
    const exdates = new Set(
      all('EXDATE').flatMap((p) =>
        p.value
          .split(',')
          .map((v) => icsDate(v, p.params)?.at.getTime())
          .filter((x): x is number => x != null),
      ),
    )
    const rule = get('RRULE')?.value
    if (!rule) {
      if (start.at.getTime() + dur >= from && start.at.getTime() <= to) out.push(make(start.at))
      continue
    }
    const r = Object.fromEntries(rule.split(';').map((p) => p.split('='))) as Record<string, string>
    const interval = Math.max(1, Number(r.INTERVAL ?? 1))
    const until = r.UNTIL ? icsDate(r.UNTIL, {})?.at.getTime() ?? Infinity : Infinity
    const count = r.COUNT ? Number(r.COUNT) : Infinity
    const byDay = r.BYDAY ? r.BYDAY.split(',').map((d) => DAYS.indexOf(d.slice(-2))) : null
    let n = 0
    const d = new Date(start.at)
    for (let i = 0; i < 3000 && d.getTime() <= to && d.getTime() <= until && n < count; i++) {
      const candidates: Date[] = []
      if (r.FREQ === 'WEEKLY' && byDay) {
        const weekStart = new Date(d)
        weekStart.setDate(d.getDate() - d.getDay())
        for (const wd of byDay.sort()) {
          const c = new Date(weekStart)
          c.setDate(weekStart.getDate() + wd)
          if (c.getTime() >= start.at.getTime()) candidates.push(c)
        }
      } else candidates.push(new Date(d))
      for (const c of candidates) {
        if (c.getTime() > until || n >= count) break
        n++
        const t = c.getTime()
        if (exdates.has(t) || t + dur < from || t > to) continue
        out.push(make(c))
      }
      if (r.FREQ === 'DAILY') d.setDate(d.getDate() + interval)
      else if (r.FREQ === 'WEEKLY') d.setDate(d.getDate() + 7 * interval)
      else if (r.FREQ === 'MONTHLY') d.setMonth(d.getMonth() + interval)
      else if (r.FREQ === 'YEARLY') d.setFullYear(d.getFullYear() + interval)
      else break
    }
  }
  const merged = out.filter((e) => !overrides.has(e.id)).concat([...overrides.values()].filter((e): e is Ev => !!e && Date.parse(e.start) <= to && Date.parse(e.end ?? e.start) >= from))
  return merged.sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
}
