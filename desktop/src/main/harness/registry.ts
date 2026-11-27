import type { HarnessId } from '@shared/ipc'

// Bring your own harness. Each adapter says how to run one agent CLI headless:
// which binary to look for, which flags make it print-and-exit, how the prompt
// gets in, and how to read what comes out.
//
// Pi and Claude Code are verified against their real output. The rest follow
// their documented headless modes and fall back to plain text.

export type OutputFormat = 'claude-stream' | 'pi-json' | 'codex-json' | 'text'

/** What mine tells and gives every agent run (see main/theme.ts). */
export type AgentContext = {
  claude: { mcpConfig: string; systemPrompt: string }
  pi: { systemPrompt: string }
}

export type Adapter = {
  id: HarnessId
  name: string
  vendor: string
  blurb: string
  /** Binary names to search for on PATH, in order of preference. */
  commands: string[]
  format: OutputFormat
  /** Build argv. When the prompt is not in argv it is written to stdin. */
  args(opts: { prompt: string; sessionRef?: string; ctx: AgentContext }): { argv: string[]; stdin?: string }
  /** Pi takes a session id we choose up front; others hand one back. */
  presetSession?: boolean
}

export const ADAPTERS: Adapter[] = [
  {
    id: 'pi',
    name: 'Pi',
    vendor: 'Earendil',
    blurb: 'The open harness mine is built on. Any model, any provider.',
    commands: ['pi'],
    format: 'pi-json',
    presetSession: true,
    args: ({ prompt, sessionRef, ctx }) => ({
      argv: [
        '-p',
        '--mode',
        'json',
        '--append-system-prompt',
        ctx.pi.systemPrompt,
        ...(sessionRef ? ['--session-id', sessionRef] : ['--no-session']),
      ],
      stdin: prompt,
    }),
  },
  {
    id: 'claude',
    name: 'Claude Code',
    vendor: 'Anthropic',
    blurb: 'Anthropic’s coding agent, running on Claude.',
    commands: ['claude'],
    format: 'claude-stream',
    args: ({ prompt, sessionRef, ctx }) => ({
      argv: [
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--include-partial-messages',
        '--mcp-config',
        ctx.claude.mcpConfig,
        // the theme tools, plus read-only access so it can study a project's brand
        '--allowedTools',
        'mcp__mine,Read,Glob,Grep',
        '--append-system-prompt',
        ctx.claude.systemPrompt,
        ...(sessionRef ? ['--resume', sessionRef] : []),
      ],
      stdin: prompt,
    }),
  },
  {
    id: 'codex',
    name: 'Codex',
    vendor: 'OpenAI',
    blurb: 'OpenAI’s coding agent, running on GPT models.',
    commands: ['codex'],
    format: 'codex-json',
    args: ({ prompt }) => ({ argv: ['exec', '--json', '--skip-git-repo-check', '-'], stdin: prompt }),
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    vendor: 'Google',
    blurb: 'Google’s terminal agent, running on Gemini.',
    commands: ['gemini'],
    format: 'text',
    args: ({ prompt }) => ({ argv: ['-p', prompt] }),
  },
  {
    id: 'opencode',
    name: 'opencode',
    vendor: 'SST',
    blurb: 'Open source terminal agent with many providers.',
    commands: ['opencode'],
    format: 'text',
    args: ({ prompt }) => ({ argv: ['run', prompt] }),
  },
  {
    id: 'goose',
    name: 'goose',
    vendor: 'Block',
    blurb: 'Open source agent with extensions.',
    commands: ['goose'],
    format: 'text',
    args: ({ prompt }) => ({ argv: ['run', '-t', prompt] }),
  },
  {
    id: 'cursor',
    name: 'Cursor Agent',
    vendor: 'Anysphere',
    blurb: 'Cursor’s agent, from the terminal.',
    commands: ['cursor-agent'],
    format: 'text',
    args: ({ prompt }) => ({ argv: ['-p', prompt, '--output-format', 'text'] }),
  },
]

export function adapter(id: HarnessId): Adapter {
  const a = ADAPTERS.find((x) => x.id === id)
  if (!a) throw new Error(`Unknown harness: ${id}`)
  return a
}
