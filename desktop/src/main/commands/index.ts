import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, clipboard, ipcMain, Notification, shell, utilityProcess, type BrowserWindow, type UtilityProcess } from 'electron'
import {
  COMMAND_NAME,
  type CommandEffect,
  type AppCommandInfo,
  type CommandInfo,
  type CommandResult,
  type CommandsState,
  type CommandView,
} from '@shared/commands'
import type { ThemePatch } from '@shared/theme'
import { approve, forget, hashOf, isApproved } from '../approvals'
import { dataCall } from '../data-store'
import { getSettings, reloadSettings, setSettings } from '../settings'
import { resetPatch, savePatch, setAppearance, setWorkdir, undoPatch } from '../theme-store'
import { themeState } from '../theme'
import { STARTERS } from './starters'

// The command registry: a folder of .js files, loaded and run by a utility
// process, re-read whenever the folder changes.

const userDir = () => app.getPath('userData')
export const commandsDir = () => join(userDir(), 'commands')

const RUN_MS = 15_000
const OPTIONS_MS = 800

let getWin: () => BrowserWindow | undefined = () => undefined
let worker: UtilityProcess | undefined
let nextId = 1
const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
let state: CommandsState = { dir: '', app: [], commands: [], errors: [], pending: [] }
let onWidgetShow: (name: string, props: unknown) => void = () => {}

const send = (channel: string, value: unknown) => {
  const w = getWin()
  if (w && !w.isDestroyed()) w.webContents.send(channel, value)
}

// --- the mine object commands get ---------------------------------------------

const cloneable = (v: unknown) => {
  if (v === undefined) return undefined
  try {
    return JSON.parse(JSON.stringify(v))
  } catch {
    return undefined
  }
}

async function hostCall(area: string, method: string, args: unknown[]): Promise<unknown> {
  const effect = (e: CommandEffect) => send('commands:effect', e)
  switch (area) {
    case 'window': {
      const win = getWin()
      if (!win) throw new Error('mine’s window isn’t open.')
      const fn = (win as unknown as Record<string, unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`The window has no ${method}().`)
      return cloneable(await (fn as (...a: unknown[]) => unknown).apply(win, args))
    }
    case 'workdir':
      if (method === 'get') return getSettings().workdir
      if (method === 'set') {
        const res = setWorkdir(userDir(), String(args[0] ?? ''))
        if (res.error) throw new Error(res.error)
        reloadSettings()
        return res.path
      }
      break
    case 'settings':
      if (method === 'get') return getSettings()
      if (method === 'set') return setSettings((args[0] ?? {}) as object)
      break
    case 'appearance': {
      const mode = args[0]
      if (mode !== 'light' && mode !== 'dark' && mode !== 'system') throw new Error('appearance is light, dark or system.')
      setAppearance(userDir(), mode)
      reloadSettings()
      return mode
    }
    case 'theme':
      if (method === 'get') return themeState().theme
      if (method === 'set') {
        const errors = savePatch(userDir(), (args[0] ?? {}) as ThemePatch, false)
        if (errors.length) throw new Error(errors.join('; '))
        return true
      }
      if (method === 'undo') return undoPatch(userDir())
      if (method === 'reset') return resetPatch(userDir())
      break
    case 'shell':
      if (method === 'openPath') return shell.openPath(String(args[0]))
      if (method === 'showItemInFolder') return shell.showItemInFolder(String(args[0]))
      if (method === 'openExternal') {
        const url = String(args[0])
        if (!/^(https?|mailto):/i.test(url)) throw new Error('openExternal takes http(s) or mailto links.')
        return shell.openExternal(url)
      }
      break
    case 'clipboard':
      if (method === 'readText') return clipboard.readText()
      if (method === 'writeText') return clipboard.writeText(String(args[0] ?? ''))
      break
    case 'notify':
      new Notification({ title: String(args[0] ?? 'mine'), body: args[1] == null ? '' : String(args[1]) }).show()
      return true
    case 'data':
      return dataCall(userDir(), method, args)
    case 'widget':
      if (method === 'show') return onWidgetShow(String(args[0] ?? ''), args[1] ?? {})
      break
    case 'conversation':
      if (method === 'new') return effect({ type: 'new-conversation' })
      break
    case 'agent':
      if (method === 'stop') return effect({ type: 'stop-agent' })
      if (method === 'send') return effect({ type: 'send-to-agent', text: String(args[0] ?? '') })
      break
  }
  throw new Error(`mine.${area}.${method}() isn’t something mine can do.`)
}

// --- the worker -----------------------------------------------------------------

function start() {
  const w = utilityProcess.fork(join(__dirname, 'commands.js'), [], { serviceName: 'mine commands' })
  w.on('message', async (m: any) => {
    if (m.type === 'reply') {
      const p = waiting.get(m.id)
      waiting.delete(m.id)
      if (m.ok) p?.resolve(m.value)
      else p?.reject(new Error(m.error))
    } else if (m.type === 'call') {
      try {
        w.postMessage({ type: 'answer', cid: m.cid, ok: true, value: await hostCall(m.area, m.method, m.args ?? []) })
      } catch (err) {
        w.postMessage({ type: 'answer', cid: m.cid, ok: false, error: (err as Error).message })
      }
    }
  })
  w.on('exit', () => {
    if (worker !== w) return
    worker = undefined
    for (const p of waiting.values()) p.reject(new Error('The commands process stopped.'))
    waiting.clear()
  })
  worker = w
  return w
}

function ask<T>(msg: Record<string, unknown>, timeoutMs: number): Promise<T> {
  const w = worker ?? start()
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id)
      reject(new Error(`It took longer than ${Math.round(timeoutMs / 1000)} seconds, so mine stopped it.`))
      // a command stuck in a loop would block every other one: start fresh
      if (msg.type !== 'load') {
        w.kill()
        void reload()
      }
    }, timeoutMs)
    waiting.set(id, {
      resolve: (v) => (clearTimeout(timer), resolve(v)),
      reject: (e) => (clearTimeout(timer), reject(e)),
    })
    w.postMessage({ ...msg, id })
  })
}

/** Every command file on disk, with whether its exact content is approved. */
function scan() {
  const files: { name: string; file: string; source: string; hash: string; approved: boolean }[] = []
  const errors: CommandsState['errors'] = []
  let names: string[] = []
  try {
    names = readdirSync(commandsDir()).filter((f) => f.endsWith('.js'))
  } catch {
    /* no folder yet */
  }
  for (const f of names) {
    const name = f.slice(0, -3)
    const file = join(commandsDir(), f)
    if (!COMMAND_NAME.test(name)) {
      errors.push({ file, message: 'Command file names must be lowercase-with-dashes.js' })
      continue
    }
    try {
      const source = readFileSync(file, 'utf8')
      const hash = hashOf(source)
      files.push({ name, file, source, hash, approved: isApproved('command', name, hash) })
    } catch (err) {
      errors.push({ file, message: (err as Error).message })
    }
  }
  return { files, errors }
}

let reloading: Promise<CommandsState> | undefined
export function reload() {
  // one at a time; a burst of file events settles into the last state
  const run = async () => {
    const { files, errors } = scan()
    const ok = files.filter((f) => f.approved)
    const res = await ask<Pick<CommandsState, 'commands' | 'errors'>>(
      { type: 'load', files: ok.map(({ name, file, source }) => ({ name, file, source })) },
      10_000,
    ).catch((err) => ({ commands: [] as CommandInfo[], errors: [{ file: commandsDir(), message: (err as Error).message }] }))
    state = {
      ...state,
      dir: commandsDir(),
      commands: res.commands,
      errors: [...errors, ...res.errors],
      pending: files.filter((f) => !f.approved).map(({ name, file, source }) => ({ name, file, source: source.slice(0, 20_000) })),
    }
    send('commands:changed', state)
    return state
  }
  reloading = (reloading ?? Promise.resolve(state)).then(run, run)
  return reloading
}

export function approveCommand(name: string) {
  const f = scan().files.find((x) => x.name === name)
  if (!f) throw new Error(`There's no command called ${name}.`)
  approve('command', name, f.hash)
  return reload()
}

export const commandsState = () => state

function runCtx(params: Record<string, string>, said: string) {
  const s = getSettings()
  return { params, said, workdir: s.workdir, appearance: s.theme, harness: s.harness, platform: process.platform, home: app.getPath('home') }
}

/** Work out a dynamic parameter's options right now. */
export async function commandOptions(name: string, param: string, said: string) {
  return ask<{ value: string; description: string }[]>({ type: 'options', name, param, ctx: runCtx({}, said) }, OPTIONS_MS)
}

function checkView(v: unknown): CommandView | undefined {
  const view = v as CommandView | undefined
  if (!view || typeof view !== 'object') return undefined
  return ['files', 'file', 'table', 'list', 'markdown', 'html', 'widget'].includes(view.type) ? (cloneable(view) as CommandView) : undefined
}

// --- mine's own features: registered and run by the window ----------------------

let nextInvoke = 1
const invoking = new Map<number, (r: CommandResult) => void>()

function invokeApp(name: string, params: Record<string, string>, said: string): Promise<CommandResult> {
  const w = getWin()
  if (!w || w.isDestroyed()) return Promise.resolve({ ok: false, error: 'mine’s window isn’t open.' })
  const id = nextInvoke++
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      invoking.delete(id)
      resolve({ ok: false, error: 'mine’s window didn’t respond.' })
    }, RUN_MS)
    invoking.set(id, (r) => (clearTimeout(timer), resolve(r)))
    w.webContents.send('commands:invoke', { id, name, params, said })
  })
}

/** Every command, mine's own first. */
export const allCommands = () => [...state.app, ...state.commands]

export async function runCommand(name: string, params: Record<string, string>, said = ''): Promise<CommandResult> {
  if (state.app.some((c) => c.name === name)) return invokeApp(name, params, said)
  const info = state.commands.find((c) => c.name === name)
  if (!info) return { ok: false, error: `There's no command called ${name}.` }
  const t0 = performance.now()
  try {
    const out = (await ask<Record<string, unknown>>({ type: 'run', name, ctx: runCtx(params, said) }, RUN_MS)) ?? {}
    return {
      ok: true,
      say: typeof out.say === 'string' ? out.say : undefined,
      view: checkView(out.view),
      undoState: cloneable(out.undoState),
      canUndo: info.canUndo && out.undoState !== undefined,
      ms: Math.round(performance.now() - t0),
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export async function undoCommand(name: string, undoState: unknown) {
  try {
    const out = (await ask<Record<string, unknown>>({ type: 'undo', name, state: undoState, ctx: runCtx({}, '') }, RUN_MS)) ?? {}
    return { ok: true as const, say: typeof out.say === 'string' ? out.say : undefined }
  } catch (err) {
    return { ok: false as const, error: (err as Error).message }
  }
}

export function removeCommand(name: string) {
  if (!COMMAND_NAME.test(name)) throw new Error('Not a command name.')
  rmSync(join(commandsDir(), `${name}.js`), { force: true })
  forget('command', name)
}

// --- a local pipe, so mine's MCP server (run by the agent) can reach the app --

export type Pipe = { path: string; token: string }
type PipeExtra = Record<string, (req: Record<string, unknown>) => unknown>

function servePipe(extra: PipeExtra): Pipe {
  const token = randomBytes(24).toString('hex')
  const id = randomBytes(6).toString('hex')
  const path = process.platform === 'win32' ? `\\\\.\\pipe\\mine-${id}` : join(tmpdir(), `mine-${id}.sock`)
  createServer((sock) => {
    let buf = ''
    sock.setEncoding('utf8')
    sock.on('data', async (chunk) => {
      buf += chunk
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      const reply = (v: unknown) => sock.end(JSON.stringify(v) + '\n')
      try {
        const req = JSON.parse(buf.slice(0, nl))
        if (req.token !== token) return reply({ error: 'Not allowed.' })
        if (req.method === 'list') return reply({ value: state })
        if (req.method === 'reload') return reply({ value: await reload() })
        if (req.method === 'run') return reply({ value: await runCommand(String(req.name), req.params ?? {}, String(req.said ?? '')) })
        if (extra[req.method]) return reply({ value: await extra[req.method](req) })
        return reply({ error: `Unknown method ${req.method}` })
      } catch (err) {
        reply({ error: (err as Error).message })
      }
    })
    sock.on('error', () => {})
  }).listen(path)
  return { path, token }
}

// --- wiring ---------------------------------------------------------------------

function seed() {
  const dir = commandsDir()
  mkdirSync(dir, { recursive: true })
  const marker = join(dir, '.starters')
  // each starter is written once; after that it's the person's to change or delete
  let written: string[] = []
  if (existsSync(marker)) {
    const text = readFileSync(marker, 'utf8')
    try {
      written = JSON.parse(text).written ?? []
    } catch {
      written = ['show-folder', 'go-up-folder', 'go-into-folder', 'where-am-i'] // the first set, before this file listed them
    }
  }
  const fresh = Object.keys(STARTERS).filter((n) => !written.includes(n))
  if (!fresh.length) return
  for (const name of fresh) {
    const file = join(dir, `${name}.js`)
    if (existsSync(file)) continue
    writeFileSync(file, STARTERS[name])
    approve('command', name, hashOf(STARTERS[name]))
  }
  writeFileSync(
    marker,
    JSON.stringify({ note: 'Starter commands mine has written here. Remove a name to get that one back.', written: [...written, ...fresh] }, null, 2),
  )
}

export function wireCommands(
  win: () => BrowserWindow | undefined,
  opts: { showWidget: (name: string, props: unknown) => void; pipe: PipeExtra },
): Pipe {
  getWin = win
  onWidgetShow = opts.showWidget
  seed()
  void reload()

  let timer: NodeJS.Timeout | undefined
  watch(commandsDir(), (_e, name) => {
    if (!name || !String(name).endsWith('.js')) return
    clearTimeout(timer)
    timer = setTimeout(() => void reload(), 150)
  })

  ipcMain.handle('commands:list', () => state)
  ipcMain.handle('commands:register-app', (_e, infos: AppCommandInfo[]) => {
    state = { ...state, app: infos.map((c) => ({ ...c, source: 'app' as const })) }
    send('commands:changed', state)
  })
  ipcMain.handle('commands:invoke-done', (_e, id: number, result: CommandResult) => {
    invoking.get(id)?.(result)
    invoking.delete(id)
  })
  ipcMain.handle('commands:run', (_e, name: string, params: Record<string, string>, said?: string) => runCommand(name, params ?? {}, said))
  ipcMain.handle('commands:undo', (_e, name: string, undoState: unknown) => undoCommand(name, undoState))
  ipcMain.handle('commands:remove', (_e, name: string) => removeCommand(name))
  // only ever from the window: the person clicking Approve
  ipcMain.handle('commands:approve', (_e, name: string) => approveCommand(name))
  ipcMain.handle('commands:reveal', (_e, path?: string) => {
    if (path) shell.showItemInFolder(path)
    else void shell.openPath(commandsDir())
  })

  return servePipe(opts.pipe)
}
