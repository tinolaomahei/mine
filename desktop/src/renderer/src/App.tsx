import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { LayoutDashboard, Plug, Plus, Store, X } from 'lucide-react'
import type { CommandsState } from '@shared/commands'
import { decisionProvider, type RouteResult } from '@shared/decisions'
import type { ConversationSummary, HarnessId, HarnessInfo, Settings, ThemePref } from '@shared/ipc'
import { ALL, describeRule, sameFolder, type PermissionAsk, type PermissionRule } from '@shared/permissions'
import { GRID, type ScreenItem, type WidgetInfo } from '@shared/widgets'
import type { Theme } from '@shared/theme'
import type { ThemeInfo } from '@shared/themes'
import { ChatDock, DockComposer, type DockState } from '@/components/ChatDock'
import { Conversation } from '@/components/Conversation'
import { Marketplace, type MarketFilter, type MarketKind } from '@/components/Marketplace'
import { ThemeShelf } from '@/components/ThemeShelf'
import { ScreenStart, ServiceShelf, SetupNotice } from '@/components/Connections'
import { setupLeft, useConnections } from '@/lib/useConnections'
import { ScreenGrid } from '@/components/ScreenGrid'
import { ScreenSwitcher, type Stage } from '@/components/ScreenSwitcher'
import { clampBox, rowsUsed, settle, whereIs } from '@/lib/grid'
import { useScreens } from '@/lib/useScreens'
import { cn } from '@/lib/utils'
import { DecisionsSetup } from '@/components/DecisionsSetup'
import { Explorer, type ExplorerHandle } from '@/components/Explorer'
import { HarnessPicker } from '@/components/HarnessPicker'
import { PermissionPrompt } from '@/components/PermissionPrompt'
import { History } from '@/components/History'
import { ThemeToast } from '@/components/ThemeToast'
import { TitleBar } from '@/components/TitleBar'
import { TypeWay } from '@/components/TypeWay'
import { VoiceWay } from '@/components/VoiceWay'
import { AbilitiesContext, hushed, useAppCommands, type Abilities, type AppCommand } from '@/lib/abilities'
import { stopIntent } from '@/lib/intent'
import { useConversation } from '@/lib/useConversation'
import { useSpeech } from '@/lib/useSpeech'

type Mode = 'voice' | 'type'

function typingInto(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
}

const MODES: Record<ThemePref, string> = { light: 'light mode', dark: 'dark mode', system: 'the system’s light or dark setting' }

type ChatState = 'full' | DockState

/** Small things remembered between launches (where you were, how the conversation sat). */
function remembered<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
function remember(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable: nothing to keep */
  }
}

const ARRANGE = {
  bigger: 'Bigger',
  smaller: 'Smaller',
  wider: 'Wider',
  narrower: 'Narrower',
  taller: 'Taller',
  shorter: 'Shorter',
  left: 'To the left edge',
  right: 'To the right edge',
  top: 'To the top',
  bottom: 'To the bottom',
} as const

/** A widget moved or resized the way someone asked, keeping to the grid and its smallest size. */
function arranged(it: ScreenItem, how: keyof typeof ARRANGE, min: { w: number; h: number }, all: ScreenItem[]): ScreenItem {
  const n = { ...it }
  const others = all.filter((i) => i.id !== it.id)
  if (how === 'bigger') (n.w += 2), (n.h += 1)
  else if (how === 'smaller') (n.w -= 2), (n.h -= 1)
  else if (how === 'wider') n.w += 2
  else if (how === 'narrower') n.w -= 2
  else if (how === 'taller') n.h += 1
  else if (how === 'shorter') n.h -= 1
  else if (how === 'left') n.x = 0
  else if (how === 'right') n.x = GRID.cols - n.w
  else if (how === 'top') n.y = 0
  else if (how === 'bottom') n.y = rowsUsed(others)
  if (n.x + n.w > GRID.cols) n.x = GRID.cols - n.w
  return clampBox(n, min)
}

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
    if (hushed()) return
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
  // ---- screens, the marketplace, and where the conversation sits ---------------
  // A screen is a page of widgets. When one is showing, the conversation
  // steps aside: a small window in the corner, or just a button there.

  const screensApi = useScreens()
  const screens = useMemo(() => screensApi.screens ?? [], [screensApi.screens])
  const [chat, setChatState] = useState<ChatState>(() => remembered<ChatState>('mine.chat', 'full'))
  const [stage, setStage] = useState<Stage | null>(() => remembered<Stage | null>('mine.stage', null))
  const [market, setMarket] = useState<MarketFilter>('all')
  const [marketKind, setMarketKind] = useState<MarketKind>('widgets')

  // themes in the marketplace, and the look on screen now
  const [themes, setThemes] = useState<ThemeInfo[]>([])
  const [look, setLook] = useState<Theme | null>(null)
  useEffect(() => {
    void window.mine.themes.list().then(setThemes)
    void window.mine.theme.get().then((t) => setLook(t.theme))
    const a = window.mine.themes.onChange(setThemes)
    const b = window.mine.theme.onChange((t) => setLook(t.theme))
    return () => (a(), b())
  }, [])
  const yourThemes = themes.filter((t) => t.source === 'yours')

  // the tools the person uses every day, and what's left to connect
  const conns = useConnections()
  const left = setupLeft(conns)
  // "Later" on a screen's setup notice, until something new needs doing
  const [later, setLater] = useState(false)
  const startRef = useRef<HTMLTextAreaElement>(null)
  const docked = useRef<DockState>(remembered<DockState>('mine.dock', 'button'))
  const chatRef = useRef(chat)
  chatRef.current = chat
  const lastScreen = useRef<string | null>(stage?.kind === 'screen' ? stage.id : null)
  const dockInputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => remember('mine.chat', chat), [chat])
  useEffect(() => {
    remember('mine.stage', stage)
    if (stage?.kind === 'screen') lastScreen.current = stage.id
  }, [stage])

  // a screen that's gone (deleted, or never saved) falls back to another one
  useEffect(() => {
    if (!screensApi.screens || stage?.kind !== 'screen' || screens.some((s) => s.id === stage.id)) return
    setStage(screens[0] ? { kind: 'screen', id: screens[0].id } : null)
  }, [screensApi.screens, stage])

  /** Full screen, a window in the corner, or a button there. The change morphs. */
  const setChat = useCallback((to: ChatState) => {
    if (to === chatRef.current) return
    if (to !== 'full') {
      docked.current = to
      remember('mine.dock', to)
      // something has to show behind it
      setStage((s) => s ?? (lastScreen.current ? { kind: 'screen', id: lastScreen.current } : null))
    }
    const go = () => flushSync(() => setChatState(to))
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (document.startViewTransition && !calm) {
      // a quick second change skips the first one's animation; that's fine
      const t = document.startViewTransition(go)
      t.ready.catch(() => {})
      t.finished.catch(() => {})
    } else go()
  }, [])

  /** Bring a screen or the marketplace into view, moving the conversation aside if it's full. */
  const showStage = useCallback(
    (to: Stage) => {
      setStage(to)
      if (chatRef.current === 'full') setChat(docked.current)
    },
    [setChat],
  )
  const openScreen = useCallback((id: string) => showStage({ kind: 'screen', id }), [showStage])
  const currentScreen = stage?.kind === 'screen' ? screens.find((s) => s.id === stage.id) : undefined
  /** Where a widget goes when no screen is named: the one showing, else the last one used. */
  const targetScreen = () => currentScreen ?? screens.find((s) => s.id === lastScreen.current) ?? screens[0] ?? null
  const widgetById = (id: string) => widgets.find((w) => w.id === id) ?? widgets.find((w) => w.name === id && w.source === 'yours')

  /** Put a widget on a screen (a new one if there are none). */
  const addToScreen = (widget: string, screen?: string | null, props?: Record<string, unknown>) => {
    const w = widgetById(widget)
    if (!w) throw new Error('There’s no widget like that.')
    if (!w.approved) throw new Error(`${w.title} needs your OK first.`)
    const target = screen === undefined ? targetScreen() : screen ? screens.find((s) => s.id === screen) : null
    const dest = target ?? screensApi.create()
    const item = screensApi.addWidget(dest.id, w, props)
    return { screen: dest, item: item!, widget: w }
  }

  /** The tools page: the whole checklist, in place of the screen, with a way back. */
  const openTools = () => showStage({ kind: 'setup' })

  /**
   * Show the connection checklist. On an empty screen it's the screen itself.
   * Asked for (a command, the title bar), it's the tools page. When an agent
   * adds something while a busy screen shows, the screen's notice says so and
   * nothing jumps.
   */
  const revealSetupRef = useRef((_asked: boolean) => {})
  revealSetupRef.current = (asked) => {
    setLater(false)
    if (chatRef.current === 'full') setChat('window')
    if (stage?.kind === 'setup' || (stage?.kind === 'market' && marketKind === 'connections')) return
    if (!screens.length) return openScreen(screensApi.create().id)
    const s = targetScreen()
    if (s && !s.items.length) return openScreen(s.id)
    if (asked || stage?.kind !== 'screen') openTools()
  }

  // when an agent puts a tool on the list, or wants a sync approved, the person sees it
  const seen = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!conns) return
    const items = [
      ...conns.connections.map((c) => ({ key: `c:${c.id}`, by: c.by })),
      ...conns.sources.filter((s) => !s.approved).map((s) => ({ key: `s:${s.id}`, by: s.by })),
    ]
    const before = seen.current
    seen.current = new Set(items.map((i) => i.key))
    if (before && items.some((i) => !before.has(i.key) && i.by === 'agent')) revealSetupRef.current(false)
  }, [conns])

  /** From an empty screen: what the person does, straight to their agent. */
  const tellMine = (text: string) => {
    if (chatRef.current !== 'window') setChat('window')
    void convo.send(text, 'text')
  }

  const removeFromScreen = (screenId: string, itemId: string) => {
    const s = screens.find((x) => x.id === screenId)
    const gone = screensApi.removeItem(screenId, itemId)
    if (!s || !gone) return null
    const title = widgetById(gone.widget)?.title ?? 'That widget'
    say(`Took ${title} off ${s.name}.`)
    const undo = () => screensApi.setItems(screenId, [...(screensApi.latest.current.find((x) => x.id === screenId)?.items ?? []), gone])
    return { gone, title, undo }
  }

  // ---- an agent asking before it does something ---------------------------------
  // Only the person's click answers (see PermissionPrompt). If the conversation is
  // tucked away as a button, it opens so the request can be seen.

  const [asks, setAsks] = useState<PermissionAsk[]>([])
  useEffect(() => {
    void window.mine.permissions.list().then(setAsks)
    const a = window.mine.permissions.onAsk((ask) => {
      setAsks((l) => [...l.filter((x) => x.id !== ask.id), ask])
      if (chatRef.current === 'button') setChat('window')
    })
    const b = window.mine.permissions.onDrop((id) => setAsks((l) => l.filter((x) => x.id !== id)))
    return () => (a(), b())
  }, [setChat])
  const [rules, setRules] = useState<PermissionRule[]>([])
  useEffect(() => {
    void window.mine.permissions.rules().then(setRules)
    return window.mine.permissions.onRules(setRules)
  }, [])
  // the person chose "Allow all" for the folder agents are working in
  const allowingAll = !!settings && rules.some((r) => r.tool === ALL && sameFolder(r.folder, settings.workdir))
  const stopAllowingAll = async () => {
    if (!settings) return
    await window.mine.permissions.stopAll(settings.workdir)
    say('Agents will ask again before doing things here.')
  }

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
      name: 'hands-free',
      title: 'Always listening',
      description:
        'Keep the microphone on so mine picks up whatever the person says as soon as they speak, with no Space or mic button. It all stays on this computer. Off goes back to tap to talk.',
      examples: ['always listen to me', 'turn on hands-free', 'stop listening all the time', 'go back to tap to talk'],
      params: {
        state: {
          description: 'On or off',
          options: [
            { value: 'on', description: 'Always listening' },
            { value: 'off', description: 'Tap to talk' },
          ],
        },
      },
      canUndo: true,
      run: async ({ state }) => {
        const on = state !== 'off'
        const was = !!settings?.handsFree
        await setAndKeep({ handsFree: on })
        return { say: on ? 'Listening for your voice' : 'Back to tap to talk', undo: () => void setAndKeep({ handsFree: was }) }
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
      name: 'show-conversation',
      title: 'Conversation size',
      description:
        'Change how the conversation shows: full screen, as a small window in the corner over the screen of widgets, or tucked away as a button in the corner.',
      examples: ['minimise the chat', 'open the chat window', 'make the conversation full screen', 'hide the conversation'],
      params: {
        size: {
          description: 'How the conversation shows',
          options: [
            { value: 'full', description: 'Full screen, covering the screen of widgets' },
            { value: 'window', description: 'A small window in the corner, over the screen' },
            { value: 'button', description: 'Just a button in the corner, out of the way' },
          ],
        },
      },
      canUndo: false,
      run: ({ size }) => {
        if (size !== 'full' && size !== 'window' && size !== 'button') throw new Error('Size is full, window or button.')
        setChat(size)
        return { quiet: true }
      },
    },
    ...(screens.length
      ? [
          {
            name: 'open-screen',
            title: 'Open a screen',
            description: 'Go to one of the person’s screens: pages of widgets they’ve arranged.',
            examples: [`open ${screens[0].name.toLowerCase()}`, 'go to my work screen', 'show my screen'],
            params: { screen: { description: 'Which screen', options: screens.map((s) => ({ value: s.id, description: s.name })) } },
            canUndo: false,
            run: ({ screen }: Record<string, string>) => {
              const s = screens.find((x) => x.id === screen)
              if (!s) throw new Error('There’s no screen like that.')
              openScreen(s.id)
              return { quiet: true }
            },
          } satisfies AppCommand,
          {
            name: 'rename-screen',
            title: 'Rename a screen',
            description: 'Give a screen a new name.',
            examples: ['rename this screen to Work', 'call this screen Mornings'],
            params: {
              name: { description: 'The new name', text: true, required: true },
              screen: { description: 'Which screen (the one showing, if not said)', options: screens.map((s) => ({ value: s.id, description: s.name })) },
            },
            canUndo: true,
            run: ({ name, screen }: Record<string, string>) => {
              const s = screens.find((x) => x.id === screen) ?? targetScreen()
              if (!s) throw new Error('There’s no screen to rename.')
              if (!name?.trim()) throw new Error('Say what to call it.')
              const was = s.name
              screensApi.rename(s.id, name)
              return { say: `Renamed ${was} to ${name.trim()}`, undo: () => screensApi.rename(s.id, was) }
            },
          } satisfies AppCommand,
          {
            name: 'delete-screen',
            title: 'Delete a screen',
            description: 'Delete one of the person’s screens and the widgets placed on it. Their data stays.',
            examples: ['delete this screen', 'get rid of the work screen', 'remove that screen'],
            params: { screen: { description: 'Which screen', options: screens.map((s) => ({ value: s.id, description: s.name })) } },
            canUndo: true,
            run: ({ screen }: Record<string, string>) => {
              const s = screens.find((x) => x.id === screen)
              if (!s) throw new Error('There’s no screen like that.')
              const undo = screensApi.remove(s.id)
              return { say: `Deleted ${s.name}`, undo }
            },
          } satisfies AppCommand,
        ]
      : []),
    {
      name: 'new-screen',
      title: 'New screen',
      description: 'Make a new, blank screen (a page to put widgets on and arrange) and go to it.',
      examples: ['make a new screen', 'new blank screen', 'create a screen', 'start a new page for widgets'],
      params: { name: { description: 'What to call it (optional)', text: true } },
      canUndo: false,
      run: ({ name }) => {
        const s = screensApi.create(name)
        openScreen(s.id)
        return { say: `Made ${s.name}`, quiet: true }
      },
    },
    ...(themes.some((t) => !t.error)
      ? [
          {
            name: 'apply-theme',
            title: 'Use a theme',
            description: 'Change mine’s whole look to one of the themes in the marketplace: mine’s own or the person’s.',
            examples: [`switch to the ${themes.find((t) => t.source === 'native' && t.name !== 'Bloom')?.name ?? 'Bloom'} theme`, 'use my brand theme', 'change the theme', 'go back to bloom'],
            params: {
              theme: {
                description: 'Which theme',
                options: themes.filter((t) => !t.error).map((t) => ({ value: t.id, description: `${t.name}: ${t.description.split(/(?<=\.)\s/)[0]}` })),
              },
            },
            canUndo: true,
            run: async ({ theme }: Record<string, string>) => {
              const t = themes.find((x) => x.id === theme)
              if (!t) throw new Error('There’s no theme like that.')
              const err = await window.mine.themes.apply(t.id)
              if (err) throw new Error(err)
              return { say: `Now using ${t.name}`, undo: () => void window.mine.theme.undo() }
            },
          } satisfies AppCommand,
        ]
      : []),
    {
      name: 'save-theme',
      title: 'Keep this look',
      description: 'Save the look mine has now as one of the person’s themes in the marketplace, to come back to later.',
      examples: ['save this theme', 'keep this look', 'add this theme to my themes'],
      params: { name: { description: 'What to call it (optional)', text: true } },
      canUndo: false,
      run: async ({ name }) => {
        const r = await window.mine.themes.saveCurrent(name)
        if (r.error) throw new Error(r.error)
        return { say: 'Saved to your themes' }
      },
    },
    ...(yourThemes.length
      ? [
          {
            name: 'remove-theme',
            title: 'Remove one of my themes',
            description: 'Take one of the person’s own themes out of the marketplace. It doesn’t change the look on screen.',
            examples: ['remove that theme', 'delete my old theme'],
            params: { theme: { description: 'Which of their themes', options: yourThemes.map((t) => ({ value: t.id, description: t.name })) } },
            canUndo: false,
            run: async ({ theme }: Record<string, string>) => {
              const t = yourThemes.find((x) => x.id === theme)
              if (!t) throw new Error('That isn’t one of your themes.')
              await window.mine.themes.remove(t.id)
              return { say: `Removed ${t.name}` }
            },
          } satisfies AppCommand,
        ]
      : []),
    {
      name: 'set-up-screen',
      title: 'Set up a screen around my day',
      description:
        'Open a blank screen where the person tells mine what they do day to day and which tools they use, so mine can work out what to connect and which widgets to add.',
      examples: ['help me set up my screen', 'set mine up for my work', 'what should I connect', 'start setting up'],
      params: {},
      canUndo: false,
      run: () => {
        const blank = screens.find((s) => !s.items.length) ?? screensApi.create()
        openScreen(blank.id)
        setTimeout(() => startRef.current?.focus(), 350)
        return { quiet: true }
      },
    },
    {
      name: 'show-connections',
      title: 'My tools',
      description:
        'Show the checklist of the tools the person is connecting to mine: what’s connected, the steps left for each, and syncs waiting for their OK.',
      examples: ['show my connections', 'what do I still need to connect', 'show the setup checklist', 'my tools'],
      params: {},
      canUndo: false,
      run: () => {
        revealSetupRef.current(true)
        if (!conns?.connections.length) {
          setMarketKind('connections')
          showStage({ kind: 'market' })
        }
        return { quiet: true }
      },
    },
    ...(conns?.services.length
      ? [
          {
            name: 'connect-tool',
            title: 'Connect a tool',
            description:
              'Put one of the tools the person uses (Jira, GitHub, Google Calendar, Slack...) on their connection checklist and show them the steps. The person signs in or pastes any token themselves.',
            examples: ['connect Jira', 'I want to connect my Google Calendar', 'add GitHub', 'hook up Linear'],
            params: {
              service: { description: 'Which tool', options: conns.services.map((s) => ({ value: s.id, description: `${s.name}: ${s.what}` })) },
            },
            canUndo: true,
            run: async ({ service }: Record<string, string>) => {
              const s = conns.services.find((x) => x.id === service)
              if (!s) throw new Error('mine doesn’t know that tool yet. Ask your agent to connect it.')
              const existed = conns.connections.some((c) => c.service === s.id)
              const r = await window.mine.connections.add(s.id)
              if (!r.ok) throw new Error(r.error)
              revealSetupRef.current(true)
              return existed
                ? { say: `${s.name} is already on your list` }
                : { say: `Added ${s.name} to your checklist`, undo: () => void window.mine.connections.remove(r.value) }
            },
          } satisfies AppCommand,
        ]
      : []),
    ...(conns?.connections.some((c) => c.way.auth === 'oauth' && c.status !== 'connected')
      ? [
          {
            name: 'sign-in-to-tool',
            title: 'Sign in to a tool',
            description: 'Start signing in to one of the person’s tools on that tool’s own page in the browser, for the ones on their checklist that connect by signing in.',
            examples: ['sign in to Linear', 'log in to Jira', 'connect my Notion account'],
            params: {
              connection: {
                description: 'Which tool',
                options: conns.connections.filter((c) => c.way.auth === 'oauth' && c.status !== 'connected').map((c) => ({ value: c.id, description: c.name })),
              },
            },
            canUndo: false,
            run: ({ connection }: Record<string, string>) => {
              const c = conns.connections.find((x) => x.id === connection)
              if (!c) throw new Error('That isn’t on your list.')
              void window.mine.connections.signIn(c.id)
              revealSetupRef.current(true)
              return { say: `Opening ${c.name} in your browser` }
            },
          } satisfies AppCommand,
        ]
      : []),
    ...(conns?.connections.length
      ? [
          {
            name: 'disconnect-tool',
            title: 'Disconnect a tool',
            description: 'Disconnect one of the person’s tools from mine: forget its sign-in or token, stop its syncs, and take what it synced out of their widgets.',
            examples: ['disconnect Jira', 'remove the GitHub connection', 'forget my calendar'],
            params: { connection: { description: 'Which tool', options: conns.connections.map((c) => ({ value: c.id, description: c.name })) } },
            canUndo: false,
            run: async ({ connection }: Record<string, string>) => {
              const c = conns.connections.find((x) => x.id === connection)
              if (!c) throw new Error('That isn’t connected.')
              const r = await window.mine.connections.remove(c.id)
              if (!r.ok) throw new Error(r.error)
              return { say: `Disconnected ${c.name}` }
            },
          } satisfies AppCommand,
        ]
      : []),
    ...(conns?.sources.some((s) => s.approved)
      ? [
          {
            name: 'sync-now',
            title: 'Sync my tools now',
            description: 'Fetch fresh data now from the person’s connected tools (all of them, or one) instead of waiting for the next sync.',
            examples: ['sync now', 'refresh my Jira issues', 'update my calendar'],
            params: {
              connection: {
                description: 'Which tool',
                options: [
                  { value: 'all', description: 'All of them' },
                  ...conns.connections.filter((c) => c.status === 'connected').map((c) => ({ value: c.id, description: c.name })),
                ],
              },
            },
            canUndo: false,
            run: async ({ connection }: Record<string, string>) => {
              const r = await window.mine.connections.sync(connection && connection !== 'all' ? connection : undefined)
              if (!r.ok) throw new Error(r.error)
              return { say: r.value ? `Synced ${r.value} ${r.value === 1 ? 'source' : 'sources'}` : 'Nothing to sync yet' }
            },
          } satisfies AppCommand,
          {
            name: 'stop-syncing',
            title: 'Stop a sync',
            description: 'Stop one of the syncs that pulls data from a connected tool, and take what it brought in out of the widgets. The tool stays connected.',
            examples: ['stop syncing my GitHub issues', 'turn off the calendar sync', 'stop pulling Jira issues'],
            params: { source: { description: 'Which sync', options: conns.sources.map((s) => ({ value: s.id, description: s.title })) } },
            canUndo: false,
            run: async ({ source }: Record<string, string>) => {
              const s = conns.sources.find((x) => x.id === source)
              if (!s) throw new Error('There’s no sync like that.')
              const r = await window.mine.connections.removeSource(s.id)
              if (!r.ok) throw new Error(r.error)
              return { say: `Stopped ${s.title}` }
            },
          } satisfies AppCommand,
        ]
      : []),
    {
      name: 'open-marketplace',
      title: 'Widget marketplace',
      description:
        'Show the marketplace: widgets (mine’s own and the person’s, running on sample data to try before adding to a screen), themes (whole looks for mine), or connections (tools like Jira or Google Calendar to connect).',
      examples: ['show the widget marketplace', 'browse widgets', 'show me the themes', 'what tools can I connect'],
      params: {
        what: {
          description: 'Widgets, themes or connections',
          options: [
            { value: 'widgets', description: 'Widgets: cards to put on a screen' },
            { value: 'themes', description: 'Themes: whole looks for mine, colours and fonts' },
            { value: 'connections', description: 'Connections: the tools the person uses, to join to mine' },
          ],
        },
        show: {
          description: 'Which widgets',
          options: [
            { value: 'all', description: 'All of them' },
            { value: 'native', description: 'The ones that come with mine' },
            { value: 'yours', description: 'The person’s own, made by their agent' },
          ],
        },
      },
      canUndo: false,
      run: ({ show, what }) => {
        setMarket(show === 'native' || show === 'yours' ? show : 'all')
        setMarketKind(what === 'themes' ? 'themes' : what === 'connections' ? 'connections' : 'widgets')
        showStage({ kind: 'market' })
        return { quiet: true }
      },
    },
    ...(widgets.some((w) => w.approved && !w.error)
      ? [
          {
            name: 'add-widget',
            title: 'Add a widget to a screen',
            description: 'Put a widget on the screen that’s showing (or the last one used), at the first free spot, and show it.',
            examples: ['add the clock to this screen', 'put my to-dos on the screen', 'pin the habits widget here'],
            params: {
              widget: {
                description: 'Which widget',
                options: widgets
                  .filter((w) => w.approved && !w.error)
                  .map((w) => ({ value: w.id, description: `${w.title}: ${w.description.split(/(?<=\.)\s/)[0]}` })),
              },
            },
            canUndo: true,
            run: ({ widget }: Record<string, string>) => {
              const { screen, item, widget: w } = addToScreen(widget)
              openScreen(screen.id)
              return { say: `Added ${w.title} to ${screen.name}`, undo: () => void screensApi.removeItem(screen.id, item.id) }
            },
          } satisfies AppCommand,
        ]
      : []),
    ...(currentScreen?.items.length
      ? (() => {
          const s = currentScreen
          const items = s.items.map((i) => ({ value: i.id, description: `${widgetById(i.widget)?.title ?? i.widget} (${whereIs(i, s.items)})` }))
          return [
            {
              name: 'remove-from-screen',
              title: 'Take a widget off the screen',
              description: `Take a widget off the ${s.name} screen. Its data stays.`,
              examples: ['take the clock off', 'remove the notes from this screen', 'get rid of that widget'],
              params: { item: { description: 'Which widget on the screen', options: items } } as AppCommand['params'],
              canUndo: true,
              run: ({ item }: Record<string, string>) => {
                const r = removeFromScreen(s.id, item)
                if (!r) throw new Error('That widget isn’t on this screen.')
                return { say: `Took ${r.title} off ${s.name}`, undo: r.undo }
              },
            } satisfies AppCommand,
            {
              name: 'arrange-widget',
              title: 'Move or resize a widget',
              description: `Make a widget on the ${s.name} screen bigger or smaller, or move it to an edge. Others slide out of the way.`,
              examples: ['make the clock bigger', 'move the notes to the right', 'make the to-dos taller', 'put the timer at the top'],
              params: {
                item: { description: 'Which widget on the screen', options: items },
                how: { description: 'What to do with it', options: Object.entries(ARRANGE).map(([value, description]) => ({ value, description })) },
              } as AppCommand['params'],
              canUndo: true,
              run: ({ item, how }: Record<string, string>) => {
                const it = s.items.find((i) => i.id === item)
                if (!it) throw new Error('That widget isn’t on this screen.')
                if (!(how in ARRANGE)) throw new Error('Say bigger, smaller, wider, narrower, taller, shorter, or an edge.')
                const way = how as keyof typeof ARRANGE
                const min = widgetById(it.widget)?.minSize ?? { w: 1, h: 1 }
                const before = s.items
                screensApi.setItems(s.id, settle(before.map((i) => (i.id === it.id ? arranged(it, way, min, before) : i)), it.id))
                return { say: `${ARRANGE[way]}: ${widgetById(it.widget)?.title ?? 'done'}`, undo: () => screensApi.setItems(s.id, before) }
              },
            } satisfies AppCommand,
          ]
        })()
      : []),
    {
      name: 'allowed-actions',
      title: 'What agents can do without asking',
      description: 'List what the person has always allowed agents to do without asking (commands, edits, sites), by folder.',
      examples: ['what have I always allowed', 'show allowed commands', 'what can the agent do without asking'],
      params: {},
      canUndo: false,
      run: async () => {
        const rules = await window.mine.permissions.rules()
        if (!rules.length) return { say: 'Nothing yet. Agents ask before anything beyond reading files.' }
        return {
          say: `${rules.length} always allowed`,
          view: { type: 'list', items: rules.map((r) => ({ label: describeRule(r).replace(/`/g, ''), value: r.folder })) },
        }
      },
    },
    ...(allowingAll
      ? [
          {
            name: 'stop-allowing-all',
            title: 'Make agents ask again',
            description: 'Turn off “allow all” for this folder, so agents ask before running commands, editing files or fetching pages. Anything always allowed on its own stays.',
            examples: ['stop allowing everything', 'make the agent ask first', 'turn off allow all'],
            params: {},
            canUndo: false,
            run: async () => {
              await stopAllowingAll()
              return { quiet: true }
            },
          } satisfies AppCommand,
        ]
      : []),
    {
      name: 'forget-allowed',
      title: 'Forget what’s always allowed',
      description: 'Forget what the person always allowed agents to do, so they ask again. In the current folder, or everywhere.',
      examples: ['forget what I always allowed', 'make the agent ask again', 'reset permissions'],
      params: {
        where: {
          description: 'Where to forget it',
          options: [
            { value: 'here', description: 'Only in the folder agents are working in now' },
            { value: 'everywhere', description: 'In every folder' },
          ],
        },
      },
      canUndo: false,
      run: async ({ where }) => {
        const left = await window.mine.permissions.forget(where === 'everywhere' ? undefined : settings?.workdir)
        return { say: where === 'everywhere' ? 'Agents will ask again for everything.' : `Agents will ask again in this folder. ${left.length} kept elsewhere.` }
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
  const speech = useSpeech(voiceRef, (text) => void route(text, 'voice'), !!settings?.handsFree)
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

  // from a widget in the conversation: pin it, then show where it went
  const addRef = useRef((_w: string, _p?: Record<string, unknown>) => {})
  addRef.current = (widget, props) => {
    try {
      const { screen, widget: w } = addToScreen(widget, undefined, props)
      openScreen(screen.id)
      say(`Added ${w.title} to ${screen.name}.`)
    } catch (err) {
      say((err as Error).message)
    }
  }

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
      addToScreen: (widget, props) => addRef.current(widget, props),
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
      if (!harness || setup || explorerOpen.current) return
      // Ctrl+J: the conversation steps aside for the screen, and comes back
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        const c = chatRef.current
        setChat(c === 'full' ? docked.current : c === 'button' ? 'window' : 'button')
        if (c === 'button') setTimeout(() => dockInputRef.current?.focus(), 60)
        return
      }
      if (typingInto(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      const onButton = (e.target as HTMLElement | null)?.closest('button, [role="combobox"], [role="radio"]')
      // over a screen: Space still talks, and typing opens the window to type into
      if (chatRef.current !== 'full') {
        if (e.key === ' ' && !onButton) {
          e.preventDefault()
          void speech.toggle()
        } else if (e.key.length === 1 && e.key !== ' ' && speech.mic !== 'listening') {
          e.preventDefault()
          setDraft((d) => d + e.key)
          if (chatRef.current === 'button') setChat('window')
          setTimeout(() => dockInputRef.current?.focus(), 60)
        }
        return
      }
      if (mode !== 'voice') return
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
  }, [harness, setup, mode, speech, switchTo, setChat, convo.running, convo.stop])

  const ready = harnesses !== null && settings !== null
  const empty = convo.turns.length === 0
  const inApp = ready && !!harness && !setup && screensApi.screens !== null
  const full = chat === 'full' || !inApp
  const firstSaid = convo.turns.find((t) => t.kind === 'user')
  const chatTitle = firstSaid?.kind === 'user' ? firstSaid.text.replace(/\s+/g, ' ').trim() : 'Conversation'
  const note = speech.note ?? flash ?? (convo.queued ? `Up next: ${convo.queued.text}` : null)

  // what sits behind the conversation: a screen, the marketplace, or a way to start
  const backTo = screens.find((s) => s.id === lastScreen.current) ?? screens[0]
  const stageView =
    stage?.kind === 'setup' ? (
      <ScreenStart
        name={backTo?.name ?? 'your screen'}
        state={conns}
        onTell={tellMine}
        onBack={() => (backTo ? openScreen(backTo.id) : setStage(null))}
        onBrowse={() => {
          setMarketKind('widgets')
          showStage({ kind: 'market' })
        }}
        onConnect={() => {
          setMarketKind('connections')
          showStage({ kind: 'market' })
        }}
      />
    ) : stage?.kind === 'market' ? (
      <Marketplace
        widgets={widgets}
        screens={screens}
        target={targetScreen()}
        filter={market}
        onFilter={setMarket}
        kind={marketKind}
        onKind={setMarketKind}
        themeCounts={{ all: themes.length, native: themes.length - yourThemes.length, yours: yourThemes.length }}
        themes={
          <ThemeShelf
            themes={themes}
            current={look}
            filter={market}
            onApply={async (t) => {
              const err = await window.mine.themes.apply(t.id)
              if (err) say(err)
            }}
            onSaveCurrent={async () => {
              const r = await window.mine.themes.saveCurrent()
              say(r.error ? r.error : 'Saved to your themes.')
            }}
            onRemove={(t) => void window.mine.themes.remove(t.id)}
          />
        }
        connections={conns ? <ServiceShelf state={conns} /> : null}
        onAdd={(widget, screen) => {
          try {
            return addToScreen(widget, screen).screen.id
          } catch (err) {
            say((err as Error).message)
            return null
          }
        }}
        onOpenScreen={openScreen}
      />
    ) : currentScreen ? (
      <ScreenGrid
        key={currentScreen.id}
        screen={currentScreen}
        onItems={(items) => screensApi.setItems(currentScreen.id, items)}
        onRemoveItem={(id) => void removeFromScreen(currentScreen.id, id)}
        onBrowse={() => showStage({ kind: 'market' })}
        notice={conns && !later ? <SetupNotice state={conns} onOpen={openTools} onLater={() => setLater(true)} /> : null}
        intro={
          <ScreenStart
            name={currentScreen.name}
            state={conns}
            inputRef={startRef}
            onTell={tellMine}
            onBrowse={() => {
              setMarketKind('widgets')
              showStage({ kind: 'market' })
            }}
            onConnect={() => {
              setMarketKind('connections')
              showStage({ kind: 'market' })
            }}
          />
        }
      />
    ) : (
      <div className="grid h-full place-items-center px-6">
        <div className="flex max-w-[28rem] flex-col items-center text-center">
          <LayoutDashboard className="size-7 text-bloom-deep" strokeWidth={1.5} aria-hidden="true" />
          <h2 className="mt-4 font-display text-[1.75rem] leading-tight font-semibold tracking-[-0.03em]">No screens yet.</h2>
          <p className="mt-2 font-serif text-[1.0625rem] text-muted-foreground">
            A screen is a blank page for widgets. Put the ones you use on it and arrange them however you like.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => openScreen(screensApi.create().id)}
              className="flex h-10 items-center gap-2 rounded-full bg-solid px-4 text-sm font-semibold text-on-solid transition-colors hover:bg-solid-hover"
            >
              <Plus className="size-4" />
              New screen
            </button>
            <button
              type="button"
              onClick={() => showStage({ kind: 'market' })}
              className="flex h-10 items-center gap-2 rounded-full border border-rule px-4 text-sm font-semibold transition-colors hover:bg-paper-2"
            >
              <Store className="size-4" />
              Browse widgets
            </button>
          </div>
        </div>
      </div>
    )

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
          screens={
            inApp ? (
              <ScreenSwitcher
                screens={screens}
                stage={stage}
                showing={!full}
                onOpen={openScreen}
                onCreate={() => openScreen(screensApi.create().id)}
                onRename={screensApi.rename}
                onDelete={(id) => {
                  const s = screens.find((x) => x.id === id)
                  screensApi.remove(id)
                  if (s) say(`Deleted ${s.name}.`)
                }}
                onMarket={() => showStage({ kind: 'market' })}
              />
            ) : undefined
          }
          setup={
            inApp && conns?.connections.length ? (
              <button
                type="button"
                onClick={() => {
                  // a second click goes back to the screen
                  if (stage?.kind === 'setup' && !full) return backTo ? openScreen(backTo.id) : undefined
                  revealSetupRef.current(true)
                }}
                aria-pressed={stage?.kind === 'setup' && !full}
                aria-label={left.total ? `Your tools: ${left.total} ${left.total === 1 ? 'thing' : 'things'} to set up` : 'Your tools'}
                title={left.total ? `${left.total} to set up` : 'Your tools'}
                className={cn(
                  'flex h-7 items-center gap-1 rounded-full px-2 font-mono text-[11px] font-semibold transition-colors',
                  left.total ? 'bg-bloom-wash text-ink hover:bg-bloom-wash/70' : 'text-muted-foreground hover:bg-paper-2 hover:text-ink',
                )}
              >
                <Plug className="size-3.5" />
                {left.total ? left.total : null}
              </button>
            ) : undefined
          }
          onMinimise={inApp && chat === 'full' ? () => setChat(docked.current) : undefined}
          onStopAllowAll={allowingAll ? () => void stopAllowingAll() : undefined}
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
          <div className="relative min-h-0 flex-1">
            {/* the screen stays alive behind a full conversation, so widgets keep their state */}
            {(stage || !full) && inApp && (
              <div className={cn('absolute inset-0', full && 'invisible')} inert={full}>
                {stageView}
              </div>
            )}
            {!full && (
              <ChatDock
                state={chat as DockState}
                onState={setChat}
                onFull={() => setChat('full')}
                turns={convo.turns}
                title={chatTitle}
                harness={harness.name}
                running={convo.running}
                mic={speech.look}
                flash={flash}
                voiceRef={voiceRef}
                conversation={
                  <Conversation
                    compact
                    turns={convo.turns}
                    harness={harness.name}
                    onStopTool={(id) => void convo.stopTool(id)}
                    onUndo={(id) => void convo.undoLocal(id)}
                    onHand={(id) => void convo.handToAgent(id)}
                    onSetView={convo.setView}
                  />
                }
                composer={
                  <>
                    {asks.length > 0 && (
                      <div className="scroll-soft flex max-h-[60%] shrink-0 flex-col gap-2 overflow-y-auto border-t border-rule/70 px-2.5 pt-2.5">
                        {asks.map((a) => (
                          <PermissionPrompt key={a.id} ask={a} compact />
                        ))}
                      </div>
                    )}
                    <DockComposer
                    ref={dockInputRef}
                    draft={draft}
                    setDraft={setDraft}
                    running={convo.running}
                    harness={harness.name}
                    mic={speech.look}
                    note={note}
                    voiceRef={voiceRef}
                    onSend={sendDraft}
                    onStop={convo.stop}
                    onMic={() => void speech.toggle()}
                  />
                  </>
                }
              />
            )}
            {full && (
          <main className="absolute inset-0 flex flex-col bg-paper" style={{ viewTransitionName: 'mine-chat' }}>
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
              {asks.length > 0 && (
                <div className="mx-auto mb-3 flex w-full max-w-[42rem] flex-col gap-2 px-6">
                  {asks.map((a) => (
                    <PermissionPrompt key={a.id} ask={a} />
                  ))}
                </div>
              )}
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
                      mic={speech.look}
                      note={speech.note ?? flash}
                      running={convo.running}
                      harness={harness.name}
                      compact={!empty}
                      ears={speech.ears}
                      handsFree={!!settings?.handsFree}
                      onHandsFree={(on) => void setAndKeep({ handsFree: on })}
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
        )}
      </div>
    </AbilitiesContext.Provider>
  )
}
