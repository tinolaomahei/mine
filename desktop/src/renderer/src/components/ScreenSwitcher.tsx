import { useState } from 'react'
import { ChevronDown, LayoutDashboard, Pencil, Plus, Settings, Store, X } from 'lucide-react'
import type { Screen } from '@shared/widgets'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

// The way to every screen, from the title bar: open one, make one, rename or
// delete one, or go to the widget marketplace.

export type Stage = { kind: 'screen'; id: string } | { kind: 'market' } | { kind: 'setup' } | { kind: 'settings' }

const row =
  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[0.9375rem] transition-colors duration-100 hover:bg-paper-2 focus-visible:bg-paper-2 focus-visible:outline-none'

export function ScreenSwitcher({
  screens,
  stage,
  showing,
  onOpen,
  onCreate,
  onRename,
  onDelete,
  onMarket,
  onSettings,
}: {
  screens: Screen[]
  stage: Stage | null
  /** Whether the stage is in view (the conversation isn't full screen). */
  showing: boolean
  onOpen: (id: string) => void
  onCreate: () => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onMarket: () => void
  onSettings: () => void
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)
  const current = stage?.kind === 'screen' ? screens.find((s) => s.id === stage.id) : undefined
  const label = !showing ? 'Screens' : stage?.kind === 'market' ? 'Marketplace' : stage?.kind === 'setup' ? 'Your tools' : stage?.kind === 'settings' ? 'Settings' : (current?.name ?? 'Screens')
  const go = (fn: () => void) => {
    setOpen(false)
    fn()
  }
  const save = () => {
    if (editing && name.trim()) onRename(editing, name)
    setEditing(null)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) {
          setEditing(null)
          setConfirm(null)
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Screens. ${showing ? `Showing ${label}.` : 'The conversation is full screen.'}`}
          className={cn(
            'flex h-8 max-w-[12rem] items-center gap-1.5 rounded-full border pr-2 pl-2.5 text-[0.875rem] font-medium transition-colors',
            showing ? 'border-bloom-deep/40 bg-bloom-wash text-ink' : 'border-rule bg-surface text-muted-foreground hover:text-ink',
          )}
        >
          {stage?.kind === 'market' && showing ? <Store className="size-3.5 shrink-0" /> : <LayoutDashboard className="size-3.5 shrink-0" />}
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3.5 shrink-0 text-neutral" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[min(18rem,calc(100vw-2rem))] rounded-xl border-rule bg-surface p-1.5 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.25)]"
      >
        <p className="px-2.5 pt-1.5 pb-1 font-mono text-[10px] text-neutral uppercase">Screens</p>
        {screens.length === 0 && <p className="px-2.5 py-2 text-[0.875rem] text-muted-foreground">None yet. A screen is a blank page for widgets.</p>}
        <ul>
          {screens.map((s) => {
            const here = showing && stage?.kind === 'screen' && stage.id === s.id
            if (editing === s.id)
              return (
                <li key={s.id} className="px-1 py-0.5">
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={save}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') save()
                      if (e.key === 'Escape') {
                        // just stop renaming: don't close the menu or stop the agent
                        e.preventDefault()
                        e.stopPropagation()
                        setEditing(null)
                      }
                    }}
                    maxLength={60}
                    aria-label={`New name for ${s.name}`}
                    className="h-8 w-full rounded-lg border border-bloom-deep bg-paper px-2 text-[0.9375rem] outline-none select-text"
                  />
                </li>
              )
            return (
              <li key={s.id} className="group relative" onMouseLeave={() => confirm === s.id && setConfirm(null)}>
                <button
                  type="button"
                  aria-current={here ? 'page' : undefined}
                  onClick={() => go(() => onOpen(s.id))}
                  className={cn(row, 'pr-16', here && 'bg-paper-2')}
                >
                  <span className={cn('size-1.5 shrink-0 rounded-full', here ? 'bg-bloom-deep' : 'bg-transparent')} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <span className="font-mono text-[10px] text-neutral">{s.items.length || ''}</span>
                </button>
                {confirm === s.id ? (
                  <button
                    type="button"
                    autoFocus
                    onBlur={() => setConfirm(null)}
                    onClick={() => {
                      setConfirm(null)
                      onDelete(s.id)
                    }}
                    className="absolute top-1/2 right-1 h-7 -translate-y-1/2 rounded-full bg-signal/10 px-2.5 text-[0.75rem] font-semibold text-signal hover:bg-signal/15"
                  >
                    Delete
                  </button>
                ) : (
                  <span className="absolute top-1/2 right-1 flex -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => {
                        setName(s.name)
                        setEditing(s.id)
                      }}
                      aria-label={`Rename ${s.name}`}
                      className="grid size-7 place-items-center rounded-full text-neutral hover:bg-paper-3 hover:text-ink"
                    >
                      <Pencil className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirm(s.id)}
                      aria-label={`Delete ${s.name}`}
                      className="grid size-7 place-items-center rounded-full text-neutral hover:bg-paper-3 hover:text-ink"
                    >
                      <X className="size-3.5" strokeWidth={2.25} />
                    </button>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
        <button type="button" onClick={() => go(onCreate)} className={cn(row, 'text-muted-foreground hover:text-ink')}>
          <Plus className="size-3.5" />
          New screen
        </button>
        <div className="my-1 h-px bg-rule/70" />
        <button type="button" onClick={() => go(onMarket)} className={cn(row, showing && stage?.kind === 'market' && 'bg-paper-2')}>
          <Store className="size-3.5 text-bloom-deep" />
          <span className="flex-1">Marketplace</span>
        </button>
        <button type="button" onClick={() => go(onSettings)} className={cn(row, showing && stage?.kind === 'settings' && 'bg-paper-2')}>
          <Settings className="size-3.5 text-neutral" />
          <span className="flex-1">Settings</span>
          <kbd className="font-mono text-[10px] text-neutral">ctrl ,</kbd>
        </button>
        <p className="px-2.5 pt-1.5 pb-1 font-mono text-[10px] text-neutral">
          <kbd className="font-mono">ctrl j</kbd> shows or hides the conversation
        </p>
      </PopoverContent>
    </Popover>
  )
}
