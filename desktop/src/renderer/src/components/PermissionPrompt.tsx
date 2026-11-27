import { useState } from 'react'
import { ShieldQuestion } from 'lucide-react'
import type { PermissionAsk, PermissionChoice } from '@shared/permissions'
import { cn } from '@/lib/utils'

// An agent asking before it does something. It waits for the person: Allow
// this once, always allow this kind of thing in this folder, or say no.
// Answering is only ever a click, never a command or anything an agent can do.

const field = (input: unknown, k: string) => {
  const v = input && typeof input === 'object' ? (input as Record<string, unknown>)[k] : undefined
  return typeof v === 'string' ? v : undefined
}

const lines = (s: string, n: number) => {
  const all = s.split(/\r?\n/)
  return all.length <= n ? s : `${all.slice(0, n).join('\n')}\n… ${all.length - n} more lines`
}

/** What it wants to do, in words, and the detail to show. */
function describe(a: PermissionAsk): { verb: string; detail?: string; code?: string; note?: string } {
  const i = a.input
  const path = field(i, 'file_path') ?? field(i, 'notebook_path') ?? field(i, 'path')
  const short = path?.startsWith(a.folder) ? path.slice(a.folder.length).replace(/^[\\/]/, '') || path : path
  switch (a.tool) {
    case 'Bash':
    case 'PowerShell':
      return { verb: 'run a command', code: field(i, 'command'), note: field(i, 'description') }
    case 'Edit':
    case 'MultiEdit': {
      const old = field(i, 'old_string')
      const now = field(i, 'new_string')
      const diff = old !== undefined && now !== undefined ? `${lines(old, 6).replace(/^/gm, '- ')}\n${lines(now, 6).replace(/^/gm, '+ ')}` : undefined
      return { verb: 'edit a file', detail: short, code: diff }
    }
    case 'Write': {
      const content = field(i, 'content') ?? ''
      return { verb: 'write a file', detail: short, note: `${content.split(/\r?\n/).length} lines` }
    }
    case 'NotebookEdit':
      return { verb: 'edit a notebook', detail: short }
    case 'WebFetch':
      return { verb: 'fetch a web page', detail: field(i, 'url'), note: field(i, 'prompt') }
    case 'WebSearch':
      return { verb: 'search the web', detail: field(i, 'query') }
    default:
      // a tool in one of the person's connected accounts: "Linear: create_issue"
      if (a.outside)
        return {
          verb: `${a.tool.slice(a.outside.length + 2).replace(/_/g, ' ')} in your ${a.outside} account`,
          note: 'This acts on your account there, not in this folder, so “allow all” doesn’t cover it.',
          code: (() => {
            try {
              return lines(JSON.stringify(i, null, 2), 12)
            } catch {
              return undefined
            }
          })(),
        }
      return {
        verb: a.tool.startsWith('mcp__') ? `use ${a.tool.split('__').slice(1).join(' ')}` : `use ${a.tool}`,
        code: (() => {
          try {
            return lines(JSON.stringify(i, null, 2), 12)
          } catch {
            return undefined
          }
        })(),
      }
  }
}

export function PermissionPrompt({ ask, compact }: { ask: PermissionAsk; compact?: boolean }) {
  const [busy, setBusy] = useState<PermissionChoice | null>(null)
  const d = describe(ask)
  const answer = (c: PermissionChoice) => {
    setBusy(c)
    void window.mine.permissions.answer(ask.id, c)
  }
  const folder = ask.folder.split(/[\\/]/).filter(Boolean).pop() ?? ask.folder

  return (
    <section
      role="alertdialog"
      aria-label={`${ask.agent} wants to ${d.verb}`}
      className={cn('permission-ask rounded-xl border border-bloom-deep/40 bg-surface', compact ? 'p-3' : 'p-3.5')}
    >
      <p className="flex items-center gap-2 font-mono text-[10.5px] text-neutral uppercase">
        <ShieldQuestion className="size-3.5 text-bloom-deep" aria-hidden="true" />
        Needs your OK
      </p>
      <p className="mt-1.5 text-[0.9375rem] leading-snug">
        <span className="font-semibold">{ask.agent}</span> wants to {d.verb}
        {d.detail && (
          <>
            {': '}
            <span className="font-mono text-[0.8125rem] break-all">{d.detail}</span>
          </>
        )}
      </p>
      {d.code && (
        <pre className="scroll-soft mt-2 max-h-40 overflow-auto rounded-lg bg-code-bg px-3 py-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-all text-code-fg select-text">
          {d.code}
        </pre>
      )}
      {d.note && <p className="mt-1.5 line-clamp-2 font-serif text-[0.9375rem] text-muted-foreground">{d.note}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => answer('allow')}
          className="h-8 rounded-full bg-solid px-3.5 text-[0.8125rem] font-semibold text-on-solid transition-colors hover:bg-solid-hover disabled:opacity-60"
        >
          {busy === 'allow' ? 'Allowed' : 'Allow'}
        </button>
        {ask.always && (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => answer('always')}
            title={`From now on, ${ask.agent} can do this in ${ask.folder} without asking.`}
            className="h-8 max-w-full truncate rounded-full border border-rule px-3.5 text-[0.8125rem] font-semibold transition-colors hover:bg-paper-2 disabled:opacity-60"
          >
            Always allow {ask.always.replace(/`/g, '')} in {folder}
          </button>
        )}
        {!ask.outside && (
        <button
          type="button"
          disabled={!!busy}
          onClick={() => answer('all')}
          title={`${ask.agent} won’t ask again in ${ask.folder} for anything: commands, edits, web pages. Anything else waiting there goes through too. Turn it off from the title bar or Settings.`}
          className="h-8 rounded-full border border-rule px-3.5 text-[0.8125rem] font-semibold transition-colors hover:border-bloom-deep/50 hover:bg-bloom-wash disabled:opacity-60"
        >
          Allow all in {folder}
        </button>
        )}
        <button
          type="button"
          disabled={!!busy}
          onClick={() => answer('deny')}
          className="h-8 rounded-full px-3 text-[0.8125rem] font-semibold text-muted-foreground transition-colors hover:bg-signal/10 hover:text-signal disabled:opacity-60"
        >
          Deny
        </button>
      </div>
    </section>
  )
}
