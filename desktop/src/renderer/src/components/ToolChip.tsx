import { Check, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { commandOf, type ToolCall } from '@/lib/useConversation'
import { cn } from '@/lib/utils'

/** mcp__mine__set_theme → "set theme"; mcp__github__create_issue → "github · create issue" */
export function toolLabel(name: string) {
  const m = name.match(/^mcp__(.+?)__(.+)$/)
  if (m) return m[1] === 'mine' ? m[2].replace(/_/g, ' ') : `${m[1]} · ${m[2].replace(/_/g, ' ')}`
  return name
}

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/** One line that says what this call is doing. */
export function toolSummary(t: ToolCall): string {
  const cmd = commandOf(t.input)
  if (cmd) return `$ ${cmd.replace(/\s+/g, ' ')}`
  const i = (t.input ?? {}) as Record<string, unknown>
  const s = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : undefined)
  const path = s('file_path') ?? s('path') ?? s('filePath') ?? s('notebook_path')
  if (s('pattern')) return `${s('pattern')}${path ? `  in ${base(path)}` : ''}`
  if (path) return base(path)
  if (s('url')) return s('url')!.replace(/^https?:\/\//, '')
  if (s('query')) return s('query')!
  if (s('description')) return s('description')!
  if (/set_theme$/.test(t.name)) return s('name') ? `theme “${s('name')}”` : 'colours and fonts'
  if (s('mode')) return s('mode')!
  if (Array.isArray(i.todos)) return `${i.todos.length} to-dos`
  const first = Object.values(i).find((v) => typeof v === 'string') as string | undefined
  return first ?? ''
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

function StatusMark({ status }: { status: ToolCall['status'] }) {
  if (status === 'running' || status === 'stopping')
    return <span className="size-2 shrink-0 animate-pulse rounded-full bg-bloom-deep" aria-hidden="true" />
  if (status === 'done') return <Check className="size-3 shrink-0 text-neutral" strokeWidth={2.5} aria-hidden="true" />
  if (status === 'stopped') return <Square className="size-2.5 shrink-0 fill-current text-neutral" aria-hidden="true" />
  return <span className="size-2 shrink-0 rounded-full bg-signal" aria-hidden="true" />
}

const STATUS_TEXT: Record<ToolCall['status'], string> = {
  running: 'Running',
  stopping: 'Stopping…',
  done: 'Done',
  error: 'Failed',
  stopped: 'Stopped',
}

export function ToolChip({ tool, onStop }: { tool: ToolCall; onStop?: (id: string) => void }) {
  const summary = toolSummary(tool)
  const label = toolLabel(tool.name)
  const command = commandOf(tool.input)
  const canStop = !!onStop && tool.status === 'running' && command !== undefined
  const params = tool.input && !command ? JSON.stringify(tool.input, null, 2) : undefined

  return (
    <li className="flex max-w-full min-w-0">
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  'flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full border border-transparent bg-paper-2 px-2.5 font-mono text-[10.5px] text-muted-foreground transition-colors hover:border-rule hover:text-ink data-[state=open]:border-ink data-[state=open]:text-ink',
                  canStop && 'rounded-r-none pr-2',
                  tool.status === 'error' && 'text-signal',
                )}
                aria-label={`${label}: ${summary}. ${STATUS_TEXT[tool.status]}. Show details`}
              >
                <StatusMark status={tool.status} />
                <span className="shrink-0 font-semibold">{label}</span>
                {summary && <span className="min-w-0 truncate opacity-80">{clip(summary, 56)}</span>}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent className="max-w-[28rem] font-mono text-[11px] break-all">
            {clip(summary || label, 240)}
          </TooltipContent>
        </Tooltip>

        <PopoverContent align="start" className="w-[min(34rem,calc(100vw-2rem))] rounded-xl border-rule p-0">
          <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-2.5">
            <p className="truncate font-mono text-[11.5px] font-semibold">{tool.name}</p>
            <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] text-neutral uppercase">
              <StatusMark status={tool.status} />
              {STATUS_TEXT[tool.status]}
            </span>
          </div>
          <div className="scroll-soft max-h-[22rem] space-y-3 overflow-y-auto px-4 py-3">
            {command !== undefined && (
              <section>
                <h4 className="mb-1 font-mono text-[10px] text-neutral uppercase">Command</h4>
                <pre className="rounded-lg bg-code-bg px-3 py-2 font-mono text-[11.5px] leading-relaxed break-all whitespace-pre-wrap text-[var(--code-fg)] select-text">
                  {command}
                </pre>
              </section>
            )}
            {params && (
              <section>
                <h4 className="mb-1 font-mono text-[10px] text-neutral uppercase">Parameters</h4>
                <pre className="rounded-lg bg-paper-2 px-3 py-2 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap select-text">
                  {params}
                </pre>
              </section>
            )}
            {tool.output && (
              <section>
                <h4 className="mb-1 font-mono text-[10px] text-neutral uppercase">
                  {tool.status === 'running' ? 'Output so far' : 'Result'}
                </h4>
                <pre className="max-h-48 overflow-y-auto rounded-lg border border-rule px-3 py-2 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-muted-foreground select-text">
                  {tool.output}
                </pre>
              </section>
            )}
            {!command && !params && !tool.output && (
              <p className="font-mono text-[11px] text-neutral">No details reported yet.</p>
            )}
          </div>
          {canStop && (
            <div className="border-t border-rule px-4 py-2.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onStop?.(tool.id)}
                className="rounded-full border-signal/40 text-signal hover:bg-signal/10 hover:text-signal"
              >
                <Square className="size-3 fill-current" />
                Stop this command
              </Button>
              <span className="ml-3 font-mono text-[10.5px] text-neutral">The agent keeps going.</span>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {canStop && (
        <button
          type="button"
          onClick={() => onStop?.(tool.id)}
          aria-label={`Stop ${clip(summary, 60)}`}
          title="Stop this command"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-r-full border-l border-rule bg-paper-2 text-neutral transition-colors hover:bg-signal/15 hover:text-signal"
        >
          <X className="size-3" strokeWidth={2.5} />
        </button>
      )}
    </li>
  )
}
