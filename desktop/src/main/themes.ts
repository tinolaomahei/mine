import { mkdirSync, readdirSync, readFileSync, rmSync, watch } from 'node:fs'
import { join } from 'node:path'
import { app, ipcMain, type BrowserWindow } from 'electron'
import { validatePatch, type ThemePatch } from '@shared/theme'
import { THEME_ID, type ThemeInfo } from '@shared/themes'
import { loadPatch, savePatch, saveTheme } from './theme-store'

// The theme marketplace's shelves: mine's own themes (resources/themes) and
// the person's (userData/themes). Applying one replaces the current theme
// through the same history as everything else, so undo works.

const NATIVE = '.native'
export const nativeThemesDir = () => join(__dirname, '../../resources/themes')
export const yourThemesDir = () => join(app.getPath('userData'), 'themes')

let getWin: () => BrowserWindow | undefined = () => undefined

function read(dir: string, file: string, source: ThemeInfo['source']): ThemeInfo | null {
  const name = file.replace(/\.json$/, '')
  if (!THEME_ID.test(name)) return null
  const id = source === 'native' ? name + NATIVE : name
  try {
    const raw = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    const patch = (raw.theme ?? {}) as ThemePatch
    const errors = validatePatch(patch)
    return {
      id,
      name: String(raw.name ?? patch.name ?? name).slice(0, 60),
      description: String(raw.description ?? '').slice(0, 400),
      source,
      patch: errors.length ? {} : patch,
      ...(errors.length ? { error: errors.join(' ') } : {}),
    }
  } catch (err) {
    return { id, name, description: '', source, patch: {}, error: (err as Error).message }
  }
}

const shelf = (dir: string, source: ThemeInfo['source']) => {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => read(dir, f, source))
      .filter((t): t is ThemeInfo => !!t)
  } catch {
    return []
  }
}

/** Every theme: Bloom first, then mine's others, then the person's. */
export function listThemes(): ThemeInfo[] {
  const native = shelf(nativeThemesDir(), 'native').sort((a, b) => (a.id === 'bloom' + NATIVE ? -1 : b.id === 'bloom' + NATIVE ? 1 : a.name.localeCompare(b.name)))
  return [...native, ...shelf(yourThemesDir(), 'yours').sort((a, b) => a.name.localeCompare(b.name))]
}

const changed = () => {
  const w = getWin()
  if (w && !w.isDestroyed()) w.webContents.send('themes:changed', listThemes())
}

/** Make a theme the current look. */
export function applyTheme(id: string): string | null {
  const t = listThemes().find((x) => x.id === id)
  if (!t) return 'There’s no theme like that.'
  if (t.error) return `${t.name} is broken: ${t.error}`
  const errors = savePatch(app.getPath('userData'), { ...t.patch, name: t.name }, true)
  return errors.length ? errors.join(' ') : null
}

export function wireThemes(win: () => BrowserWindow | undefined) {
  getWin = win
  try {
    mkdirSync(yourThemesDir(), { recursive: true })
    let t: NodeJS.Timeout | undefined
    watch(yourThemesDir(), () => {
      clearTimeout(t)
      t = setTimeout(changed, 150)
    })
  } catch {
    /* no watching: saves and removes still announce themselves */
  }

  ipcMain.handle('themes:list', () => listThemes())
  ipcMain.handle('themes:apply', (_e, id: string) => applyTheme(String(id)))
  // keep the look on screen now as one of the person's themes
  ipcMain.handle('themes:save-current', (_e, name?: string, description?: string) => {
    const patch = loadPatch(app.getPath('userData')).patch
    const title = String(name ?? '').trim().slice(0, 60) || patch.name || 'My theme'
    const r = saveTheme(yourThemesDir(), title, String(description ?? '').slice(0, 400), patch)
    changed()
    return r
  })
  ipcMain.handle('themes:remove', (_e, id: string) => {
    const name = String(id)
    if (!THEME_ID.test(name)) return false
    rmSync(join(yourThemesDir(), `${name}.json`), { force: true })
    changed()
    return true
  })
}
