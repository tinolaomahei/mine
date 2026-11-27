import { watch, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, ipcMain, nativeTheme, type BrowserWindow } from 'electron'
import { parseColor, toHex } from '@shared/color'
import { resolveTheme, type Theme } from '@shared/theme'
import type { ThemeState } from '@shared/ipc'
import { history, loadPatch, resetPatch, themeFile, undoPatch } from './theme-store'
import { reloadSettings } from './settings'
import { COMMAND_GUIDE } from '@shared/commands'
import { WIDGET_GUIDE } from '@shared/widgets'

// Keeps the window in step with theme.json and settings.json. Whoever edits
// them (the app, the MCP server, or an agent writing the file directly), the
// window updates within a moment.

const dir = () => app.getPath('userData')

export function themeState(): ThemeState {
  const { patch, error } = loadPatch(dir())
  return { theme: resolveTheme(patch), canUndo: history(dir()).length > 0, error }
}

/** Native frame colours (title bar buttons, window background) as hex. */
export function frameColors(theme: Theme = themeState().theme) {
  const pal = nativeTheme.shouldUseDarkColors ? theme.dark : theme.light
  const hex = (c: string, fallback: string) => {
    const rgb = parseColor(c)
    return rgb ? toHex(rgb) : fallback
  }
  return { paper: hex(pal.background, '#fdf1f6'), ink: hex(pal.text, '#261224') }
}

export function watchTheme(getWin: () => BrowserWindow | undefined) {
  const repaint = () => {
    const win = getWin()
    if (!win) return
    const f = frameColors()
    win.setBackgroundColor(f.paper)
    if (process.platform !== 'darwin') win.setTitleBarOverlay({ color: f.paper, symbolColor: f.ink, height: 48 })
  }

  const timers = new Map<string, NodeJS.Timeout>()
  const debounce = (key: string, fn: () => void) => {
    clearTimeout(timers.get(key))
    timers.set(key, setTimeout(fn, 80))
  }

  watch(dir(), (_event, name) => {
    if (name === 'theme.json') {
      debounce('theme', () => {
        getWin()?.webContents.send('theme:changed', themeState())
        repaint()
      })
    } else if (name === 'settings.json') {
      debounce('settings', () => {
        const s = reloadSettings()
        if (nativeTheme.themeSource !== s.theme) nativeTheme.themeSource = s.theme
        getWin()?.webContents.send('settings:changed', s)
      })
    }
  })

  nativeTheme.on('updated', repaint)

  ipcMain.handle('theme:get', () => themeState())
  ipcMain.handle('theme:undo', () => undoPatch(dir()))
  ipcMain.handle('theme:reset', () => resetPatch(dir()))
}

/** What every agent run gets told about the app it is running inside. */
export function agentContext(pipe?: { path: string; token: string }) {
  const d = dir()
  const mcpConfig = join(d, 'mcp.json')
  writeFileSync(
    mcpConfig,
    JSON.stringify(
      {
        mcpServers: {
          mine: {
            type: 'stdio',
            command: process.execPath,
            args: [join(__dirname, 'theme-mcp.js')],
            env: { ELECTRON_RUN_AS_NODE: '1', MINE_DIR: d, ...(pipe ? { MINE_PIPE: pipe.path, MINE_TOKEN: pipe.token } : {}) },
          },
        },
      },
      null,
      2,
    ),
  )

  const common = `You are running inside mine, a desktop app. The person talks to you by voice (transcribed, so expect the odd misheard word) or by typing, and reads your replies in a chat view that renders Markdown. Keep replies short and plain.

mine's own look is live and yours to change. Colours (separate light and dark palettes), fonts and corner radius are a theme that applies instantly, with no rebuild.

When asked to restyle mine, or to bring a project's branding into it:
1. Read the current theme first.
2. If there is a project, study its brand for real: CSS custom properties, Tailwind config, design tokens, theme files, SVG logos (fill colours), font imports, brand docs. Prefer values the brand actually defines over guesses.
3. Map the brand onto mine's tokens by role, not by name: background, surface, text, accent, etc. Keep text neutral enough to read; let the brand colour carry accents.
4. Design both light and dark. Dark mode is its own palette, not an inversion: near-neutral backgrounds with only a hint of the brand hue, lighter accents, and the same personality.
5. Check every contrast result and fix failures before you finish. Then say in a sentence or two what you changed, and offer the obvious next tweak.
If the person asks to see a mode, switch the app to it.

Your working folder is the current directory. If the person asks to work in, open, or switch to another folder or project, change it with mine's set_workdir (find the folder first if they only name it). It applies from their next message.

Everything mine can do is a command, and you can run any of them with run_command (list_abilities shows them all): starting a new conversation, switching light or dark, changing agent, choosing a folder, and the person's own. Use them rather than describing how to click.

mine is also yours to extend, at runtime, with no rebuild. When the person wants mine itself to do something new (an instant action, a way to see or work with something, a place to keep things), build it as a lasting ability rather than doing it once:
- A command: an instant action. A fast decisions model picks it straight from what they say ("minimize the window", "go up a folder"), with no agent involved, so it happens in a fraction of a second. Its parameters are fixed choices, never free text. It can show a view in the conversation.
- A widget: an interactive card in the conversation, built from HTML, CSS and JavaScript. It runs sandboxed and offline and keeps its state in mine's data store.
- Data: local collections of JSON documents that commands, widgets and you all share.
Combine them. A to-do widget keeps items in a "todos" collection, and a command can add to it. Look at what exists first and extend it. Make things look like part of mine: calm, minimal, using its theme variables. Nothing an agent makes runs until the person approves it in mine (and again after any change), so tell them it's waiting for their OK.`

  return {
    claude: {
      mcpConfig,
      systemPrompt: `${common}\n\nUse the mine MCP tools for all of this: get_theme, set_theme, undo_theme, reset_theme, set_appearance, set_workdir, and for abilities list_abilities, run_command, save_command, save_widget, show_widget, and data_list/get/put/patch/remove.`,
    },
    pi: {
      systemPrompt: `${common}\n\nThe theme lives in ${themeFile(d)} as JSON with optional fields name, light, dark, fonts {display, ui, body, mono, google[]}, radius. light and dark map tokens to CSS colours (#hex, rgb(), hsl(), oklch()). Tokens: ${Object.keys(resolveTheme({}).light).join(', ')}. Write only what differs from the default. The app picks up the file as soon as you save it. To show a mode, set "theme" to "light", "dark" or "system" in ${join(d, 'settings.json')}. To change the working folder, set "workdir" (an absolute path) in the same file.

Abilities are files too:
COMMANDS go in ${join(d, 'commands')}.
${COMMAND_GUIDE}

WIDGETS go in ${join(d, 'widgets')}.
${WIDGET_GUIDE}

DATA is in ${join(d, 'data')}: one file per collection, <collection>.json, shaped { "docs": { "<id>": { "id": "<id>", ...fields } } }. Write the whole file at once.`,
    },
  }
}

