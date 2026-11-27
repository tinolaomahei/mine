// Utility process: loads command files and runs them. Kept apart from the
// main process so a slow or broken command can't freeze the window; the main
// process kills and restarts this one if a command overruns.

import { exec } from 'node:child_process'
import Module from 'node:module'
import { dirname } from 'node:path'
import type { CommandInfo, CommandParam } from '@shared/commands'

type Ctx = Record<string, unknown>
type Def = {
  title?: string
  description?: string
  examples?: string[]
  params?: Record<string, { description?: string; options?: unknown }>
  run?: (ctx: Ctx, mine: unknown) => unknown
  undo?: (state: unknown, ctx: Ctx, mine: unknown) => unknown
}

type In =
  /** Only approved files, with the exact source that was approved. */
  | { type: 'load'; id: number; files: { name: string; file: string; source: string }[] }
  | { type: 'options'; id: number; name: string; param: string; ctx: Ctx }
  | { type: 'run'; id: number; name: string; ctx: Ctx }
  | { type: 'undo'; id: number; name: string; state: unknown; ctx: Ctx }
  | { type: 'answer'; cid: number; ok: boolean; value?: unknown; error?: string }

const defs = new Map<string, Def>()
const post = (m: unknown) => process.parentPort.postMessage(m)

// --- calls back into the app -------------------------------------------------

let nextCall = 1
const calls = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
const host = (area: string, method: string, args: unknown[]) =>
  new Promise((resolve, reject) => {
    const cid = nextCall++
    calls.set(cid, { resolve, reject })
    post({ type: 'call', cid, area, method, args })
  })

const area = (name: string) => new Proxy({}, { get: (_t, method) => (...args: unknown[]) => host(name, String(method), args) })

const mine = {
  window: area('window'),
  workdir: area('workdir'),
  data: area('data'),
  widget: area('widget'),
  settings: area('settings'),
  theme: area('theme'),
  shell: area('shell'),
  clipboard: area('clipboard'),
  conversation: area('conversation'),
  agent: area('agent'),
  appearance: (mode: string) => host('appearance', 'set', [mode]),
  notify: (title: string, body?: string) => host('notify', 'show', [title, body]),
  exec: (line: string, opts: { cwd?: string } = {}) =>
    new Promise((resolve) => {
      exec(line, { cwd: opts.cwd, timeout: 12_000, windowsHide: true, maxBuffer: 4 << 20 }, (err, stdout, stderr) =>
        resolve({ stdout: String(stdout), stderr: String(stderr), code: err ? ((err as { code?: number }).code ?? 1) : 0 }),
      )
    }),
}

// --- loading -----------------------------------------------------------------

function toOptions(o: unknown): CommandParam['options'] {
  if (Array.isArray(o))
    return o.map((x) =>
      typeof x === 'string' ? { value: x, description: x } : { value: String(x.value), description: String(x.description ?? x.value) },
    )
  if (o && typeof o === 'object') return Object.entries(o).map(([value, description]) => ({ value, description: String(description) }))
  throw new Error('options must be an object { value: description }, an array, or a function')
}

function describe(name: string, file: string, d: Def): CommandInfo {
  if (typeof d.run !== 'function') throw new Error('It needs a run() function.')
  if (typeof d.description !== 'string' || !d.description.trim()) throw new Error('It needs a description.')
  const params: Record<string, CommandParam> = {}
  for (const [key, p] of Object.entries(d.params ?? {})) {
    if (!/^[a-zA-Z][\w-]{0,40}$/.test(key)) throw new Error(`Bad param name "${key}".`)
    params[key] =
      typeof p.options === 'function'
        ? { description: String(p.description ?? key), dynamic: true }
        : { description: String(p.description ?? key), options: toOptions(p.options) }
    if (!params[key].dynamic && !params[key].options?.length) throw new Error(`Param "${key}" has no options.`)
  }
  return {
    name,
    title: String(d.title ?? name.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())),
    description: d.description.trim(),
    examples: Array.isArray(d.examples) ? d.examples.map(String).slice(0, 8) : [],
    params,
    canUndo: typeof d.undo === 'function',
    source: 'yours',
    file,
  }
}

type Mod = InstanceType<typeof Module> & { _compile(source: string, file: string): void }
const M = Module as unknown as { new (id: string): Mod; _nodeModulePaths(dir: string): string[] }

/** Compile exactly the approved text, not whatever is on disk by now. */
function compile(file: string, source: string) {
  const m = new M(file)
  m.filename = file
  m.paths = M._nodeModulePaths(dirname(file))
  m._compile(source, file)
  return m.exports
}

function load(files: { name: string; file: string; source: string }[]) {
  defs.clear()
  const commands: CommandInfo[] = []
  const errors: { file: string; message: string }[] = []
  for (const { name, file, source } of files) {
    try {
      const mod = compile(file, source)
      const d = (mod?.default ?? mod) as Def
      commands.push(describe(name, file, d))
      defs.set(name, d)
    } catch (err) {
      errors.push({ file, message: (err as Error).message.split('\n').slice(0, 4).join('\n') })
    }
  }
  return { commands, errors }
}

function def(name: string) {
  const d = defs.get(name)
  if (!d) throw new Error(`There's no command called ${name}.`)
  return d
}

// --- messages ----------------------------------------------------------------

process.parentPort.on('message', async (e: { data: In }) => {
  const m = e.data
  if (m.type === 'answer') {
    const c = calls.get(m.cid)
    calls.delete(m.cid)
    if (m.ok) c?.resolve(m.value)
    else c?.reject(new Error(m.error))
    return
  }
  const reply = (value: unknown) => post({ type: 'reply', id: m.id, ok: true, value })
  try {
    if (m.type === 'load') return reply(load(m.files))
    if (m.type === 'options') {
      const fn = def(m.name).params?.[m.param]?.options
      return reply(toOptions(typeof fn === 'function' ? await fn(m.ctx) : fn))
    }
    if (m.type === 'run') return reply((await def(m.name).run!(m.ctx, mine)) ?? {})
    if (m.type === 'undo') {
      const d = def(m.name)
      if (typeof d.undo !== 'function') throw new Error('This command can’t be undone.')
      return reply((await d.undo(m.state, m.ctx, mine)) ?? {})
    }
  } catch (err) {
    post({ type: 'reply', id: m.id, ok: false, error: (err as Error)?.message ?? String(err) })
  }
})
