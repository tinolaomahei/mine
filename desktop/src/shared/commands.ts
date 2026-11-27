// Commands: things mine can do instantly, registered at runtime. Each is one
// JavaScript file in userData/commands. The decisions model picks the command
// and its choice parameters; the file's run() does the work and can show a
// view inside the conversation.

export type CommandParam = {
  description: string
  /** Fixed choices. Missing when the options are worked out at the time (dynamic). */
  options?: { value: string; description: string }[]
  dynamic?: boolean
}

export type CommandInfo = {
  name: string
  title: string
  description: string
  examples: string[]
  params: Record<string, CommandParam>
  canUndo: boolean
  /** 'app' for mine's own features, 'yours' for files in the commands folder. */
  source: 'app' | 'yours'
  file?: string
}

/** What the window registers for each of mine's own features. */
export type AppCommandInfo = Omit<CommandInfo, 'source' | 'file'>

export type CommandsState = {
  dir: string
  /** mine's own features, registered by the window. */
  app: CommandInfo[]
  /** The person's commands, from the commands folder. */
  commands: CommandInfo[]
  /** Files that failed to load, and why. */
  errors: { file: string; message: string }[]
  /** New or changed files waiting for the person's OK. They don't load until then. */
  pending: { name: string; file: string; source: string }[]
}

export type FileEntry = { name: string; path: string; kind: 'dir' | 'file'; size?: number; modified?: number }

/** Something a command shows inside the conversation. */
export type CommandView =
  | {
      type: 'files'
      path: string
      parent?: string
      entries: FileEntry[]
      /** Clicking a folder runs this command with { [param]: folderPath }, in place. */
      open?: { command: string; param: string }
      /** How many entries were left out. */
      more?: number
    }
  | { type: 'table'; columns: string[]; rows: (string | number | null)[][]; caption?: string }
  | { type: 'list'; items: { label: string; value?: string }[] }
  | { type: 'markdown'; text: string }
  /** Static HTML, no scripts. mine's theme variables (var(--ink), var(--bloom)…) are available. */
  | { type: 'html'; html: string; height?: number }
  /** One file's contents: text with line numbers, Markdown rendered, images shown. */
  | { type: 'file'; path: string }
  /** A widget, live and interactive. props reach it as mine.props. */
  | { type: 'widget'; name: string; props?: Record<string, unknown> }

/** How saving a file went. A conflict means it changed on disk since it was opened. */
export type FileSaved = { ok: true; modified: number } | { ok: false; conflict?: boolean; error: string }

/** One folder's contents. */
export type FileListing = { path: string; parent?: string; entries: FileEntry[]; more?: number; error?: string }

/** A file read for preview. */
export type FilePreview =
  | { kind: 'text'; path: string; size: number; modified: number; text: string; truncated: boolean; ext: string; bom?: boolean }
  | { kind: 'image'; path: string; size: number; modified: number; src: string }
  | { kind: 'binary'; path: string; size: number; modified: number }
  | { kind: 'error'; path: string; message: string }

export type CommandResult =
  | { ok: true; say?: string; view?: CommandView; undoState?: unknown; canUndo: boolean; ms: number }
  | { ok: false; error: string }

/** Things a command asks the window itself to do. */
export type CommandEffect = { type: 'new-conversation' } | { type: 'stop-agent' } | { type: 'send-to-agent'; text: string }

export const COMMAND_NAME = /^[a-z0-9][a-z0-9-]{0,47}$/

/** How to write a command. Shown to agents. */
export const COMMAND_GUIDE = `A mine command is one CommonJS file, <name>.js, where name is lowercase-with-dashes. It runs in a Node.js process (require('node:fs') etc. all work) and controls mine through the mine object it's given.

module.exports = {
  title: 'Minimize window',                       // short, shown in the conversation
  description: 'Minimize the mine window.',       // what it does; the decisions model reads this to pick it
  examples: ['minimize the window', 'hide mine'],  // 2-5 ways a person might say it
  params: {                                        // optional. Every param is a choice; nothing free-text
    corner: {
      description: 'Which corner to move the window to',
      options: { 'top-left': 'Top left corner', 'bottom-right': 'Bottom right corner' },
      // or a function for options that depend on the moment, e.g. subfolders:
      // options: async ({ workdir }) => ({ src: 'the src folder', docs: 'the docs folder' }),
    },
  },
  async run({ params, said, workdir, appearance, platform }, mine) {
    await mine.window.minimize()
    return { say: 'Minimized.' }                   // say: one short line for the conversation
  },
  // optional: return { undoState } from run, and mine shows an Undo button that calls this
  // async undo(undoState, ctx, mine) { ... },
}

run() may return { say, view, undoState }. view shows inside the conversation:
- { type: 'files', path, parent, entries: [{ name, path, kind: 'dir'|'file', size, modified }], open: { command: 'show-folder', param: 'path' } }
- { type: 'table', columns: ['A','B'], rows: [['1','2']], caption }
- { type: 'list', items: [{ label, value }] }
- { type: 'file', path }   one file's contents (text, Markdown or image)
- { type: 'markdown', text }
- { type: 'html', html, height }   static HTML and CSS, no scripts; use mine's theme variables, e.g. var(--paper), var(--ink), var(--muted-ink), var(--rule), var(--bloom), var(--bloom-deep), var(--font-ui), var(--font-mono)
Throw an Error with a plain message when something's wrong; the person sees it.

The mine object (every call is async):
- mine.window.<any Electron BrowserWindow method>(...args): minimize, maximize, unmaximize, restore, isMaximized, setFullScreen(bool), setAlwaysOnTop(bool), setSize(w, h), center, setOpacity(0-1), focus, getBounds, setBounds({...})
- mine.workdir.get() / mine.workdir.set(path)   the folder agents work in
- mine.settings.get() / mine.settings.set(patch)
- mine.appearance(mode)   'light' | 'dark' | 'system'
- mine.theme.get() / mine.theme.set(patch) / mine.theme.undo() / mine.theme.reset()
- mine.shell.openPath(path) / mine.shell.openExternal(url) / mine.shell.showItemInFolder(path)
- mine.clipboard.readText() / mine.clipboard.writeText(text)
- mine.notify(title, body)
- mine.conversation.new() / mine.agent.stop() / mine.agent.send(text)   send hands text to the agent as a message
- mine.exec(commandLine, { cwd })   runs a shell command; resolves { stdout, stderr, code }

run() has 15 seconds. Keep it deterministic and quick; it's meant to happen instantly.`
