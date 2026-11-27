import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// mine's local data store: named collections of JSON documents, one file per
// collection in userData/data. Commands, widgets and agents all share it. The
// app watches the folder, so whoever writes, widgets showing that collection
// update.

export const COLLECTION = /^[a-z0-9][a-z0-9_-]{0,47}$/
export type Doc = { id: string; [field: string]: unknown }

const MAX_BYTES = 8 * 1024 * 1024

export const dataDir = (userDir: string) => join(userDir, 'data')

function fileOf(userDir: string, collection: string) {
  if (!COLLECTION.test(collection)) throw new Error(`"${collection}" isn't a collection name. Use lowercase letters, digits, - and _.`)
  return join(dataDir(userDir), `${collection}.json`)
}

function read(userDir: string, collection: string): Record<string, Doc> {
  try {
    const raw = JSON.parse(readFileSync(fileOf(userDir, collection), 'utf8'))
    return raw && typeof raw.docs === 'object' ? raw.docs : {}
  } catch (err) {
    if ((err as Error).message.includes("isn't a collection")) throw err
    return {}
  }
}

function write(userDir: string, collection: string, docs: Record<string, Doc>) {
  const file = fileOf(userDir, collection)
  const text = JSON.stringify({ docs }, null, 1)
  if (text.length > MAX_BYTES) throw new Error(`The ${collection} collection would be over 8 MB.`)
  mkdirSync(dataDir(userDir), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, file)
}

function plain(doc: unknown): Record<string, unknown> {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('A document is a JSON object.')
  return JSON.parse(JSON.stringify(doc))
}

const matches = (doc: Doc, where?: Record<string, unknown>) =>
  !where || Object.entries(where).every(([k, v]) => JSON.stringify(doc[k]) === JSON.stringify(v))

export const data = {
  collections(userDir: string) {
    try {
      return readdirSync(dataDir(userDir))
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          const name = f.slice(0, -5)
          return { name, count: Object.keys(read(userDir, name)).length }
        })
    } catch {
      return []
    }
  },
  list(userDir: string, collection: string, where?: Record<string, unknown>): Doc[] {
    return Object.values(read(userDir, collection)).filter((d) => matches(d, where))
  },
  get(userDir: string, collection: string, id: string): Doc | null {
    return read(userDir, collection)[String(id)] ?? null
  },
  /** Add or replace a document. Without an id, one is made. */
  put(userDir: string, collection: string, doc: unknown): Doc {
    const d = plain(doc)
    const id = typeof d.id === 'string' && d.id ? d.id : randomUUID()
    const docs = read(userDir, collection)
    const now = Date.now()
    docs[id] = { ...d, id, createdAt: (docs[id]?.createdAt as number) ?? (d.createdAt as number) ?? now, updatedAt: now }
    write(userDir, collection, docs)
    return docs[id]
  },
  /** Change some fields of an existing document. */
  patch(userDir: string, collection: string, id: string, fields: unknown): Doc {
    const docs = read(userDir, collection)
    const cur = docs[String(id)]
    if (!cur) throw new Error(`No document ${id} in ${collection}.`)
    const f = plain(fields)
    // on a synced document, remember which fields were changed here so a sync keeps them
    const local = cur.source ? { _local: [...new Set([...((cur._local as string[]) ?? []), ...Object.keys(f)])] } : {}
    docs[cur.id] = { ...cur, ...f, ...local, id: cur.id, updatedAt: Date.now() }
    write(userDir, collection, docs)
    return docs[cur.id]
  },
  remove(userDir: string, collection: string, id: string): boolean {
    const docs = read(userDir, collection)
    if (!docs[String(id)]) return false
    delete docs[String(id)]
    write(userDir, collection, docs)
    return true
  },
  /** Replace every document one source put in a collection with a fresh set, in one write. */
  sync(userDir: string, collection: string, source: string, fresh: { id: string; doc: Record<string, unknown> }[]) {
    const docs = read(userDir, collection)
    const now = Date.now()
    const old = new Set(Object.values(docs).filter((d) => d.source === source).map((d) => d.id))
    for (const { id, doc } of fresh) {
      const full = `${source}.${id}`.slice(0, 120)
      old.delete(full)
      const prev = docs[full]
      // what the person changed here (marking a message read) wins over what's synced
      const local = Array.isArray(prev?._local) ? (prev._local as string[]) : []
      const kept = Object.fromEntries(local.filter((k) => prev && k in prev).map((k) => [k, prev![k]]))
      docs[full] = {
        ...plain(doc),
        ...kept,
        ...(local.length ? { _local: local } : {}),
        id: full,
        source,
        createdAt: (prev?.createdAt as number) ?? now,
        updatedAt: now,
      }
    }
    for (const id of old) delete docs[id]
    write(userDir, collection, docs)
    return fresh.length
  },
  drop(userDir: string, collection: string) {
    rmSync(fileOf(userDir, collection), { force: true })
  },
}

/** Every data method by name, for callers that dispatch on a string. */
export function dataCall(userDir: string, method: string, args: unknown[]): unknown {
  const [c, a, b] = args as [string, unknown, unknown]
  switch (method) {
    case 'collections':
      return data.collections(userDir)
    case 'list':
      return data.list(userDir, c, a as Record<string, unknown> | undefined)
    case 'get':
      return data.get(userDir, c, String(a))
    case 'put':
      return data.put(userDir, c, a)
    case 'patch':
      return data.patch(userDir, c, String(a), b)
    case 'remove':
      return data.remove(userDir, c, String(a))
  }
  throw new Error(`mine.data.${method}() isn't something mine can do.`)
}
