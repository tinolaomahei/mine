import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { app, ipcMain, type BrowserWindow } from 'electron'
import type { PermissionAsk, PermissionChoice, PermissionRule } from '@shared/permissions'
import { ALL, describeRule, ruleFor } from '@shared/permissions'

// When an agent wants to do something it needs the person's OK for (run
// `git fetch`, edit a file, fetch a page), Claude Code asks mine's MCP server,
// which asks here over the local pipe. The window shows the request and only
// the person's click answers it. "Always" remembers a narrow rule for that
// folder, so the same kind of thing goes through on its own next time.

const file = () => join(app.getPath('userData'), 'permissions.json')
const key = (folder: string) => resolve(folder).toLowerCase()

let getWin: () => BrowserWindow | undefined = () => undefined
const pending = new Map<string, { ask: PermissionAsk; answer: (r: { allow: boolean; message?: string }) => void }>()

function loadRules(): PermissionRule[] {
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8'))
    return Array.isArray(raw.rules) ? raw.rules.filter((r: PermissionRule) => r && typeof r.tool === 'string' && typeof r.folder === 'string') : []
  } catch {
    return []
  }
}

function saveRules(rules: PermissionRule[]) {
  const f = file()
  mkdirSync(dirname(f), { recursive: true })
  const tmp = `${f}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify({ rules }, null, 1))
  renameSync(tmp, f)
  send('permissions:rules', rules)
}

const send = (channel: string, value: unknown) => {
  const w = getWin()
  if (w && !w.isDestroyed()) w.webContents.send(channel, value)
}

/** Does a remembered rule already cover this? */
function covered(tool: string, input: unknown, folder: string, outside?: string) {
  const rules = loadRules()
  if (!outside && rules.some((r) => r.tool === ALL && key(r.folder) === key(folder))) return true
  const want = ruleFor(tool, input, folder)
  if (!want) return false
  return rules.some(
    (r) => key(r.folder) === key(folder) && r.tool === want.tool && (r.prefix ?? null) === (want.prefix ?? null) && (r.domain ?? null) === (want.domain ?? null),
  )
}

/**
 * Ask the person. Resolves when they click, or denies when the run ends first.
 * Anything a remembered rule covers goes straight through.
 */
export function askPermission(req: { tool: string; input: unknown; runId?: string; folder: string; agent: string; outside?: string }) {
  if (covered(req.tool, req.input, req.folder, req.outside)) return Promise.resolve({ allow: true })
  const rule = ruleFor(req.tool, req.input, req.folder)
  const ask: PermissionAsk = {
    id: randomUUID(),
    runId: req.runId ?? null,
    agent: req.agent,
    tool: req.tool,
    input: req.input,
    folder: req.folder,
    always: rule ? describeRule(rule) : null,
    ...(req.outside ? { outside: req.outside } : {}),
    at: Date.now(),
  }
  return new Promise<{ allow: boolean; message?: string }>((answer) => {
    pending.set(ask.id, { ask, answer })
    send('permissions:ask', ask)
    // it's waiting on the person: get their attention if they're elsewhere
    const w = getWin()
    if (w && !w.isDestroyed() && !w.isFocused()) w.flashFrame(true)
  })
}

/** A run ended (finished, failed or stopped): anything it was still asking is moot. */
export function dropPermissions(runId: string) {
  for (const [id, p] of pending)
    if (p.ask.runId === runId) {
      pending.delete(id)
      p.answer({ allow: false, message: 'The run ended before the person answered.' })
      send('permissions:drop', id)
    }
}

export function wirePermissions(win: () => BrowserWindow | undefined) {
  getWin = win
  ipcMain.handle('permissions:list', () => [...pending.values()].map((p) => p.ask))
  // only ever from the window: the person clicking Allow, Always or Deny
  ipcMain.handle('permissions:answer', (_e, id: string, choice: PermissionChoice) => {
    const p = pending.get(String(id))
    if (!p) return false
    pending.delete(p.ask.id)
    if (choice === 'always') {
      const rule = ruleFor(p.ask.tool, p.ask.input, p.ask.folder)
      if (rule && !covered(p.ask.tool, p.ask.input, p.ask.folder, p.ask.outside)) saveRules([...loadRules(), rule])
    }
    // "all" is about the folder; for something in another account it's just this once
    if (choice === 'all' && !p.ask.outside) {
      const folder = p.ask.folder
      if (!loadRules().some((r) => r.tool === ALL && key(r.folder) === key(folder))) saveRules([...loadRules(), { folder, tool: ALL }])
      // everything else already waiting in that folder goes through too
      for (const [other, q] of pending)
        if (other !== p.ask.id && !q.ask.outside && key(q.ask.folder) === key(folder)) {
          pending.delete(other)
          q.answer({ allow: true })
          send('permissions:drop', other)
        }
    }
    const allow = choice !== 'deny'
    p.answer(allow ? { allow } : { allow, message: 'The person said no. Ask them what they’d like instead, or find another way.' })
    send('permissions:drop', p.ask.id)
    win()?.flashFrame(false)
    return true
  })
  ipcMain.handle('permissions:rules', () => loadRules())
  // turning "allow all" off is always safe, so a command can do it too
  ipcMain.handle('permissions:stop-all', (_e, folder: string) => {
    const keep = loadRules().filter((r) => !(r.tool === ALL && key(r.folder) === key(String(folder))))
    saveRules(keep)
    return keep
  })
  ipcMain.handle('permissions:forget', (_e, folder?: string) => {
    const keep = folder ? loadRules().filter((r) => key(r.folder) !== key(folder)) : []
    saveRules(keep)
    return keep
  })
}
