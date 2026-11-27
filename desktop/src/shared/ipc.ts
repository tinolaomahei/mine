// The contract between the main process and the window. Everything the UI can
// ask of the machine goes through these types, and nothing else is exposed.

import type { DecisionsSettings, DecisionsStatus, DecisionsTest, RouteContext, RouteResult } from './decisions'
import type { Theme } from './theme'
import type { AppCommandInfo, CommandEffect, CommandResult, CommandsState, FileListing, FilePreview, FileSaved } from './commands'
import type { WidgetInfo } from './widgets'

export type HarnessId = 'pi' | 'claude' | 'codex' | 'gemini' | 'opencode' | 'goose' | 'cursor'

export type HarnessInfo = {
  id: HarnessId
  name: string
  vendor: string
  blurb: string
  found: boolean
  path?: string
  version?: string
  /** Output is parsed into a live stream (rather than plain text at the end). */
  streams: boolean
}

export type ThemePref = 'system' | 'light' | 'dark'

export type Settings = {
  harness: HarnessId | null
  /** Follow the OS, or force light or dark. */
  theme: ThemePref
  /** Folder the harness runs in. Agents read and write files relative to it. */
  workdir: string
  /** The fast decisions layer. null (or missing) until the person has been asked. */
  decisions?: DecisionsSettings | null
}

export type SpeechStatus =
  | { state: 'missing'; model: string; bytes: number }
  | { state: 'downloading'; model: string; bytes: number; received: number }
  | { state: 'ready'; model: string }
  | { state: 'error'; model: string; message: string }

export type RunRequest = {
  runId: string
  prompt: string
  /** Harness-specific handle for continuing the same conversation. */
  sessionRef?: string
}

export type AgentEvent = { runId: string } & (
  | { type: 'session'; ref: string }
  | { type: 'delta'; text: string }
  /** A tool call started, or its input became known (same id). */
  | { type: 'tool'; id: string; name: string; input?: unknown }
  /** Live output so far (replaces earlier output). */
  | { type: 'tool-output'; id: string; text: string }
  | { type: 'tool-end'; id: string; ok: boolean; output?: string }
  | { type: 'done' }
  | { type: 'error'; message: string }
)

export type ThemeState = {
  theme: Theme
  canUndo: boolean
  /** Set when theme.json is broken; the last good theme stays on screen. */
  error?: string
}

/** A saved conversation. Turns are the window's own shape; main only stores them. */
export type ConversationRecord = {
  id: string
  title: string
  /** The agent it was last talking to. */
  harness: HarnessId | null
  /** The folder it ran in. Claude Code sessions only resume from the same folder. */
  workdir: string
  createdAt: number
  updatedAt: number
  /** Each harness's own session handle, so reopening continues the same thread. */
  sessions: Partial<Record<HarnessId, string>>
  turns: unknown[]
}

export type ConversationSummary = Pick<ConversationRecord, 'id' | 'title' | 'harness' | 'workdir' | 'createdAt' | 'updatedAt'> & {
  messages: number
}

export type Unsubscribe = () => void

export interface MineApi {
  platform: 'win32' | 'darwin' | 'linux' | (string & {})
  harness: {
    detect(): Promise<HarnessInfo[]>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
    pickWorkdir(): Promise<Settings>
    onChange(cb: (s: Settings) => void): Unsubscribe
  }
  conversations: {
    list(): Promise<ConversationSummary[]>
    /** null if it's gone. workdirExists says whether its folder is still there. */
    get(id: string): Promise<{ record: ConversationRecord; workdirExists: boolean } | null>
    save(record: ConversationRecord): Promise<void>
    remove(id: string): Promise<void>
  }
  commands: {
    list(): Promise<CommandsState>
    /** Run any command by name: mine's own (handled by this window) or the person's. */
    run(name: string, params: Record<string, string>, said?: string): Promise<CommandResult>
    undo(name: string, undoState: unknown): Promise<{ ok: boolean; say?: string; error?: string }>
    approve(name: string): Promise<CommandsState>
    remove(name: string): Promise<void>
    /** Open the commands folder, or show a file in it. */
    reveal(path?: string): Promise<void>
    /** Tell main which of mine's own features exist, so the router and agents can use them. */
    registerApp(infos: AppCommandInfo[]): Promise<void>
    /** Main (for an agent) asking this window to run one of mine's own features. */
    onInvoke(cb: (req: { id: number; name: string; params: Record<string, string>; said: string }) => void): Unsubscribe
    invokeDone(id: number, result: CommandResult): Promise<void>
    onChange(cb: (s: CommandsState) => void): Unsubscribe
    onEffect(cb: (e: CommandEffect) => void): Unsubscribe
  }
  widgets: {
    list(): Promise<WidgetInfo[]>
    approve(name: string): Promise<WidgetInfo[]>
    remove(name: string): Promise<WidgetInfo[]>
    reveal(name: string): Promise<void>
    onChange(cb: (w: WidgetInfo[]) => void): Unsubscribe
    /** An agent or command asking to show a widget. */
    onShow(cb: (req: { name: string; props: Record<string, unknown> }) => void): Unsubscribe
  }
  files: {
    /** One folder's contents, folders first. */
    list(path: string): Promise<FileListing>
    /** Read a file for preview. */
    read(path: string): Promise<FilePreview>
    /** Open it in its default app. */
    open(path: string): Promise<string>
    /** Save text to a file; refuses if it changed on disk since `expected` unless forced. */
    write(path: string, text: string, expected?: number, force?: boolean): Promise<FileSaved>
  }
  /** Keys mine takes over from the default menu (Ctrl+W closes a tab, not the window, in the explorer). */
  onShortcut(cb: (name: 'close-tab') => void): Unsubscribe
  data: {
    call(method: 'collections' | 'list' | 'get' | 'put' | 'patch' | 'remove', args: unknown[]): Promise<unknown>
    onChange(cb: (collection: string) => void): Unsubscribe
  }
  decisions: {
    status(): Promise<DecisionsStatus>
    /** Test with one real request and save only if it works. Omit key to reuse the saved one. */
    save(settings: DecisionsSettings, key?: string): Promise<DecisionsTest>
    route(text: string, ctx: RouteContext): Promise<RouteResult>
  }
  theme: {
    get(): Promise<ThemeState>
    undo(): Promise<boolean>
    reset(): Promise<void>
    onChange(cb: (t: ThemeState) => void): Unsubscribe
  }
  speech: {
    status(): Promise<SpeechStatus>
    prepare(): Promise<SpeechStatus>
    transcribe(samples: Float32Array): Promise<string>
    onStatus(cb: (s: SpeechStatus) => void): Unsubscribe
  }
  agent: {
    run(req: RunRequest): Promise<void>
    cancel(runId: string): Promise<void>
    /** Stop one running command and let the agent carry on. False if it couldn't be found. */
    stopTool(runId: string, toolId: string): Promise<boolean>
    onEvent(cb: (e: AgentEvent) => void): Unsubscribe
  }
}
