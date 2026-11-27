import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowRight, Check, ChevronDown, Plus } from 'lucide-react'
import { GRID, type Screen, type WidgetInfo } from '@shared/widgets'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { WidgetFrame } from './WidgetFrame'

// The widget marketplace: every widget mine has, its own and the person's,
// running live on sample data so they can be tried before they're added.

export type MarketFilter = 'all' | 'native' | 'yours'
export type MarketKind = 'widgets' | 'themes' | 'connections'
type Filter = MarketFilter

/** Column width previews are drawn at: about what a screen in a normal-sized window gives. */
const NOMINAL_COL = 84

/** The first sentence: the description also carries details meant for agents. */
const blurb = (d: string) => d.split(/(?<=[.!?])\s/)[0] ?? d

function AddTo({
  w,
  screens,
  target,
  onAdd,
  onOpen,
}: {
  w: WidgetInfo
  screens: Screen[]
  target: Screen | null
  onAdd: (widget: string, screen: string | null) => string | null
  onOpen: (screen: string) => void
}) {
  const [added, setAdded] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!added) return
    const t = setTimeout(() => setAdded(null), 5000)
    return () => clearTimeout(t)
  }, [added])

  const add = (screen: string | null) => {
    setOpen(false)
    const id = onAdd(w.id, screen)
    if (id) setAdded(id)
  }
  const ready = w.approved && !w.error

  if (added)
    return (
      <button
        type="button"
        onClick={() => onOpen(added)}
        className="flex h-8 items-center gap-1.5 rounded-full bg-bloom-wash px-3 text-[0.8125rem] font-semibold text-ink transition-colors hover:bg-bloom/40"
      >
        <Check className="size-3.5 text-bloom-deep" strokeWidth={2.5} />
        Added. Open {screens.find((s) => s.id === added)?.name ?? 'it'}
        <ArrowRight className="size-3.5" />
      </button>
    )

  return (
    <div className="flex items-center">
      <button
        type="button"
        disabled={!ready}
        onClick={() => add(target?.id ?? null)}
        className="flex h-8 items-center gap-1.5 rounded-l-full bg-solid pr-2.5 pl-3 text-[0.8125rem] font-semibold text-on-solid transition-colors hover:bg-solid-hover disabled:bg-paper-3 disabled:text-neutral"
      >
        <Plus className="size-3.5" strokeWidth={2.5} />
        <span className="max-w-[10rem] truncate">{target ? `Add to ${target.name}` : 'Add to a new screen'}</span>
      </button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={!ready}
            aria-label={`Choose a screen for ${w.title}`}
            className="grid h-8 w-7 place-items-center rounded-r-full border-l border-solid-rule bg-solid text-on-solid transition-colors hover:bg-solid-hover disabled:border-rule disabled:bg-paper-3 disabled:text-neutral"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-56 rounded-xl border-rule bg-surface p-1.5 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.25)]"
        >
          <p className="px-2.5 pt-1.5 pb-1 font-mono text-[10px] text-neutral uppercase">Add {w.title} to</p>
          {screens.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => add(s.id)}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[0.9375rem] hover:bg-paper-2 focus-visible:bg-paper-2 focus-visible:outline-none"
            >
              <span className="truncate">{s.name}</span>
              <span className="font-mono text-[10px] text-neutral">{s.items.length || ''}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => add(null)}
            className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-rule/70 px-2.5 py-1.5 text-left text-[0.9375rem] text-muted-foreground hover:bg-paper-2 hover:text-ink focus-visible:bg-paper-2 focus-visible:outline-none"
          >
            <Plus className="size-3.5" />A new screen
          </button>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function Card(props: {
  w: WidgetInfo
  screens: Screen[]
  target: Screen | null
  onAdd: (widget: string, screen: string | null) => string | null
  onOpen: (s: string) => void
}) {
  const { w } = props
  const [note, setNote] = useState<string | null>(null)
  // the preview is the widget at its real size on a screen, scaled down if the card is smaller
  const area = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = area.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setFit({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const W = w.size.w * NOMINAL_COL + (w.size.w - 1) * GRID.gap
  const H = w.size.h * GRID.row + (w.size.h - 1) * GRID.gap
  const k = fit.w ? Math.min(1, (fit.w - 32) / W, (fit.h - 32) / H) : 0
  const live = w.approved && !w.error
  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(null), 3500)
    return () => clearTimeout(t)
  }, [note])

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-rule bg-surface" aria-label={w.title}>
      <div ref={area} className={cn('relative h-[16.5rem] overflow-hidden border-b border-rule/60', live && 'bg-paper-2/60')}>
        {!live ? (
          <div className="absolute inset-0">
            <WidgetFrame id={w.id} place="preview" sample />
          </div>
        ) : (
          k > 0 && (
            <div
              className="absolute top-1/2 left-1/2 overflow-hidden rounded-xl border border-rule bg-surface"
              style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${k})` }}
            >
              <WidgetFrame id={w.id} place="preview" sample onNote={setNote} />
            </div>
          )
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="truncate font-display text-[1.125rem] font-semibold tracking-[-0.02em]">{w.title}</h3>
          <span className="shrink-0 font-mono text-[10px] text-neutral uppercase">{w.source === 'native' ? 'mine' : 'yours'}</span>
        </div>
        <p className="mt-1 line-clamp-2 text-[0.875rem] leading-snug text-muted-foreground">{blurb(w.description) || 'No description.'}</p>
        <div className="mt-auto flex items-center justify-between gap-3 pt-4">
          <AddTo {...props} />
          <span
            className={cn('truncate font-mono text-[10px]', note ? 'text-bloom-deep' : 'text-neutral')}
            title={note ?? `It runs on sample data here. On a screen it starts ${w.size.w} columns wide and ${w.size.h} rows tall.`}
            aria-live="polite"
          >
            {note ?? `sample data · ${w.size.w}×${w.size.h}`}
          </span>
        </div>
      </div>
    </article>
  )
}

export function Marketplace({
  widgets,
  screens,
  target,
  onAdd,
  onOpenScreen,
  filter,
  onFilter,
  kind,
  onKind,
  themeCounts,
  themes,
  connections,
}: {
  filter: Filter
  onFilter: (f: Filter) => void
  /** Which shelf: widgets or themes. */
  kind: MarketKind
  onKind: (k: MarketKind) => void
  themeCounts: Record<Filter, number>
  /** The themes shelf. */
  themes: ReactNode
  /** The tools the person can connect. */
  connections: ReactNode
  widgets: WidgetInfo[]
  screens: Screen[]
  /** Where Add puts a widget unless another screen is picked. */
  target: Screen | null
  /** Add a widget to a screen (null: a new one). Returns the screen it went on. */
  onAdd: (widget: string, screen: string | null) => string | null
  onOpenScreen: (id: string) => void
}) {
  const native = widgets.filter((w) => w.source === 'native')
  const yours = widgets.filter((w) => w.source === 'yours')
  const counts: Record<Filter, number> =
    kind === 'themes'
      ? themeCounts
      : {
          all: widgets.length,
          native: native.length,
          yours: yours.length,
        }
  const grid = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-4'
  const card = (w: WidgetInfo) => <Card key={w.id} w={w} screens={screens} target={target} onAdd={onAdd} onOpen={onOpenScreen} />

  return (
    <div className="scroll-soft h-full overflow-y-auto">
      <div className="mx-auto max-w-[76rem] px-6 pt-10 pb-32">
        <div role="tablist" aria-label="Marketplace" className="mb-6 flex gap-5 border-b border-rule/70">
          {(
            [
              ['widgets', 'Widgets'],
              ['themes', 'Themes'],
              ['connections', 'Connections'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => onKind(k)}
              className={cn(
                '-mb-px border-b-2 pb-2 text-[0.9375rem] font-semibold transition-colors',
                kind === k ? 'border-bloom-deep text-ink' : 'border-transparent text-muted-foreground hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="max-w-[38rem]">
            <h1 className="font-display text-[clamp(2rem,1.4rem+2vw,2.75rem)] leading-[1] font-semibold tracking-[-0.04em]">
              {kind === 'themes' ? 'Themes' : kind === 'connections' ? 'Connections' : 'Widgets'}
            </h1>
            <p className="mt-3 font-serif text-[1.0625rem] leading-snug text-muted-foreground">
              {kind === 'connections'
                ? 'The tools you use every day, joined to mine so their data fills your widgets. Each one is a short checklist: sign in on the tool’s own page, or paste a token. What you paste stays encrypted on this computer.'
                : kind === 'themes'
                ? 'Whole looks for mine: colours for light and dark, fonts and corners. Each preview is drawn in the real theme. Applying one is instant, and you can undo it.'
                : 'Every one of these is live and running on sample data, so try them out. Nothing you do here touches your real lists. Add the ones you like to a screen.'}
            </p>
          </div>
          {kind !== 'connections' && (
          <div role="radiogroup" aria-label="Show" className="flex rounded-full border border-rule bg-surface p-0.5">
            {(
              [
                ['all', 'All'],
                ['native', 'mine’s'],
                ['yours', 'Yours'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={filter === k}
                onClick={() => onFilter(k)}
                className={cn(
                  'flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[0.8125rem] font-semibold transition-colors',
                  filter === k ? 'bg-solid text-on-solid' : 'text-muted-foreground hover:text-ink',
                )}
              >
                {label}
                <span className={cn('font-mono text-[10px] font-normal', filter === k ? 'text-on-solid-muted' : 'text-neutral')}>{counts[k]}</span>
              </button>
            ))}
          </div>
          )}
        </header>

        {kind === 'themes' && themes}
        {kind === 'connections' && connections}

        {kind === 'widgets' && filter !== 'yours' && (
          <section aria-labelledby="market-native" className="mt-10">
            <h2 id="market-native" className="mb-3 font-mono text-[10.5px] text-neutral uppercase">
              Made by mine
            </h2>
            <div className={grid}>{native.map(card)}</div>
          </section>
        )}

        {kind === 'widgets' && filter !== 'native' && (
          <section aria-labelledby="market-yours" className="mt-10">
            <h2 id="market-yours" className="mb-3 font-mono text-[10.5px] text-neutral uppercase">
              Made for you
            </h2>
            {yours.length ? (
              <div className={grid}>{yours.map(card)}</div>
            ) : (
              <div className="rounded-xl border border-dashed border-rule px-6 py-10 text-center">
                <p className="font-serif text-[1.0625rem] text-muted-foreground">
                  Nothing of yours yet. Ask mine for one, like “make me a widget that tracks what I’m reading”.
                </p>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
