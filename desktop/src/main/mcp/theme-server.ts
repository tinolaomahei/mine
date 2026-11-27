// A tiny MCP server (stdio, JSON-RPC) that lets an agent restyle mine live.
// Claude Code starts it from the --mcp-config mine writes; it runs under
// Electron in node mode, so it needs no separate Node install.

import { createInterface } from 'node:readline'
import { contrastReport, resolveTheme, TOKENS, TOKEN_NAMES, type ThemePatch } from '@shared/theme'
import { ABILITY_NAMES, ABILITY_TOOLS, abilityCall } from './abilities'
import { history, loadPatch, resetPatch, savePatch, setAppearance, setWorkdir, undoPatch } from '../theme-store'

const DIR = process.env.MINE_DIR
if (!DIR) {
  process.stderr.write('MINE_DIR is not set\n')
  process.exit(1)
}

const palette = {
  type: 'object',
  description: 'Token → CSS colour (#hex, rgb(), hsl() or oklch()). Only include tokens you want to change.',
  properties: Object.fromEntries(TOKEN_NAMES.map((n) => [n, { type: 'string', description: TOKENS[n].doc }])),
  additionalProperties: false,
}

const TOOLS = [
  {
    name: 'get_theme',
    description:
      'Read mine’s current theme: every colour token for light and dark mode, fonts, radius, what each token paints, and a contrast report. Call this before changing anything.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'set_theme',
    description:
      'Change mine’s look. Applies instantly to the running app, no rebuild. Merges with the current theme unless replace is true. Returns a WCAG contrast report for both modes; fix any FAIL before you finish. Light and dark are separate palettes: design dark mode on purpose (lower-chroma backgrounds, accents often lighter), never as an inversion.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short theme name, e.g. the brand name.' },
        light: palette,
        dark: palette,
        fonts: {
          type: 'object',
          properties: {
            display: { type: 'string', description: 'CSS font-family for big headings and the wordmark only.' },
            ui: {
              type: 'string',
              description: 'CSS font-family for the interface: buttons, labels, menus, message bubbles. Usually the brand’s workhorse sans.',
            },
            body: { type: 'string', description: 'CSS font-family for reading text (agent replies, descriptions).' },
            mono: { type: 'string', description: 'CSS font-family for labels and code.' },
            google: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Google Fonts css2 family specs to load, e.g. ["Inter:wght@400;600;700", "JetBrains Mono"]. Fonts installed on this computer need no entry.',
            },
          },
          additionalProperties: false,
        },
        radius: { type: 'string', description: 'Base corner radius, e.g. "0.875rem" or "6px". Larger is rounder.' },
        replace: { type: 'boolean', description: 'Start from mine’s default Bloom instead of the current theme.' },
      },
      additionalProperties: false,
    },
  },
  { name: 'undo_theme', description: 'Go back to the previous theme.', inputSchema: { type: 'object', properties: {} } },
  { name: 'reset_theme', description: 'Return to mine’s own Bloom theme.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'set_workdir',
    description:
      'Change the folder mine’s agents work in (the project folder). Takes effect from the person’s next message; for the rest of this reply, use absolute paths into the new folder. Accepts absolute paths, ~, environment variables, or a path relative to the current folder. Find the folder first (e.g. with Glob) if the person only names it.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'The folder to work in.' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_appearance',
    description: 'Show light mode, dark mode, or follow the system. Use it so the person can see the mode you just changed.',
    inputSchema: {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['system', 'light', 'dark'] } },
      required: ['mode'],
      additionalProperties: false,
    },
  },
]

function report() {
  const theme = resolveTheme(loadPatch(DIR!).patch)
  const rows = contrastReport(theme)
  const fails = rows.filter((r) => !r.ok)
  const lines = rows.map(
    (r) => `${r.ok ? 'ok  ' : 'FAIL'} ${r.mode.padEnd(5)} ${r.fg} on ${r.bg}: ${r.ratio}:1 (needs ${r.min}:1, ${r.what})`,
  )
  return { theme, fails, text: `Contrast (${fails.length} failing):\n${lines.join('\n')}` }
}

function call(name: string, input: Record<string, unknown>): { text: string; isError?: boolean } {
  switch (name) {
    case 'get_theme': {
      const { theme, text } = report()
      const loaded = loadPatch(DIR!)
      const docs = TOKEN_NAMES.map((n) => `- ${n}: ${TOKENS[n].doc}`).join('\n')
      return {
        text: [
          `Current theme: ${theme.name}${loaded.error ? ` (stored theme is invalid and ignored: ${loaded.error})` : ''}`,
          '```json',
          JSON.stringify(theme, null, 2),
          '```',
          'What each token paints:',
          docs,
          'Fonts: display = big headings and wordmark, ui = buttons/labels/menus/bubbles, body = reading text (agent replies), mono = small labels and code.',
          text,
        ].join('\n'),
      }
    }
    case 'set_theme': {
      const { replace, ...patch } = input
      const errors = savePatch(DIR!, patch as ThemePatch, replace === true)
      if (errors.length) return { text: `Not applied:\n- ${errors.join('\n- ')}`, isError: true }
      const { theme, fails, text } = report()
      return {
        text: `Applied "${theme.name}" live.\n${text}${fails.length ? '\nAdjust the failing tokens and call set_theme again.' : ''}`,
      }
    }
    case 'undo_theme': {
      if (!undoPatch(DIR!)) return { text: 'Nothing to undo.' }
      return { text: `Undone. Now showing "${report().theme.name}". ${history(DIR!).length} earlier versions left.` }
    }
    case 'reset_theme':
      resetPatch(DIR!)
      return { text: 'Back to Bloom.' }
    case 'set_workdir': {
      const res = setWorkdir(DIR!, String(input.path ?? ''))
      if (res.error) return { text: res.error, isError: true }
      return { text: `mine now works in ${res.path}. This applies from the next message.` }
    }
    case 'set_appearance': {
      const mode = input.mode
      if (mode !== 'system' && mode !== 'light' && mode !== 'dark') return { text: 'mode must be system, light or dark.', isError: true }
      setAppearance(DIR!, mode)
      return { text: `mine is now showing ${mode === 'system' ? 'the system mode' : `${mode} mode`}.` }
    }
  }
  return { text: `Unknown tool ${name}`, isError: true }
}

type Req = { jsonrpc: '2.0'; id?: number | string; method: string; params?: Record<string, unknown> }

function send(msg: unknown) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

async function handle(req: Req) {
  if (req.id === undefined) return // notification
  const ok = (result: unknown) => send({ jsonrpc: '2.0', id: req.id, result })
  switch (req.method) {
    case 'initialize':
      return ok({
        protocolVersion: (req.params?.protocolVersion as string) ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'mine', version: '0.1.0' },
        instructions:
          'Tools to control and extend the mine desktop app: restyle it live (start with get_theme), change the folder agents work in (set_workdir), and build new abilities into it at runtime: commands, widgets and data (start with list_abilities).',
      })
    case 'ping':
      return ok({})
    case 'tools/list':
      return ok({ tools: [...TOOLS, ...ABILITY_TOOLS] })
    case 'tools/call': {
      const name = String(req.params?.name ?? '')
      const input = (req.params?.arguments ?? {}) as Record<string, unknown>
      try {
        const res = ABILITY_NAMES.has(name) ? await abilityCall(name, input) : call(name, input)
        return ok({ content: [{ type: 'text', text: res.text }], isError: res.isError ?? false })
      } catch (err) {
        return ok({ content: [{ type: 'text', text: `Failed: ${(err as Error).message}` }], isError: true })
      }
    }
    default:
      return send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `Method not found: ${req.method}` } })
  }
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return
  try {
    void handle(JSON.parse(line))
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
  }
})
