// Permissions: an agent asking the person before it does something (runs a
// command, edits a file, fetches a page). Claude Code routes these to mine's
// MCP server; mine shows them in the window, and only the person's click
// answers. "Always" keeps a narrow rule for that folder.

/** One request waiting on the person. */
export type PermissionAsk = {
  id: string
  runId: string | null
  /** The agent asking, e.g. "Claude Code". */
  agent: string
  /** The agent's tool name: Bash, Edit, Write, WebFetch… */
  tool: string
  input: unknown
  folder: string
  /** What "always allow" would cover, in words, or null if it can't be narrowed safely. */
  always: string | null
  /**
   * Set when it acts on one of the person's accounts elsewhere (a connected
   * tool), not in the folder. "Allow all in this folder" never covers those.
   */
  outside?: string
  at: number
}

/** allow: this once. always: this kind of thing, in this folder. all: anything, in this folder. */
export type PermissionChoice = 'allow' | 'always' | 'all' | 'deny'

/** Something the person always allows in a folder. tool "*" is everything. */
export type PermissionRule = { folder: string; tool: string; prefix?: string; domain?: string }

export const ALL = '*'

/** Folders compare case-insensitively, either slash. */
const norm = (f: string) => f.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase()
export const sameFolder = (a: string, b: string) => norm(a) === norm(b)

// commands whose second word is what they do (git fetch, npm install…)
const TWO_WORD = new Set([
  'git', 'npm', 'pnpm', 'yarn', 'bun', 'npx', 'docker', 'gh', 'cargo', 'go', 'dotnet', 'kubectl', 'pip', 'pip3', 'uv', 'brew',
  'winget', 'az', 'aws', 'gcloud', 'terraform', 'deno', 'node', 'python', 'python3', 'py',
])
const RUNNERS = new Set(['run', 'exec', 'x'])

/** A command that does one thing: no chaining, pipes, redirects or substitutions. */
export const simpleCommand = (cmd: string) => !/[;&|<>`\n\r]|\$\(/.test(cmd)

/** The prefix "always allow" would cover for a command, like "git fetch" or "npm run build". */
export function commandPrefix(cmd: string): string | null {
  const c = cmd.trim()
  if (!c || !simpleCommand(c)) return null
  const words = c.split(/\s+/).filter((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w))
  const [a, b, d] = words
  if (!a) return null
  if (!TWO_WORD.has(a)) return a
  // "git -C x …" or "python -c …": too broad to remember as just "git" or "python"
  if (!b || b.startsWith('-')) return null
  if (RUNNERS.has(b) && d && !d.startsWith('-')) return `${a} ${b} ${d}`
  return `${a} ${b}`
}

const inputOf = (input: unknown) => (input && typeof input === 'object' ? (input as Record<string, unknown>) : {})

/** The narrowest sensible "always" rule for a request, or null. */
export function ruleFor(tool: string, input: unknown, folder: string): PermissionRule | null {
  const i = inputOf(input)
  if (tool === 'Bash' || tool === 'PowerShell') {
    const prefix = typeof i.command === 'string' ? commandPrefix(i.command) : null
    return prefix ? { folder, tool, prefix } : null
  }
  if (tool === 'WebFetch') {
    try {
      return { folder, tool, domain: new URL(String(i.url)).hostname }
    } catch {
      return null
    }
  }
  return { folder, tool }
}

const EDITS: Record<string, string> = { Edit: 'edits to files', MultiEdit: 'edits to files', Write: 'writing files', NotebookEdit: 'notebook edits' }

/** "git fetch", "edits to files", "pages from github.com"… */
export function describeRule(r: PermissionRule) {
  if (r.tool === ALL) return 'everything'
  if (r.prefix) return `\`${r.prefix}\``
  if (r.domain) return `pages from ${r.domain}`
  if (EDITS[r.tool]) return EDITS[r.tool]
  if (r.tool === 'WebSearch') return 'web searches'
  return r.tool.startsWith('mcp__') ? r.tool.split('__').slice(1).join(' ') : r.tool
}
