import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { CommandsState } from '@shared/commands'
import { decisionProvider, type RouteResult } from '@shared/decisions'
import type { ConversationSummary, HarnessId, HarnessInfo, Settings, ThemePref } from '@shared/ipc'
import type { WidgetInfo } from '@shared/widgets'
import { Conversation } from '@/components/Conversation'
import { DecisionsSetup } from '@/components/DecisionsSetup'
import { Explorer, type ExplorerHandle } from '@/components/Explorer'
import { HarnessPicker } from '@/components/HarnessPicker'
import { History } from '@/components/History'
import { ThemeToast } from '@/components/ThemeToast'
import { TitleBar } from '@/components/TitleBar'
import { TypeWay } from '@/components/TypeWay'
import { VoiceWay } from '@/components/VoiceWay'
import { AbilitiesContext, useAppCommands, type Abilities, type AppCommand } from '@/lib/abilities'
import { stopIntent } from '@/lib/intent'
import { useConversation } from '@/lib/useConversation'
import { useSpeech } from '@/lib/useSpeech'

type Mode = 'voice' | 'type'

function typingInto(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
}

const MODES: Record<ThemePref, string> = { light: 'light mode', dark: 'dark mode', system: 'the system’s light or dark setting' }

export default function App() {
  const [harnesses, setHarnesses] = useState<HarnessInfo[] | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [mode, setMode] = useState<Mode>('voice')
  const [draft, setDraft] = useState('')
  const voiceRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const harness = harnesses?.find((h) => h.id === settings?.harness && h.found)
  const found = useMemo(() => (harnesses ?? []).filter((h) => h.found), [harnesses])
  const convo = useConversation(harness, settings?.workdir)
  const [flash, setFlash] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const say = (text: string) => {
    setFlash(text)
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 4000)
  }

  // 'first' during onboarding, 'edit' when opened from the title bar
  const [setup, setSetup] = useState<null | 'first' | 'edit'>(null)
  useEffect(() => {
    if (harness && settings && !settings.decisions && setup === null) setSetup('first')
  }, [harness, settings, setup])
  const decisionsOn = !!settings?.decisions && settings.decisions.provider !== 'off'
  const setAndKeep = async (patch: Partial<Settings>) => setSettings(await window.mine.settings.set(patch))

  // ---- what the person and agents have added: commands, widgets ---------------

  const [commands, setCommands] = useState<CommandsState | null>(null)
  const [widgets, setWidgets] = useState<WidgetInfo[]>([])
  useEffect(() => {
    void window.mine.commands.list().then(setCommands)
    void window.mine.widgets.list().then(setWidgets)
    const a = window.mine.commands.onChange(setCommands)
    const b = window.mine.widgets.onChange(setWidgets)
    return () => (a(), b())
  }, [])
  // a command an agent made and that isn't approved yet gets a card in the conversation
  useEffect(() => {
    for (const p of commands?.pending ?? []) convo.askApproval('command', p.name)
  }, [commands, convo.askApproval])
  // (widgets ask where they're shown, in place of the widget)

  // ---- past conversations ------------------------------------------------------

  const [historyOpen, setHistoryOpen] = useState(false)
  // the full-screen file explorer
  const [explorer, setExplorer] = useState<{ root: string; file?: string } | null>(null)
  const explorerRef = useRef<ExplorerHandle>(null)
  const explorerOpen = useRef(false)
  explorerOpen.current = !!explorer
  // Ctrl+W: close a tab in the explorer, otherwise close the window as before
  useEffect(
    () =>
      window.mine.onShortcut((name) => {
        if (name !== 'close-tab') return
        if (explorerOpen.current) explorerRef.current?.closeTab()
        else window.close()
      }),
    [],
  )
  const [recent, setRecent] = useState<ConversationSummary[]>([])
  useEffect(() => {
    const t = setTimeout(() => void window.mine.conversations.list().then((l) => setRecent(l.slice(0, 20))), 1200)
    return () => clearTimeout(t)
  }, [convo.id, convo.turns.length])

  /** Reopen a saved conversation, back in its own folder with its own agent. */
  const openConversation = async (id: string) => {
    if (convo.running || !settings) return false
    const got = await window.mine.conversations.get(id)
    if (!got) {
      say('That conversation couldn’t be opened.')
      return false
    }
    const { record, workdirExists } = got
    const agent = harnesses?.find((h) => h.id === record.harness && h.found)
    if (!convo.open(record, { workdir: workdirExists, harness: !!agent })) return false
    const patch: Partial<Settings> = {}
    if (workdirExists && record.workdir !== settings.workdir) patch.workdir = record.workdir
    if (agent && agent.id !== settings.harness) patch.harness = agent.id
    if (Object.keys(patch).length) await setAndKeep(patch)
    setSetup((s) => (s === 'edit' ? null : s))
    if (!workdirExists && record.workdir) say(`Its folder is gone, so this carries on in ${settings.workdir}.`)
    else if (record.harness && !agent) say(`${record.harness} isn’t installed, so ${harness?.name} picks this up.`)
    return true
  }

  const rescan = useCallback(async () => setHarnesses(await window.mine.harness.detect()), [])
  const pick = useCallback(async (id: HarnessId) => setSettings(await window.mine.settings.set({ harness: id })), [])

  // speech is created further down (it routes through the commands defined here)
  const speechRef = useRef<{ cancel: () => Promise<void> | void } | null>(null)
  const switchTo = useCallback((m: Mode) => {
    setMode(m)
    if (m === 'type') setTimeout(() => inputRef.current?.focus(), 80)
    else void speechRef.current?.cancel()
  }, [])

  // ---- mine's own features, as commands ----------------------------------------
  // Everything you can click in mine can also be said, and run by an agent.
  // New features belong in this list too.

  const appCommands: AppCommand[] = [
    {
      name: 'new-conversation',
      title: 'New conversation',
      description: 'Start a new, empty conversation. The current one is kept in past conversations.',
      examples: ['new conversation', 'start over', 'start a fresh chat', 'clear this'],
      params: {},
      canUndo: false,
      run: () => {
        convo.reset()
        return { say: 'Started a new conversation.', quiet: true }
      },
    },
    {
      name: 'set-appearance',
      title: 'Light or dark',
      description: 'Switch mine to light mode, dark mode, or following the computer’s own setting.',
      examples: ['dark mode', 'switch to light mode', 'make it dark', 'follow the system theme'],
      params: {
        mode: {
          description: 'Which mode',
          options: [
            { value: 'light', description: 'Light mode' },
            { value: 'dark', description: 'Dark mode' },
            { value: 'system', description: 'Follow the computer’s own light or dark setting' },
          ],
        },
      },
      canUndo: true,
      run: async ({ mode: m }) => {
        const to = m as ThemePref
        if (!(to in MODES)) throw new Error('Mode is light, dark or system.')
        const was = settings?.theme ?? 'system'
        if (to === was) return { say: `Already on ${MODES[to]}.` }
        await setAndKeep({ theme: to })
        return { say: to === 'system' ? 'Following the system’s light or dark setting' : `Switched to ${MODES[to]}`, undo: () => setAndKeep({ theme: was }) }
      },
    },
    {
      name: 'undo-theme',
      title: 'Undo the last theme change',
      description: 'Undo the last change to mine’s look: its colours, fonts or theme.',
      examples: ['undo that theme change', 'put the colours back', 'go back to the previous look'],
      params: {},
      canUndo: false,
      run: async () => ({ say: (await window.mine.theme.undo()) ? 'Undid the last theme change' : 'There was no theme change to undo' }),
    },
    {
      name: 'reset-theme',
      title: 'Reset the look',
      description: 'Put mine back to its own original look (Bloom), dropping any custom theme or branding.',
      examples: ['reset the theme', 'back to the default look', 'remove the branding'],
      params: {},
      canUndo: true,
      run: async () => {
        await window.mine.theme.reset()
        return { say: 'Back to mine’s own look', undo: () => void window.mine.theme.undo() }
      },
    },
    ...(found.length > 1
      ? [
          {
            name: 'switch-agent',
            title: 'Switch agent',
            description: 'Change which agent mine hands work to.',
            examples: found.slice(0, 3).map((h) => `switch to ${h.name}`),
            params: {
              agent: { description: 'Which agent to use', options: found.map((h) => ({ value: h.id, description: `${h.name} by ${h.vendor}` })) },
            },
            canUndo: true,
            run: async ({ agent }: Record<string, string>) => {
              const to = found.find((h) => h.id === agent)
              if (!to) throw new Error(`${agent} isn’t installed.`)
              const was = settings?.harness
              if (to.id === was) return { say: `Already using ${to.name}.` }
              await setAndKeep({ harness: to.id })
              return { say: `Switched to ${to.name}`, undo: was ? () => setAndKeep({ harness: was }) : undefined }
            },
          } satisfies AppCommand,
        ]
      : []),
    {
      name: 'stop-agent',
      title: 'Stop',
      description: 'Stop what the agent is doing right now.',
      examples: ['stop', 'cancel that', 'never mind, stop'],
      params: {},
      canUndo: false,
      run: () => {
        if (!convo.running) return { say: 'Nothing’s running.', quiet: true }
        convo.stop()
        return { say: 'Stopping everything.', quiet: true }
      },
    },
    {
      name: 'show-conversations',
      title: 'Past conversations',
      description: 'Show the list of past conversations to pick from.',
      examples: ['show my conversations', 'show past chats', 'what have we talked about before'],
      params: {},
      canUndo: false,
      run: () => {
        setHistoryOpen(true)
        return { quiet: true }
      },
    },
    ...(recent.filter((c) => c.id !== convo.id).length
      ? [
          {
            name: 'open-conversation',
            title: 'Open a past conversation',
            description: 'Go back to one of the past conversations and carry on with it.',
            examples: ['open the conversation about the logo', 'go back to yesterday’s chat', 'continue where we left off'],
            params: {
              conversation: {
                description: 'Which past conversation',
                options: recent.filter((c) => c.id !== convo.id).map((c) => ({ value: c.id, description: c.title })),
              },
            },
            canUndo: false,
            run: async ({ conversation }: Record<string, string>) => {
              if (convo.running) throw new Error('The agent is working; stop it or let it finish first.')
              const ok = await openConversation(conversation)
              if (!ok) throw new Error('That conversation couldn’t be opened.')
              return { say: 'Opened it.', quiet: true }
            },
          } satisfies AppCommand,
        ]
      : []),
    {
      name: 'choose-folder',
      title: 'Choose a folder',
      description: 'Open the folder picker to choose which folder the agents work in.',
      examples: ['choose a folder', 'change the working folder', 'pick a different project'],
      params: {},
      canUndo: false,
      run: async () => {
        const s = await window.mine.settings.pickWorkdir()
        setSettings(s)
        return { say: `Working in ${s.workdir}` }
      },
    },
    {
      name: 'switch-input',
      title: 'Type or talk',
      description: 'Switch between typing and talking to mine.',
      examples: ['let me type', 'switch to the keyboard', 'go back to voice'],
      params: {
        way: {
          description: 'How the person wants to talk to mine',
          options: [
            { value: 'type', description: 'Typing in a text box' },
            { value: 'voice', description: 'Speaking into the microphone' },
          ],
        },
      },
      canUndo: false,
      run: ({ way }) => {
        switchTo(way === 'type' ? 'type' : 'voice')
        return { quiet: true }
      },
    },
    {
      name: 'decisions-settings',
      title: 'Instant commands settings',
      description: 'Open the settings for the decisions model that makes commands instant: provider, API key, model.',
      examples: ['change the decisions provider', 'update my API key', 'open the instant commands settings'],
      params: {},
      canUndo: false,
      run: () => {
        setSetup('edit')
        return { quiet: true }
      },
    },
    {
      name: 'open-explorer',
      title: 'File explorer',
      description: 'Open the full-screen file explorer on the working folder: folders on the left, file contents on the right.',
      examples: ['open the file explorer', 'browse the files', 'show the explorer full screen'],
      params: {},
      canUndo: false,
      run: () => {
        if (!settings) throw new Error('mine isn’t ready yet.')
        setExplorer({ root: settings.workdir })
        return { quiet: true }
      },
    },
    {
      name: 'close-explorer',
      title: 'Close the file explorer',
      description: 'Close the full-screen file explorer.',
      examples: ['close the explorer', 'exit full screen', 'hide the files'],
      params: {},
      canUndo: false,
      run: () => {
        setExplorer(null)
        return { quiet: true }
      },
    },
    {
      name: 'save-file',
      title: 'Save the file',
      description: 'Save the file open in the file explorer.',
      examples: ['save the file', 'save this', 'save my changes'],
      params: {},
      canUndo: false,
      run: async () => {
        if (!explorerRef.current) throw new Error('The file explorer isn’t open.')
        if (!(await explorerRef.current.save())) throw new Error('There was nothing to save, or it couldn’t be saved.')
        return { say: 'Saved.', quiet: true }
      },
    },
    {
      name: 'close-file',
      title: 'Close the file',
      description: 'Close the file tab that’s open in the file explorer.',
      examples: ['close this file', 'close the tab', 'close this tab'],
      params: {},
      canUndo: false,
      run: () => {
        if (!explorerRef.current) throw new Error('The file explorer isn’t open.')
        explorerRef.current.closeTab()
        return { quiet: true }
      },
    },
    {
      name: 'markdown-view',
      title: 'Markdown preview or edit',
      description: 'Switch the Markdown file open in the explorer between its rendered preview and editing its text.',
      examples: ['show the preview', 'edit the markdown', 'switch to source', 'show it rendered'],
      params: {
        mode: {
          description: 'Which view',
          options: [
            { value: 'preview', description: 'The rendered preview' },
            { value: 'edit', description: 'The text, to edit' },
          ],
        },
      },
      canUndo: false,
      run: ({ mode }) => {
        if (!explorerRef.current) throw new Error('The file explorer isn’t open.')
        if (!explorerRef.current.setMarkdownMode(mode === 'edit' ? 'edit' : 'preview')) throw new Error('The open file isn’t Markdown.')
        return { quiet: true }
      },
    },
    {
      name: 'list-commands',
      title: 'What mine can do',
      description: 'List everything mine can do instantly: its own commands, the person’s commands and widgets.',
      examples: ['what can you do', 'what commands are there', 'show me the commands'],
      params: {},
      canUndo: false,
      run: () => {
        const all = [...(commands?.app ?? []), ...(commands?.commands ?? [])]
        const items = [
          ...all.map((c) => ({ label: c.title, value: c.examples[0] ? `“${c.examples[0]}”` : c.source === 'yours' ? 'yours' : '' })),
          ...widgets.filter((w) => w.approved).map((w) => ({ label: `${w.title} (widget)`, value: w.examples[0] ? `“${w.examples[0]}”` : '' })),
        ]
        return { say: `${items.length} things, instantly`, view: { type: 'list', items } }
      },
    },
  ]
  const appCommand = useAppCommands(appCommands)

  // ---- routing: everything said or typed ---------------------------------------

  /** Run a command the decisions model picked. False means the agent should have it. */
  const runPicked = async (r: Extract<RouteResult, { kind: 'command' }>, said: string, via: 'voice' | 'text') => {
    const meta = `${r.provider} · ${r.ms} ms · ${Math.round(r.confidence * 100)}% sure`
    const app = appCommand(r.name)
    if (app) {
      try {
        const out = await app.run(r.params, said)
        if (out.quiet) {
          if (out.say) say(out.say)
        } else convo.addLocal(said, via, { text: out.say ?? app.title, meta, undo: out.undo, view: out.view })
      } catch (err) {
        convo.addLocal(said, via, { text: app.title, meta, error: (err as Error).message })
      }
      return true
    }
    const info = commands?.commands.find((c) => c.name === r.name)
    const res = await window.mine.commands.run(r.name, r.params, said)
    if (!res.ok) convo.addLocal(said, via, { text: info?.title ?? r.name, meta, error: res.error })
    else
      convo.addLocal(said, via, {
        text: res.say ?? info?.title ?? r.name,
        meta: `${meta} · ran in ${res.ms} ms`,
        view: res.view,
        command: res.canUndo ? { name: r.name, undoState: res.undoState } : undefined,
      })
    return true
  }

  // Everything said or typed goes through the fast intent layer first.
  // "Stop" is caught on the spot; commands and widgets run instantly through the
  // decisions model; everything else goes to the agent (or waits its turn).
  const route = async (raw: string, via: 'voice' | 'text') => {
    const text = raw.trim()
    if (!text) return
    if (convo.running) {
      const intent = stopIntent(text, convo.runningTools)
      if (intent.kind === 'all') {
        convo.stop()
        return say('Stopping everything.')
      }
      if (intent.kind === 'tool') {
        const ok = await convo.stopTool(intent.id)
        return say(ok ? 'Stopped that command. The agent keeps going.' : 'That one already finished.')
      }
    }
    if (decisionsOn && settings && harness) {
      const r = await window.mine.decisions.route(text, {
        workdir: settings.workdir,
        appearance: settings.theme,
        harness: settings.harness,
        harnesses: found.map((h) => ({ id: h.id, name: h.name })),
        running: convo.running,
      })
      if (r.kind === 'command' && (await runPicked(r, text, via))) return
      if (r.kind === 'widget') {
        convo.addLocal(text, via, {
          text: r.title,
          meta: `${r.provider} · ${r.ms} ms · ${Math.round(r.confidence * 100)}% sure`,
          view: { type: 'widget', name: r.name },
        })
        return
      }
    }
    if (convo.running) say('Got it. That’s next.')
    void convo.send(text, via)
  }
  const routeRef = useRef(route)
  routeRef.current = route
  const speech = useSpeech(voiceRef, (text) => void route(text, 'voice'))
  speechRef.current = speech

  // commands and agents asking the window to do things
  useEffect(() => {
    const a = window.mine.commands.onEffect((e) => {
      if (e.type === 'new-conversation') convo.reset()
      else if (e.type === 'stop-agent') convo.stop()
      else if (e.type === 'send-to-agent' && e.text.trim()) void convo.send(e.text, 'text')
    })
    const b = window.mine.widgets.onShow(({ name, props }) => convo.showView({ type: 'widget', name, props }))
    return () => (a(), b())
  }, [convo.reset, convo.stop, convo.send, convo.showView])

  const abilities: Abilities = useMemo(
    () => ({
      commands,
      widgets,
      run: async (name, params) => {
        const r = await window.mine.commands.run(name, params)
        return r.ok ? { say: r.say, view: r.view } : { error: r.error }
      },
      ask: (text) => void routeRef.current(text, 'text'),
      openExplorer: (root, file) => setExplorer({ root, file }),
    }),
    [commands, widgets],
  )

  useEffect(() => {
    void Promise.all([window.mine.harness.detect(), window.mine.settings.get()]).then(([h, s]) => {
      setHarnesses(h)
      setSettings(s)
    })
    // an agent can change settings (e.g. light/dark) from outside the window
    return window.mine.settings.onChange(setSettings)
  }, [])

  const sendDraft = () => {
    if (!draft.trim()) return
    void route(draft, 'text')
    setDraft('')
  }

  // Space talks, Esc stops (listening first, then whatever's running, from
  // anywhere, even mid-typing), and any letter typed while on the mic slides
  // over to the text box and keeps going.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // a menu or popover closing on Esc has already used it
      if (e.key === 'Escape' && !e.defaultPrevented && !e.isComposing) {
        if (speech.mic === 'listening') {
          e.preventDefault()
          void speech.cancel()
        } else if (convo.running) {
          e.preventDefault()
          convo.stop()
          say('Stopped.')
        }
        return
      }
      if (!harness || typingInto(e.target)) return
      if (mode !== 'voice' || e.ctrlKey || e.metaKey || e.altKey) return
      const onButton = (e.target as HTMLElement | null)?.closest('button, [role="combobox"]')
      if (e.key === ' ' && !onButton) {
        e.preventDefault()
        void speech.toggle()
      } else if (e.key.length === 1 && e.key !== ' ' && speech.mic !== 'listening') {
        e.preventDefault()
        setDraft((d) => d + e.key)
        switchTo('type')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [harness, mode, speech, switchTo, convo.running, convo.stop])

  const ready = harnesses !== null && settings !== null
  const empty = convo.turns.length === 0

  return (
    <AbilitiesContext.Provider value={abilities}>
      <div className="flex h-full flex-col">
        <ThemeToast />
        {explorer && (
          <Explorer ref={explorerRef} key={explorer.root + (explorer.file ?? '')} root={explorer.root} file={explorer.file} onClose={() => setExplorer(null)} />
        )}
        <TitleBar
          harnesses={harnesses ?? []}
          settings={harness ? settings : null}
          canReset={!empty}
          theme={settings?.theme ?? 'system'}
          onTheme={async (theme) => setSettings(await window.mine.settings.set({ theme }))}
          onHarness={pick}
          onWorkdir={async () => setSettings(await window.mine.settings.pickWorkdir())}
          onReset={convo.reset}
          decisions={
            !settings?.decisions ? null : settings.decisions.provider === 'off' ? 'off' : decisionProvider(settings.decisions.provider).name
          }
          onDecisions={() => setSetup('edit')}
          history={
            harness && settings ? (
              <History
                harnesses={harnesses ?? []}
                current={convo.id}
                running={convo.running}
                harness={harness.name}
                open={historyOpen}
                onOpenChange={setHistoryOpen}
                onOpen={(id) => void openConversation(id)}
                onDelete={(id) => id === convo.id && convo.reset()}
              />
            ) : null
          }
        />

        {!ready ? (
          <div className="flex-1" />
        ) : !harness ? (
          <HarnessPicker harnesses={harnesses} onPick={pick} onRescan={rescan} />
        ) : setup ? (
          <DecisionsSetup
            harness={harness.name}
            onBack={setup === 'edit' ? () => setSetup(null) : undefined}
            onDone={async () => {
              setSettings(await window.mine.settings.get())
              setSetup(null)
            }}
          />
        ) : (
          <main className="flex min-h-0 flex-1 flex-col">
            {empty ? (
              <div className="flex flex-1 flex-col items-center justify-end px-6 pb-2 text-center">
                <h1 className="font-display text-[clamp(2.25rem,1.2rem+3vw,3.5rem)] leading-[0.98] font-semibold tracking-[-0.04em]">
                  Start with nothing.
                </h1>
                <p className="mt-3 font-serif text-[1.125rem] text-muted-foreground">
                  Say what you want, or type it. mine hands it to {harness.name}.
                </p>
              </div>
            ) : (
              <Conversation
                turns={convo.turns}
                harness={harness.name}
                onStopTool={(id) => void convo.stopTool(id)}
                onUndo={(id) => void convo.undoLocal(id)}
                onHand={(id) => void convo.handToAgent(id)}
                onSetView={convo.setView}
              />
            )}

            <div className={empty ? 'flex flex-1 items-start pt-6' : 'shrink-0 border-t border-rule/70 bg-paper pt-3 pb-4'}>
              {convo.queued && (
                <div className="mx-auto mb-2 flex w-fit max-w-[min(36rem,calc(100%-2rem))] items-center gap-2 rounded-full bg-paper-2 py-1 pr-1 pl-3.5 text-sm">
                  <span className="shrink-0 font-mono text-[10.5px] text-neutral uppercase">Up next</span>
                  <span className="truncate">{convo.queued.text}</span>
                  <button
                    type="button"
                    onClick={convo.clearQueued}
                    aria-label="Drop the queued message"
                    className="grid size-6 shrink-0 place-items-center rounded-full text-neutral hover:bg-paper-3 hover:text-ink"
                  >
                    <X className="size-3" strokeWidth={2.5} />
                  </button>
                </div>
              )}
              <div className="ways" data-mode={mode}>
                <div className="ways-track">
                  <div className="way" inert={mode !== 'voice'}>
                    <VoiceWay
                      voiceRef={voiceRef}
                      status={speech.status}
                      mic={speech.mic}
                      note={speech.note ?? flash}
                      running={convo.running}
                      harness={harness.name}
                      compact={!empty}
                      onToggle={() => void speech.toggle()}
                      onStop={convo.stop}
                      onSwitch={() => switchTo('type')}
                    />
                  </div>
                  <div className="way" inert={mode !== 'type'}>
                    <TypeWay
                      ref={inputRef}
                      draft={draft}
                      setDraft={setDraft}
                      running={convo.running}
                      harness={harness.name}
                      onSend={sendDraft}
                      onStop={convo.stop}
                      onSwitch={() => switchTo('voice')}
                    />
                  </div>
                </div>
              </div>
            </div>
          </main>
        )}
      </div>
    </AbilitiesContext.Provider>
  )
}
