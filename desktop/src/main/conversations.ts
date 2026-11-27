import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, ipcMain } from 'electron'
import type { ConversationRecord, ConversationSummary } from '@shared/ipc'

// Saved conversations: one JSON file each in userData/conversations. The list
// is built once from disk and kept in memory after that.

const dir = () => join(app.getPath('userData'), 'conversations')
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fileOf = (id: string) => {
  if (!ID.test(id)) throw new Error('Not a conversation id')
  return join(dir(), `${id}.json`)
}

let index: Map<string, ConversationSummary> | undefined

const summarise = (r: ConversationRecord): ConversationSummary => ({
  id: r.id,
  title: r.title,
  harness: r.harness,
  workdir: r.workdir,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  messages: r.turns.filter((t) => (t as { kind?: string }).kind === 'user').length,
})

function read(file: string): ConversationRecord | null {
  try {
    const r = JSON.parse(readFileSync(file, 'utf8')) as ConversationRecord
    return ID.test(r.id) && Array.isArray(r.turns) ? r : null
  } catch {
    return null
  }
}

function load() {
  if (index) return index
  index = new Map()
  mkdirSync(dir(), { recursive: true })
  for (const name of readdirSync(dir())) {
    if (!name.endsWith('.json')) continue
    const r = read(join(dir(), name))
    if (r) index.set(r.id, summarise(r))
  }
  return index
}

function save(r: ConversationRecord) {
  if (!ID.test(r.id) || !Array.isArray(r.turns)) throw new Error('Not a conversation')
  const clean: ConversationRecord = {
    id: r.id,
    title: String(r.title ?? '').slice(0, 200),
    harness: r.harness ?? null,
    workdir: String(r.workdir ?? ''),
    createdAt: Number(r.createdAt) || Date.now(),
    updatedAt: Number(r.updatedAt) || Date.now(),
    sessions: r.sessions ?? {},
    turns: r.turns,
  }
  mkdirSync(dir(), { recursive: true })
  const file = fileOf(clean.id)
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(clean))
  renameSync(tmp, file)
  load().set(clean.id, summarise(clean))
}

export function wireConversations() {
  ipcMain.handle('conversations:list', () => [...load().values()].sort((a, b) => b.updatedAt - a.updatedAt))
  ipcMain.handle('conversations:get', (_e, id: string) => {
    const record = read(fileOf(id))
    return record ? { record, workdirExists: !!record.workdir && existsSync(record.workdir) } : null
  })
  ipcMain.handle('conversations:save', (_e, r: ConversationRecord) => save(r))
  ipcMain.handle('conversations:delete', (_e, id: string) => {
    rmSync(fileOf(id), { force: true })
    load().delete(id)
  })
}
