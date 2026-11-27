import { useEffect, useMemo, useRef, useState } from 'react'
import { History as HistoryIcon, Search, X } from 'lucide-react'
import type { ConversationSummary, HarnessInfo } from '@shared/ipc'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const DAY = 86_400_000

const startOfDay = (t: number) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function group(t: number, today: number) {
  if (t >= today) return 'Today'
  if (t >= today - DAY) return 'Yesterday'
  if (t >= today - 6 * DAY) return 'This week'
  return 'Earlier'
}

function when(t: number, today: number) {
  const d = new Date(t)
  if (t >= today) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (t >= today - 6 * DAY) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

const folder = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/** Past conversations, from the clock in the title bar. */
export function History({
  harnesses,
  current,
  running,
  harness,
  onOpen,
  onDelete,
  open: openProp,
  onOpenChange: setOpenProp,
}: {
  harnesses: HarnessInfo[]
  current: string
  running: boolean
  /** The agent's name, for "stop it first". */
  harness: string
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  /** Controlled by the app when given, so a command can open it. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const setOpen = (o: boolean) => (setOpenProp ?? setOpenState)(o)
  const [list, setList] = useState<ConversationSummary[] | null>(null)
  const [query, setQuery] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const onOpenChange = (o: boolean) => {
    setOpen(o)
  }
  // fresh list each time it opens, however it was opened
  useEffect(() => {
    setConfirm(null)
    if (!open) return
    setQuery('')
    void window.mine.conversations.list().then(setList)
  }, [open])

  const today = startOfDay(Date.now())
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = new Map<string, ConversationSummary[]>()
    for (const c of list ?? []) {
      if (q && !c.title.toLowerCase().includes(q) && !c.workdir.toLowerCase().includes(q)) continue
      const g = group(c.updatedAt, today)
      out.set(g, [...(out.get(g) ?? []), c])
    }
    return [...out]
  }, [list, query, today])

  const nameOf = (id: string | null) => harnesses.find((h) => h.id === id)?.name ?? id ?? ''
  const searchable = (list?.length ?? 0) > 6

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Past conversations" className="rounded-full">
              <HistoryIcon />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Past conversations</TooltipContent>
      </Tooltip>

      <PopoverContent
        align="end"
        sideOffset={6}
        onOpenAutoFocus={(e) => {
          if (!searchable) return
          e.preventDefault()
          searchRef.current?.focus()
        }}
        className="flex max-h-[min(30rem,calc(100vh-5rem))] w-[min(22rem,calc(100vw-2rem))] flex-col gap-0 overflow-hidden rounded-xl border-rule bg-surface p-0 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.25)]"
      >
        {searchable && (
          <label className="flex shrink-0 items-center gap-2 border-b border-rule/70 px-3.5">
            <Search className="size-3.5 shrink-0 text-neutral" aria-hidden="true" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a conversation"
              aria-label="Find a conversation"
              spellCheck={false}
              className="h-10 min-w-0 flex-1 bg-transparent text-[0.9375rem] outline-none select-text placeholder:text-neutral"
            />
          </label>
        )}

        {running && (
          <p className="shrink-0 border-b border-rule/70 px-3.5 py-2 text-[0.8125rem] text-muted-foreground">
            {harness} is working. Stop it or let it finish to switch.
          </p>
        )}

        <div className="scroll-soft min-h-0 overflow-y-auto p-1.5">
          {list === null ? null : list.length === 0 ? (
            <p className="px-2.5 py-6 text-center font-serif text-[1rem] text-muted-foreground">
              Nothing yet. Conversations appear here once you’ve said something.
            </p>
          ) : groups.length === 0 ? (
            <p className="px-2.5 py-6 text-center text-[0.875rem] text-muted-foreground">No conversation matches “{query.trim()}”.</p>
          ) : (
            groups.map(([label, items]) => (
              <section key={label} aria-label={label} className="mb-1 last:mb-0">
                <h3 className="px-2.5 pt-2 pb-1 font-mono text-[10px] text-neutral uppercase">{label}</h3>
                <ul>
                  {items.map((c) => {
                    const here = c.id === current
                    const asking = confirm === c.id
                    return (
                      <li key={c.id} className="group relative" onMouseLeave={() => asking && setConfirm(null)}>
                        <button
                          type="button"
                          disabled={running && !here}
                          aria-current={here ? 'true' : undefined}
                          onClick={() => {
                            setOpen(false)
                            if (!here) onOpen(c.id)
                          }}
                          className={cn(
                            'grid w-full grid-cols-[0.75rem_minmax(0,1fr)] items-baseline rounded-lg py-2 pr-10 pl-1.5 text-left transition-colors duration-100 hover:bg-paper-2 focus-visible:bg-paper-2 focus-visible:outline-none disabled:opacity-45 disabled:hover:bg-transparent',
                            here && 'bg-paper-2',
                          )}
                        >
                          <span
                            className={cn('size-1.5 -translate-y-px self-center rounded-full', here ? 'bg-bloom-deep' : 'bg-transparent')}
                            aria-hidden="true"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-[0.9375rem] leading-snug">{c.title}</span>
                            <span className="mt-0.5 block truncate font-mono text-[10.5px] text-neutral">
                              {[nameOf(c.harness), folder(c.workdir), when(c.updatedAt, today)].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                        </button>

                        {asking ? (
                          <button
                            type="button"
                            autoFocus
                            onBlur={() => setConfirm(null)}
                            onClick={async () => {
                              setConfirm(null)
                              await window.mine.conversations.remove(c.id)
                              setList((l) => l?.filter((x) => x.id !== c.id) ?? l)
                              onDelete(c.id)
                            }}
                            className="absolute top-1/2 right-1.5 h-7 -translate-y-1/2 rounded-full bg-signal/10 px-2.5 text-[0.75rem] font-semibold text-signal hover:bg-signal/15"
                          >
                            Delete
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={running && here}
                            onClick={() => setConfirm(c.id)}
                            aria-label={`Delete “${c.title}”`}
                            className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-full text-neutral opacity-0 transition-opacity duration-100 group-hover:opacity-100 hover:bg-paper-3 hover:text-ink focus-visible:opacity-100 disabled:hidden"
                          >
                            <X className="size-3.5" strokeWidth={2.25} />
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
