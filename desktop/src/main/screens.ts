import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, ipcMain, type BrowserWindow } from 'electron'
import { GRID, type Screen, type ScreenItem } from '@shared/widgets'

// Screens: blank pages the person fills with widgets and arranges on a grid.
// All of them live in one small file, userData/screens.json.

const file = () => join(app.getPath('userData'), 'screens.json')
const ID = /^[A-Za-z0-9_-]{1,64}$/
const MAX_SCREENS = 50
const MAX_ITEMS = 80

const int = (v: unknown, min: number, max: number, d: number) => Math.max(min, Math.min(max, Math.round(Number(v)) || d))

function cleanItem(raw: unknown): ScreenItem | null {
  const i = (raw ?? {}) as Record<string, unknown>
  if (typeof i.id !== 'string' || !ID.test(i.id) || typeof i.widget !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(i.widget)) return null
  const w = int(i.w, 1, GRID.cols, 4)
  return {
    id: i.id,
    widget: i.widget,
    w,
    h: int(i.h, 1, 24, 3),
    x: int(i.x, 0, GRID.cols - w, 0),
    y: int(i.y, 0, 999, 0),
    ...(i.props && typeof i.props === 'object' && !Array.isArray(i.props) ? { props: JSON.parse(JSON.stringify(i.props)) } : {}),
  }
}

function clean(raw: unknown): Screen[] {
  if (!Array.isArray(raw)) return []
  const out: Screen[] = []
  for (const r of raw.slice(0, MAX_SCREENS)) {
    const s = (r ?? {}) as Record<string, unknown>
    if (typeof s.id !== 'string' || !ID.test(s.id)) continue
    const items = Array.isArray(s.items)
      ? s.items
          .slice(0, MAX_ITEMS)
          .map(cleanItem)
          .filter((x): x is ScreenItem => !!x)
      : []
    out.push({
      id: s.id,
      name:
        String(s.name ?? 'Screen')
          .trim()
          .slice(0, 60) || 'Screen',
      items,
      createdAt: Number(s.createdAt) || Date.now(),
      updatedAt: Number(s.updatedAt) || Date.now(),
    })
  }
  return out
}

export function loadScreens(): Screen[] {
  try {
    return clean(JSON.parse(readFileSync(file(), 'utf8')).screens)
  } catch {
    return []
  }
}

function saveScreens(screens: unknown): Screen[] {
  const list = clean(screens)
  const f = file()
  mkdirSync(dirname(f), { recursive: true })
  const tmp = `${f}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify({ screens: list }, null, 1))
  renameSync(tmp, f)
  return list
}

export function wireScreens(_win: () => BrowserWindow | undefined) {
  ipcMain.handle('screens:list', () => loadScreens())
  ipcMain.handle('screens:save', (_e, screens: unknown) => saveScreens(screens))
}
