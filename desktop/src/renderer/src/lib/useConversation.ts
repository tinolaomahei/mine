import { useCallback, useEffect, useRef, useState } from 'react'
import type { CommandView } from '@shared/commands'
import type { ConversationRecord, HarnessId, HarnessInfo } from '@shared/ipc'

export type ToolStatus = 'running' | 'done' | 'error' | 'stopping' | 'stopped'

export type ToolCall = {
  id: string
  name: string
  input?: unknown
  status: ToolStatus
  output?: string
}

export type Turn =
  | { id: string; kind: 'user'; text: string; via: 'voice' | 'text' }
  | {
      id: string
      kind: 'agent'
      harness: string
      text: string
      tools: ToolCall[]
      state: 'running' | 'done' | 'error'
      error?: string
      /** Widgets and views the agent showed under its reply. */
      views?: CommandView[]
    }
  | { id: string; kind: 'note'; text: string }
  /** Something mine did itself via the fast decisions layer, without the agent. */
  | {
      id: string
      kind: 'action'
      text: string
      meta: string
      said: string
      via: 'voice' | 'text'
      undo?: () => void | Promise<void>
      state: 'done' | 'undone' | 'handed'
      view?: CommandView
      /** It ran but failed; the message says why. */
      error?: string
      /** For a person's command: what's needed to undo it, even after a restart. */
      command?: { name: string; undoState?: unknown }
    }
  /** A view shown on its own (e.g. a widget opened outside any reply). */
  | { id: string; kind: 'view'; view: CommandView }
  /** Something an agent made, waiting for the person's OK. */
  | { id: string; kind: 'approval'; item: 'command' | 'widget'; name: string }

const uid = (): string => crypto.randomUUID()

/** The command a tool runs, if it runs one (used for display and voice matching). */
export function commandOf(input: unknown): string | undefined {
  const i = input as Record<string, unknown> | undefined
  const c = i?.command ?? i?.cmd ?? i?.script
  return typeof c === 'string' ? c : Array.isArray(c) ? c.join(' ') : undefined
}

const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/** A recap so a harness joining partway through (new folder, new agent, reopened
 * without its session) isn't starting cold. */
function recap(turns: Turn[]) {
  const lines = turns
    .filter((t) => t.kind === 'user' || t.kind === 'agent' || t.kind === 'action')
    .slice(-8)
    .map((t) =>
      t.kind === 'user'
        ? `Person: ${short(t.text, 500)}`
        : t.kind === 'agent'
          ? `You: ${short(t.text, 700)}`
          : t.kind === 'action'
            ? `mine (directly): ${t.text}`
            : '',
    )
  return `(mine: you're joining this conversation partway through, without its history. Earlier in it:\n${lines.join('\n')}\n)\n\n`
}

const titleOf = (turns: Turn[]) => {
  const first = turns.find((t) => t.kind === 'user')
  return first?.kind === 'user' ? short(first.text.replace(/\s+/g, ' ').trim(), 80) : 'Untitled'
}

/** Turns as saved: no functions (they can't be stored). */
const toStored = (turns: Turn[]) =>
  turns.map((t) => {
    if (t.kind !== 'action') return t
    const { undo: _undo, ...rest } = t
    return rest
  })

/** Turns as reopened: anything still marked running was cut off when mine closed. */
function fromStored(turns: unknown[]): Turn[] {
  return (turns as Turn[]).map((t) =>
    t.kind === 'agent' && t.state === 'running'
      ? { ...t, state: 'error', error: 'mine closed before this finished.', tools: settle(t.tools) }
      : t,
  )
}

/** One running conversation with whichever harness is selected. */
export function useConversation(harness: HarnessInfo | undefined, workdir: string | undefined) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [runId, setRunId] = useState<string | null>(null)
  const [queued, setQueued] = useState<{ text: string; via: 'voice' | 'text' } | null>(null)
  // each harness keeps its own thread, so switching back resumes it
  const sessions = useRef(new Map<string, string>())
  const harnessRef = useRef(harness)
  harnessRef.current = harness
  const turnsRef = useRef(turns)
  turnsRef.current = turns
  // things to tell the agent at the start of the next message
  const preface = useRef('')

  // which saved conversation this is
  const [id, setId] = useState(uid)
  const meta = useRef({ id, createdAt: Date.now() })
  // turns exactly as opened from disk; viewing a conversation isn't changing it
  const opened = useRef<Turn[] | null>(null)

  const patchTool = (turnId: string, toolId: string, fn: (t: ToolCall) => ToolCall) =>
    setTurns((ts) =>
      ts.map((t) => (t.id === turnId && t.kind === 'agent' ? { ...t, tools: t.tools.map((x) => (x.id === toolId ? fn(x) : x)) } : t)),
    )

  useEffect(
    () =>
      window.mine.agent.onEvent((e) => {
        if (e.type === 'session') {
          const h = harnessRef.current
          if (h) sessions.current.set(h.id, e.ref)
          return
        }
        setTurns((ts) =>
          ts.map((t) => {
            if (t.id !== e.runId || t.kind !== 'agent') return t
            switch (e.type) {
              case 'delta':
                return { ...t, text: t.text + e.text }
              case 'tool': {
                const known = t.tools.find((x) => x.id === e.id)
                if (known) return { ...t, tools: t.tools.map((x) => (x.id === e.id ? { ...x, input: e.input ?? x.input } : x)) }
                return { ...t, tools: [...t.tools, { id: e.id, name: e.name, input: e.input, status: 'running' }] }
              }
              case 'tool-output':
                return { ...t, tools: t.tools.map((x) => (x.id === e.id ? { ...x, output: e.text } : x)) }
              case 'tool-end':
                return {
                  ...t,
                  tools: t.tools.map((x) =>
                    x.id === e.id
                      ? {
                          ...x,
                          output: e.output ?? x.output,
                          status: x.status === 'stopping' || x.status === 'stopped' ? 'stopped' : e.ok ? 'done' : 'error',
                        }
                      : x,
                  ),
                }
              case 'done':
                return { ...t, state: 'done', text: t.text.trim(), tools: settle(t.tools) }
              case 'error':
                return { ...t, state: 'error', error: e.message, tools: settle(t.tools) }
            }
          }),
        )
        if (e.type === 'done' || e.type === 'error') setRunId((r) => (r === e.runId ? null : r))
      }),
    [],
  )

  // mark a harness switch in the thread
  const lastHarness = useRef(harness?.id)
  useEffect(() => {
    if (!harness || lastHarness.current === harness.id) return
    const was = lastHarness.current
    lastHarness.current = harness.id
    if (was) setTurns((ts) => (ts.length ? [...ts, { id: uid(), kind: 'note', text: `Now using ${harness.name}` }] : ts))
  }, [harness])

  // a new working folder means a new harness session; send() carries the thread over
  const lastDir = useRef(workdir)
  useEffect(() => {
    if (!workdir || lastDir.current === workdir) return
    const was = lastDir.current
    lastDir.current = workdir
    if (!was) return
    sessions.current.clear()
    if (turnsRef.current.length) {
      preface.current += `(mine: the working folder changed from ${was} to ${workdir}.)\n\n`
      // a command that changed the folder already says so
      setTurns((ts) => (ts[ts.length - 1]?.kind === 'action' ? ts : [...ts, { id: uid(), kind: 'note', text: `Now working in ${workdir}` }]))
    }
  }, [workdir])

  // Save as it goes, a moment after things stop changing.
  const record = (): ConversationRecord => ({
    id: meta.current.id,
    title: titleOf(turnsRef.current),
    harness: harnessRef.current?.id ?? null,
    workdir: lastDir.current ?? '',
    createdAt: meta.current.createdAt,
    updatedAt: Date.now(),
    sessions: Object.fromEntries(sessions.current) as ConversationRecord['sessions'],
    turns: toStored(turnsRef.current),
  })
  const pending = useRef(false)
  useEffect(() => {
    if (turns === opened.current || !turns.some((t) => t.kind === 'user')) return
    pending.current = true
    const t = setTimeout(() => {
      pending.current = false
      void window.mine.conversations.save(record())
    }, 600)
    return () => clearTimeout(t)
  }, [turns])
  useEffect(() => {
    const flush = () => {
      if (pending.current) void window.mine.conversations.save(record())
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  const send = useCallback(
    async (text: string, via: 'voice' | 'text') => {
      const h = harnessRef.current
      const said = text.trim()
      if (!h || !said) return
      if (runId) {
        // one thing at a time: the next message waits for this run to finish
        setQueued({ text: said, via })
        return
      }
      const id = uid()
      // no session for this harness yet, but there's history: bring it up to speed
      const joining = !sessions.current.get(h.id) && turnsRef.current.some((t) => t.kind === 'user')
      const prompt = (joining ? recap(turnsRef.current) : '') + preface.current + said
      preface.current = ''
      setTurns((ts) => [
        ...ts,
        { id: uid(), kind: 'user', text: said, via },
        { id, kind: 'agent', harness: h.name, text: '', tools: [], state: 'running' },
      ])
      setRunId(id)
      try {
        await window.mine.agent.run({ runId: id, prompt, sessionRef: sessions.current.get(h.id) })
      } catch (err) {
        setRunId(null)
        setTurns((ts) => ts.map((t) => (t.id === id && t.kind === 'agent' ? { ...t, state: 'error', error: String(err) } : t)))
      }
    },
    [runId],
  )

  // send whatever was queued as soon as the current run ends
  useEffect(() => {
    if (runId || !queued) return
    setQueued(null)
    void send(queued.text, queued.via)
  }, [runId, queued, send])

  const stop = useCallback(() => {
    if (runId) void window.mine.agent.cancel(runId)
  }, [runId])

  /** Stop one command. The agent sees it fail and carries on. */
  const stopTool = useCallback(
    async (toolId: string) => {
      const turn = turnsRef.current.find((t) => t.kind === 'agent' && t.id === runId)
      const tool = turn?.kind === 'agent' ? turn.tools.find((x) => x.id === toolId) : undefined
      if (!runId || !tool || tool.status !== 'running') return false
      patchTool(runId, toolId, (x) => ({ ...x, status: 'stopping' }))
      const ok = await window.mine.agent.stopTool(runId, toolId)
      if (!ok) {
        patchTool(runId, toolId, (x) => (x.status === 'stopping' ? { ...x, status: 'running' } : x))
        return false
      }
      const cmd = commandOf(tool.input)
      preface.current += `(mine: the person stopped ${cmd ? `\`${short(cmd, 200)}\`` : `your ${tool.name} call`} while it was running. It did not finish.)\n\n`
      return true
    },
    [runId],
  )

  /** Record something mine did itself, so the thread and the agent both know. */
  const addLocal = useCallback(
    (
      said: string,
      via: 'voice' | 'text',
      action: {
        text: string
        meta: string
        undo?: () => void | Promise<void>
        view?: CommandView
        error?: string
        command?: { name: string; undoState?: unknown }
      },
    ) => {
      preface.current += action.error
        ? `(mine: the person said "${short(said, 200)}"; mine tried to ${action.text.toLowerCase()} directly but it failed: ${short(action.error, 300)}.)

`
        : `(mine: the person said "${short(said, 200)}" and mine did it directly: ${action.text}.)

`
      setTurns((ts) => [
        ...ts,
        { id: uid(), kind: 'user', text: said, via },
        { id: uid(), kind: 'action', said, via, state: 'done', ...action },
      ])
    },
    [],
  )

  const undoLocal = useCallback(async (id: string) => {
    const t = turnsRef.current.find((x) => x.id === id)
    if (t?.kind !== 'action' || t.state !== 'done') return
    const undo = undoOf(t)
    if (!undo) return
    await undo()
    preface.current += `(mine: the person then undid that.)

`
    setTurns((ts) => ts.map((x) => (x.id === id && x.kind === 'action' ? { ...x, state: 'undone' } : x)))
  }, [])

  /** The fast layer guessed wrong: undo if possible and give it to the agent. */
  const handToAgent = useCallback(
    async (id: string) => {
      const t = turnsRef.current.find((x) => x.id === id)
      if (t?.kind !== 'action' || t.state === 'handed') return
      const undo = undoOf(t)
      if (t.state === 'done' && undo && !t.error) await undo()
      setTurns((ts) => ts.map((x) => (x.id === id && x.kind === 'action' ? { ...x, state: 'handed' } : x)))
      preface.current += `(mine: that was a misread and has been undone. Handle the request below yourself.)

`
      await send(t.said, t.via)
    },
    [send],
  )

  /** Swap a view in place, e.g. a file list moving into a subfolder. */
  const setView = useCallback((turnId: string, view: CommandView) => {
    setTurns((ts) => ts.map((t) => (t.id === turnId && (t.kind === 'action' || t.kind === 'view') ? { ...t, view } : t)))
  }, [])

  /** Show a view under the current reply, or on its own if there isn't one. */
  const showView = useCallback((view: CommandView) => {
    setTurns((ts) => {
      const last = ts[ts.length - 1]
      if (last?.kind === 'agent') return ts.map((t) => (t === last ? { ...last, views: [...(last.views ?? []), view] } : t))
      return [...ts, { id: uid(), kind: 'view', view }]
    })
  }, [])

  /** Ask the person to approve something an agent made (once per item). */
  const askApproval = useCallback((item: 'command' | 'widget', name: string) => {
    setTurns((ts) =>
      ts.some((t) => t.kind === 'approval' && t.item === item && t.name === name)
        ? ts
        : [...ts, { id: uid(), kind: 'approval', item, name }],
    )
  }, [])

  const reset = useCallback(() => {
    sessions.current.clear()
    preface.current = ''
    setQueued(null)
    setTurns([])
    opened.current = null
    meta.current = { id: uid(), createdAt: Date.now() }
    setId(meta.current.id)
  }, [])

  /**
   * Show a saved conversation and carry on from it. `restores` says what the
   * caller is about to switch back to (its folder, its agent), so those
   * switches don't read as changes partway through.
   */
  const open = useCallback(
    (rec: ConversationRecord, restores: { workdir: boolean; harness: boolean }) => {
      if (runId) return false
      sessions.current = new Map(Object.entries(rec.sessions) as [HarnessId, string][])
      preface.current = ''
      setQueued(null)
      if (restores.workdir) lastDir.current = rec.workdir
      else {
        // its folder is gone, so its sessions can't resume: start fresh here
        sessions.current.clear()
        if (rec.workdir)
          preface.current = `(mine: this conversation was in ${rec.workdir}, which no longer exists. Now working in ${lastDir.current}.)\n\n`
      }
      if (restores.harness && rec.harness) lastHarness.current = rec.harness
      const ts = fromStored(rec.turns)
      opened.current = ts
      setTurns(ts)
      meta.current = { id: rec.id, createdAt: rec.createdAt }
      setId(rec.id)
      return true
    },
    [runId],
  )

  const current = turns.find((t) => t.kind === 'agent' && t.id === runId)
  const runningTools = current?.kind === 'agent' ? current.tools.filter((t) => t.status === 'running') : []

  return {
    id,
    turns,
    running: runId !== null,
    runningTools,
    queued,
    clearQueued: () => setQueued(null),
    send,
    stop,
    stopTool,
    reset,
    open,
    addLocal,
    setView,
    showView,
    askApproval,
    undoLocal,
    handToAgent,
  }
}

/** How to undo an action: its own function, or a person's command's undo (which survives restarts). */
export function undoOf(t: Extract<Turn, { kind: 'action' }>): (() => void | Promise<void>) | undefined {
  if (t.error) return undefined
  if (t.undo) return t.undo
  const c = t.command
  if (c && c.undoState !== undefined) return () => void window.mine.commands.undo(c.name, c.undoState)
  return undefined
}

/** When a run ends, anything still marked running didn't report back. */
function settle(tools: ToolCall[]): ToolCall[] {
  return tools.map((t) => (t.status === 'running' ? { ...t, status: 'stopped' } : t.status === 'stopping' ? { ...t, status: 'stopped' } : t))
}
