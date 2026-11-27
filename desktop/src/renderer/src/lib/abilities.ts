import { createContext, useContext, useEffect, useRef } from 'react'
import type { AppCommandInfo, CommandsState, CommandView } from '@shared/commands'
import type { WidgetInfo } from '@shared/widgets'

// Everything mine can do is a command. mine's own features register here, next
// to the code that implements them, so the decisions model can pick them from
// what the person says and agents can run them with run_command. When you add
// a feature to mine, add its command too.

export type AppOutcome = {
  say?: string
  view?: CommandView
  undo?: () => void | Promise<void>
  /** Don't record it in the conversation (e.g. starting a new one). say still flashes. */
  quiet?: boolean
}

export type AppCommand = AppCommandInfo & { run: (params: Record<string, string>, said: string) => AppOutcome | Promise<AppOutcome> }

/** Register mine's own commands with main and answer agents that run them. */
export function useAppCommands(cmds: AppCommand[]) {
  const ref = useRef(cmds)
  ref.current = cmds
  const infos = JSON.stringify(cmds.map(({ run: _run, ...info }) => info))

  useEffect(() => {
    void window.mine.commands.registerApp(JSON.parse(infos))
  }, [infos])

  useEffect(
    () =>
      window.mine.commands.onInvoke(async ({ id, name, params, said }) => {
        const t0 = performance.now()
        try {
          const c = ref.current.find((x) => x.name === name)
          if (!c) throw new Error(`mine has no ${name} right now.`)
          const out = await c.run(params ?? {}, said)
          await window.mine.commands.invokeDone(id, { ok: true, say: out.say, view: out.view, canUndo: false, ms: Math.round(performance.now() - t0) })
        } catch (err) {
          await window.mine.commands.invokeDone(id, { ok: false, error: (err as Error).message })
        }
      }),
    [],
  )

  return (name: string) => ref.current.find((c) => c.name === name)
}

/** What views need from the app: the registry, and ways to act. */
export type Abilities = {
  commands: CommandsState | null
  widgets: WidgetInfo[]
  /** Run a command directly with these params (no decisions model). */
  run: (name: string, params: Record<string, string>) => Promise<{ say?: string; view?: CommandView; error?: string }>
  /** Hand text to the agent as if the person said it. */
  ask: (text: string) => void
  /** Open the full-screen explorer at a folder, optionally with a file open. */
  openExplorer: (root: string, file?: string) => void
}

export const AbilitiesContext = createContext<Abilities>({
  commands: null,
  widgets: [],
  run: async () => ({ error: 'Not ready' }),
  ask: () => {},
  openExplorer: () => {},
})

export const useAbilities = () => useContext(AbilitiesContext)
