import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { AgentEvent, HarnessId, RunRequest } from '@shared/ipc'
import { detectHarnesses } from './detect'
import { parserFor, type Parsed } from './parse'
import { killCommand, killTree } from './procs'
import { adapter, type AgentContext } from './registry'
import { launchFor } from './resolve'

// Runs one prompt through the chosen harness and streams events back.

type ToolCall = { name: string; input?: unknown; done: boolean }
type Run = { child: ChildProcess; tools: Map<string, ToolCall> }

const running = new Map<string, Run>()
const cancelled = new Set<string>()

// Tool output can be huge (a full file read, a build log). The window only
// needs enough to see what happened.
const MAX_OUTPUT = 6000
const clip = (s: string | undefined) =>
  s === undefined ? undefined : s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + `
… ${s.length - MAX_OUTPUT} more characters` : s

export async function runAgent(
  harness: HarnessId,
  cwd: string,
  ctx: AgentContext,
  req: RunRequest,
  emit: (e: AgentEvent) => void,
): Promise<void> {
  const send = (e: Omit<AgentEvent, 'runId'> & Record<string, unknown>) => emit({ runId: req.runId, ...e } as AgentEvent)

  const a = adapter(harness)
  const info = (await detectHarnesses()).find((h) => h.id === harness)
  const launch = info?.path ? launchFor(info.path) : undefined
  if (!info?.found || !launch) {
    send({ type: 'error', message: `${a.name} isn’t installed on this computer any more.` })
    return
  }

  let sessionRef = req.sessionRef
  if (!sessionRef && a.presetSession) {
    sessionRef = randomUUID()
    send({ type: 'session', ref: sessionRef })
  }

  const { argv, stdin } = a.args({ prompt: req.prompt, sessionRef, ctx })
  const child = spawn(launch.file, [...launch.prefix, ...argv], {
    cwd,
    // MINE_RUN_ID reaches mine's MCP server, so a permission request can be tied to this run
    env: { ...process.env, ...launch.env, NO_COLOR: '1', FORCE_COLOR: '0', MINE_RUN_ID: req.runId },
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const run: Run = { child, tools: new Map() }
  running.set(req.runId, run)

  const track = (p: Parsed) => {
    if (p.type === 'tool') {
      const prev = run.tools.get(p.id)
      run.tools.set(p.id, { name: p.name, input: p.input ?? prev?.input, done: prev?.done ?? false })
    } else if (p.type === 'tool-end') {
      const t = run.tools.get(p.id)
      if (t) t.done = true
    }
  }

  child.stdin.on('error', () => {})
  if (stdin !== undefined) child.stdin.write(stdin)
  child.stdin.end()

  const parse = parserFor(a.format)
  let buffer = ''
  let failed = false
  let stderr = ''

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    if (!parse) {
      send({ type: 'delta', text: chunk })
      return
    }
    buffer += chunk
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      for (const p of parse(line)) {
        track(p)
        if (p.type === 'final') send({ type: 'delta', text: p.text })
        else if (p.type === 'tool-end') send({ ...p, output: clip(p.output) })
        else if (p.type === 'tool-output') send({ ...p, text: clip(p.text) ?? '' })
        else {
          if (p.type === 'error') failed = true
          send(p)
        }
      }
    }
  })

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-4000)
  })

  await new Promise<void>((done) => {
    child.on('error', (err) => {
      failed = true
      send({ type: 'error', message: `Couldn’t start ${a.name}: ${err.message}` })
      done()
    })
    child.on('close', (code, signal) => {
      running.delete(req.runId)
      if (failed) return done()
      if (cancelled.delete(req.runId) || signal) send({ type: 'error', message: 'Stopped.' })
      else if (code !== 0) {
        const tail = stderr.trim().split(/\r?\n/).slice(-6).join('\n')
        send({ type: 'error', message: tail || `${a.name} exited with code ${code}.` })
      } else send({ type: 'done' })
      done()
    })
  })
}

export function cancelAgent(runId: string) {
  const child = running.get(runId)?.child
  if (!child?.pid) return
  // the whole tree: harnesses spawn their own tools
  killTree(child.pid)
  cancelled.add(runId)
}

/** The command a tool call runs, if it runs one. */
function commandOf(t: ToolCall): string | undefined {
  const input = t.input as Record<string, unknown> | undefined
  const cmd = input?.command ?? input?.cmd ?? input?.script
  if (typeof cmd === 'string') return cmd
  if (Array.isArray(cmd)) return cmd.join(' ')
  return undefined
}

/** Stop one running command; the agent sees it fail and keeps going. */
export async function stopTool(runId: string, toolId: string): Promise<boolean> {
  const run = running.get(runId)
  const tool = run?.tools.get(toolId)
  if (!run?.child.pid || !tool || tool.done) return false
  const command = commandOf(tool)
  if (command === undefined) return false
  return killCommand(run.child.pid, command)
}

export function cancelAll() {
  for (const id of running.keys()) cancelAgent(id)
}
