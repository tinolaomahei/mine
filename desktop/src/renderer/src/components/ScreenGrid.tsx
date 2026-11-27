import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { LayoutDashboard, Plus, RotateCw, X } from 'lucide-react'
import { GRID, type Screen, type ScreenItem } from '@shared/widgets'
import { useAbilities } from '@/lib/abilities'
import { clampBox, geometry, rowsUsed, settle } from '@/lib/grid'
import { cn } from '@/lib/utils'
import { WidgetFrame } from './WidgetFrame'

// A screen: a blank page on a 12-column grid. Widgets sit where the person
// puts them, with no chrome of their own: hover one and a handle shows along
// its top edge (drag it), a corner to resize from, and buttons to reload or
// remove it. The keyboard works too. Whatever it lands on slides down out of
// the way.

const PAD = 20

type Drag = {
  id: string
  mode: 'move' | 'resize'
  px: number
  py: number
  scroll: number
  orig: ScreenItem
  base: ScreenItem[]
  min: { w: number; h: number }
}
type Live = {
  items: ScreenItem[]
  id: string
  mode: Drag['mode']
  dx: number
  dy: number
}

export function ScreenGrid({
  screen,
  onItems,
  onRemoveItem,
  onBrowse,
  intro,
  notice,
}: {
  screen: Screen
  onItems: (items: ScreenItem[]) => void
  onRemoveItem: (id: string) => void
  onBrowse: () => void
  /** What an empty screen shows instead of the grid: how to set it up. */
  intro?: ReactNode
  /** A slim note above the widgets, e.g. tools still to connect. */
  notice?: ReactNode
}) {
  const { widgets } = useAbilities()
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const drag = useRef<Drag | null>(null)
  const [live, setLive] = useState<Live | null>(null)
  const liveRef = useRef<Live | null>(null)
  const [reloads, setReloads] = useState<Record<string, number>>({})
  const [status, setStatus] = useState('')

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
    // the empty state and the grid are different elements
  }, [screen.items.length === 0])

  const g = geometry(width, PAD)
  const items = live?.items ?? screen.items
  const info = (it: ScreenItem) => widgets.find((w) => w.id === it.widget)
  const titleOf = (it: ScreenItem) => info(it)?.title ?? it.widget
  const minOf = (it: ScreenItem) => info(it)?.minSize ?? { w: 1, h: 1 }

  const show = (l: Live | null) => {
    liveRef.current = l
    setLive(l)
  }

  // ---- pointer: drag the strip to move, the corner to resize ------------------

  const start = (e: PointerEvent<HTMLElement>, it: ScreenItem, mode: Drag['mode']) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = {
      id: it.id,
      mode,
      px: e.clientX,
      py: e.clientY,
      scroll: box.current?.scrollTop ?? 0,
      orig: it,
      base: screen.items,
      min: minOf(it),
    }
    show({ items: screen.items, id: it.id, mode, dx: 0, dy: 0 })
  }

  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current
    const el = box.current
    if (!d || !el) return
    // near the bottom edge, scroll so there's room to drop lower
    const r = el.getBoundingClientRect()
    if (e.clientY > r.bottom - 36) el.scrollTop += 14
    else if (e.clientY < r.top + 24) el.scrollTop -= 14
    const dx = e.clientX - d.px
    const dy = e.clientY - d.py + (el.scrollTop - d.scroll)
    const o = d.orig
    const next =
      d.mode === 'move'
        ? clampBox({
            ...o,
            x: o.x + Math.round(dx / g.stepX),
            y: o.y + Math.round(dy / g.stepY),
          })
        : {
            ...o,
            w: Math.max(d.min.w, Math.min(GRID.cols - o.x, o.w + Math.round(dx / g.stepX))),
            h: Math.max(d.min.h, Math.min(24, o.h + Math.round(dy / g.stepY))),
          }
    show({
      items: settle(
        d.base.map((i) => (i.id === d.id ? next : i)),
        d.id,
      ),
      id: d.id,
      mode: d.mode,
      dx,
      dy,
    })
  }

  const end = () => {
    const d = drag.current
    const l = liveRef.current
    drag.current = null
    show(null)
    if (!d || !l) return
    const was = d.base.find((i) => i.id === d.id)!
    const now = l.items.find((i) => i.id === d.id)!
    if (was.x !== now.x || was.y !== now.y || was.w !== now.w || was.h !== now.h) {
      onItems(l.items)
      setStatus(`${d.mode === 'move' ? 'Moved' : 'Resized'} ${titleOf(now)}.`)
    }
  }

  // ---- keyboard: arrows move, Shift+arrows resize, Delete removes --------------

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, it: ScreenItem) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onRemoveItem(it.id)
      return
    }
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    const s = step[e.key]
    if (!s) return
    e.preventDefault()
    const min = minOf(it)
    const next = e.shiftKey
      ? {
          ...it,
          w: Math.max(min.w, Math.min(GRID.cols - it.x, it.w + s[0])),
          h: Math.max(min.h, Math.min(24, it.h + s[1])),
        }
      : clampBox({ ...it, x: it.x + s[0], y: it.y + s[1] })
    onItems(
      settle(
        screen.items.map((i) => (i.id === it.id ? next : i)),
        it.id,
      ),
    )
    setStatus(e.shiftKey ? `${titleOf(it)} is ${next.w} wide and ${next.h} tall.` : `${titleOf(it)} is at column ${next.x + 1}, row ${next.y + 1}.`)
  }

  const rows = rowsUsed(items) + (live ? 6 : 2)
  const height = PAD * 2 + rows * g.stepY

  if (!screen.items.length && intro)
    return (
      <div ref={box} className="h-full">
        {intro}
      </div>
    )
  if (!screen.items.length)
    return (
      <div ref={box} className="grid h-full place-items-center px-6">
        <div className="flex max-w-[26rem] flex-col items-center text-center">
          <LayoutDashboard className="size-7 text-bloom-deep" strokeWidth={1.5} aria-hidden="true" />
          <h2 className="mt-4 font-display text-[1.75rem] leading-tight font-semibold tracking-[-0.03em]">{screen.name} is empty.</h2>
          <p className="mt-2 font-serif text-[1.0625rem] text-muted-foreground">
            Pick widgets from the marketplace, or ask mine for one and pin it here. Drag them where you want them.
          </p>
          <button
            type="button"
            onClick={onBrowse}
            className="mt-5 flex h-10 items-center gap-2 rounded-full bg-solid px-4 text-sm font-semibold text-on-solid transition-colors hover:bg-solid-hover"
          >
            <Plus className="size-4" />
            Browse widgets
          </button>
        </div>
      </div>
    )

  const dragged = live && screen.items.find((i) => i.id === live.id)

  return (
    <div ref={box} className="scroll-soft h-full overflow-y-auto" aria-label={`${screen.name}, a screen of widgets`}>
      {notice}
      <div className={cn('relative', live && '[&_iframe]:pointer-events-none')} style={{ height, minHeight: '100%' }}>
        {/* column guides while arranging */}
        <div
          className={cn('pointer-events-none absolute inset-0 transition-opacity duration-200', live ? 'opacity-100' : 'opacity-0')}
          aria-hidden="true"
        >
          {width > 0 &&
            Array.from({ length: GRID.cols }, (_, i) => (
              <div key={i} className="absolute top-0 bottom-0 rounded-md bg-paper-2/70" style={{ left: g.left(i), width: g.col }} />
            ))}
        </div>

        {/* where it'll land */}
        {live &&
          dragged &&
          (() => {
            const t = live.items.find((i) => i.id === live.id)!
            return (
              <div
                className="absolute rounded-xl border-2 border-dashed border-bloom-deep/50 bg-bloom-wash/50 transition-[left,top,width,height] duration-150 ease-out"
                style={{
                  left: g.left(t.x),
                  top: g.top(t.y),
                  width: g.width(t.w),
                  height: g.height(t.h),
                }}
                aria-hidden="true"
              />
            )
          })()}

        {width > 0 &&
          items.map((it) => {
            const w = info(it)
            const title = titleOf(it)
            const lifted = live?.id === it.id
            const o = lifted ? dragged! : it
            // the one being dragged follows the pointer; the rest glide to their places
            const style = lifted
              ? live.mode === 'move'
                ? {
                    left: g.left(o.x) + live.dx,
                    top: g.top(o.y) + live.dy,
                    width: g.width(o.w),
                    height: g.height(o.h),
                  }
                : {
                    left: g.left(o.x),
                    top: g.top(o.y),
                    width: Math.max(g.width(minOf(it).w), g.width(o.w) + live.dx),
                    height: Math.max(g.height(minOf(it).h), g.height(o.h) + live.dy),
                  }
              : {
                  left: g.left(it.x),
                  top: g.top(it.y),
                  width: g.width(it.w),
                  height: g.height(it.h),
                }
            return (
              <section key={it.id} aria-label={title} className={cn('group/tile absolute', lifted ? 'z-20' : 'transition-[left,top,width,height] duration-200 ease-out')} style={style}>
                <div
                  className={cn(
                    'h-full overflow-hidden rounded-xl border bg-surface transition-[border-color,box-shadow] duration-150',
                    lifted ? 'border-bloom-deep/60 shadow-[0_18px_40px_-18px_rgb(0_0_0/0.35)]' : 'border-rule group-hover/tile:border-neutral/50',
                  )}
                >
                  {w ? (
                    <WidgetFrame id={it.widget} props={it.props} place="screen" reloadKey={reloads[it.id] ?? 0} />
                  ) : (
                    <p className="p-3 text-sm text-muted-foreground">This widget isn’t here any more.</p>
                  )}
                </div>

                {/* the handle: a strip along the top edge (widgets keep their top padding clear) */}
                <div
                  className={cn('absolute inset-x-8 top-0 z-10 flex h-3.5 touch-none justify-center', lifted && live.mode === 'move' ? 'cursor-grabbing' : 'cursor-grab')}
                  onPointerDown={(e) => start(e, it, 'move')}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={end}
                >
                  <button
                    type="button"
                    onKeyDown={(e) => onKey(e, it)}
                    aria-label={`Move ${title}. Arrow keys move it, Shift with arrow keys resizes it, Delete takes it off the screen.`}
                    title={`Drag to move ${title}`}
                    className={cn(
                      'mt-[4px] h-[5px] w-10 cursor-[inherit] rounded-full bg-neutral/40 transition-opacity hover:bg-neutral/70 focus-visible:opacity-100 focus-visible:outline-offset-4',
                      lifted ? 'opacity-100' : 'opacity-0 group-hover/tile:opacity-100',
                    )}
                  />
                </div>

                {/* reload and remove, on the corner */}
                <div className="absolute -top-2.5 -right-2.5 z-20 flex gap-1 opacity-0 transition-opacity group-hover/tile:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => setReloads((r) => ({ ...r, [it.id]: (r[it.id] ?? 0) + 1 }))}
                    aria-label={`Reload ${title}`}
                    title="Reload"
                    className="grid size-6 place-items-center rounded-full border border-rule bg-surface text-neutral hover:text-ink"
                  >
                    <RotateCw className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveItem(it.id)}
                    aria-label={`Take ${title} off this screen`}
                    title="Take it off this screen"
                    className="grid size-6 place-items-center rounded-full border border-rule bg-surface text-neutral hover:border-signal/40 hover:text-signal"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>

                <div
                  className={cn(
                    'absolute right-0 bottom-0 z-10 grid size-5 cursor-nwse-resize touch-none place-items-end p-[4px] text-neutral transition-opacity',
                    lifted && live.mode === 'resize' ? 'opacity-100' : 'opacity-0 group-hover/tile:opacity-100',
                  )}
                  onPointerDown={(e) => start(e, it, 'resize')}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={end}
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 10 10" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                    <path d="M9 3 3 9M9 6.5 6.5 9" />
                  </svg>
                </div>
              </section>
            )
          })}
      </div>
      <p className="sr-only" aria-live="polite">
        {status}
      </p>
    </div>
  )
}
