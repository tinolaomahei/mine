import { GRID, type ScreenItem } from '@shared/widgets'

// The maths of a screen: a 12-column grid with fixed-height rows. Widgets sit
// where the person puts them. When one lands on others, those slide down just
// far enough to make room, and nothing else moves.

type Box = Pick<ScreenItem, 'x' | 'y' | 'w' | 'h'>

export const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

export function clampBox<T extends Box>(b: T, min: { w: number; h: number } = { w: 1, h: 1 }): T {
  const w = Math.max(min.w, Math.min(GRID.cols, Math.round(b.w)))
  const h = Math.max(min.h, Math.min(24, Math.round(b.h)))
  return {
    ...b,
    w,
    h,
    x: Math.max(0, Math.min(GRID.cols - w, Math.round(b.x))),
    y: Math.max(0, Math.round(b.y)),
  }
}

/**
 * Put `moved` where it is and push whatever it now covers downwards, in
 * reading order, until nothing overlaps. Items that weren't in the way stay
 * exactly where they were.
 */
export function settle(items: ScreenItem[], movedId: string): ScreenItem[] {
  const moved = items.find((i) => i.id === movedId)
  if (!moved) return items
  const placed: ScreenItem[] = [moved]
  const rest = items.filter((i) => i.id !== movedId).sort((a, b) => a.y - b.y || a.x - b.x)
  for (const it of rest) {
    const c = { ...it }
    for (;;) {
      const hit = placed.filter((p) => overlaps(p, c))
      if (!hit.length) break
      c.y = Math.max(...hit.map((p) => p.y + p.h))
    }
    placed.push(c)
  }
  // keep the original order so React keys stay put
  return items.map((i) => placed.find((p) => p.id === i.id)!)
}

/** The first free spot for a w×h box, reading left to right, top to bottom. */
export function firstFree(items: Box[], w: number, h: number): { x: number; y: number } {
  const width = Math.min(w, GRID.cols)
  for (let y = 0; y < 500; y++)
    for (let x = 0; x + width <= GRID.cols; x++) if (!items.some((i) => overlaps(i, { x, y, w: width, h }))) return { x, y }
  return { x: 0, y: Math.max(0, ...items.map((i) => i.y + i.h)) }
}

/** Rows used: the bottom edge of the lowest widget. */
export const rowsUsed = (items: Box[]) => Math.max(0, ...items.map((i) => i.y + i.h))

/** Pixel geometry for a given container width. */
export function geometry(width: number, pad: number) {
  const col = Math.max(24, (width - pad * 2 - GRID.gap * (GRID.cols - 1)) / GRID.cols)
  const stepX = col + GRID.gap
  const stepY = GRID.row + GRID.gap
  return {
    col,
    stepX,
    stepY,
    left: (x: number) => pad + x * stepX,
    top: (y: number) => pad + y * stepY,
    width: (w: number) => w * col + (w - 1) * GRID.gap,
    height: (h: number) => h * GRID.row + (h - 1) * GRID.gap,
  }
}

/** Where a widget sits, in words: "top left", "bottom right"… */
export function whereIs(i: Box, all: Box[]) {
  const rows = Math.max(1, rowsUsed(all))
  const cx = i.x + i.w / 2
  const cy = i.y + i.h / 2
  const h = cx < GRID.cols / 3 ? 'left' : cx > (GRID.cols * 2) / 3 ? 'right' : 'middle'
  const v = rows <= i.h ? '' : cy < rows / 3 ? 'top' : cy > (rows * 2) / 3 ? 'bottom' : ''
  return v ? (h === 'middle' ? v : `${v} ${h}`) : h
}
