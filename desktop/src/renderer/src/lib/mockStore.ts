import type { WidgetMock } from '@shared/widgets'

// A throwaway data store for previews: the same calls as mine's real one
// (list/get/put/patch/remove), seeded from a widget's sample data and kept in
// memory. Nothing here reaches the disk or the person's real collections.

type Doc = { id: string; [field: string]: unknown }

const copy = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

export function mockStore(seed: WidgetMock['data']) {
  const cols = new Map<string, Map<string, Doc>>()
  for (const [name, docs] of Object.entries(seed ?? {})) {
    const m = new Map<string, Doc>()
    for (const d of Array.isArray(docs) ? docs : []) {
      if (!d || typeof d !== 'object') continue
      const id = typeof d.id === 'string' && d.id ? d.id : crypto.randomUUID()
      m.set(id, { ...copy(d), id })
    }
    cols.set(name, m)
  }
  const col = (c: string) => {
    if (!cols.has(c)) cols.set(c, new Map())
    return cols.get(c)!
  }
  const plain = (v: unknown) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('A document is a JSON object.')
    return copy(v as Record<string, unknown>)
  }

  /** Run one call. `changed` is the collection a write touched, so watchers can be told. */
  return function call(op: string, args: unknown[]): { value: unknown; changed?: string } {
    const c = String(args[0])
    const docs = col(c)
    const now = Date.now()
    switch (op) {
      case 'list': {
        const where = args[1] as Record<string, unknown> | undefined
        const all = [...docs.values()].filter((d) => !where || Object.entries(where).every(([k, v]) => JSON.stringify(d[k]) === JSON.stringify(v)))
        return { value: copy(all) }
      }
      case 'get':
        return { value: copy(docs.get(String(args[1])) ?? null) }
      case 'put': {
        const d = plain(args[1])
        const id = typeof d.id === 'string' && d.id ? d.id : crypto.randomUUID()
        const doc = {
          ...d,
          id,
          createdAt: docs.get(id)?.createdAt ?? d.createdAt ?? now,
          updatedAt: now,
        }
        docs.set(id, doc)
        return { value: copy(doc), changed: c }
      }
      case 'patch': {
        const cur = docs.get(String(args[1]))
        if (!cur) throw new Error(`No document ${String(args[1])} in ${c}.`)
        const doc = { ...cur, ...plain(args[2]), id: cur.id, updatedAt: now }
        docs.set(cur.id, doc)
        return { value: copy(doc), changed: c }
      }
      case 'remove':
        return docs.delete(String(args[1])) ? { value: true, changed: c } : { value: false }
    }
    throw new Error(`mine.data.${op}() isn’t something mine can do.`)
  }
}
