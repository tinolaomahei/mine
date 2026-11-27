import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { mergePatch, validatePatch, type ThemePatch } from '@shared/theme'

// The theme on disk. Shared by the app (which watches it) and the MCP server
// an agent talks to (which writes it). theme.json holds only the overrides on
// top of Bloom; theme-history.json keeps earlier versions for undo.

const HISTORY_MAX = 40

export const themeFile = (dir: string) => join(dir, 'theme.json')
const historyFile = (dir: string) => join(dir, 'theme-history.json')

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, value: unknown) {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  renameSync(tmp, file) // atomic, so the watcher never sees half a file
}

export type Loaded = { patch: ThemePatch; error?: string }

/** Read the stored patch. A broken file is reported, not applied. */
export function loadPatch(dir: string): Loaded {
  const file = themeFile(dir)
  if (!existsSync(file)) return { patch: {} }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    return { patch: {}, error: `theme.json is not valid JSON: ${(err as Error).message}` }
  }
  const errors = validatePatch(raw)
  return errors.length ? { patch: {}, error: errors.join(' ') } : { patch: raw as ThemePatch }
}

export function history(dir: string): ThemePatch[] {
  return readJson<ThemePatch[]>(historyFile(dir), [])
}

function commit(dir: string, next: ThemePatch) {
  mkdirSync(dir, { recursive: true })
  const prev = loadPatch(dir).patch
  const past = history(dir)
  past.push(prev)
  writeJson(historyFile(dir), past.slice(-HISTORY_MAX))
  writeJson(themeFile(dir), next)
}

/** Apply a patch (merged onto the current one, or replacing it). */
export function savePatch(dir: string, patch: ThemePatch, replace = false): string[] {
  const errors = validatePatch(patch)
  if (errors.length) return errors
  commit(dir, replace ? patch : mergePatch(loadPatch(dir).patch, patch))
  return []
}

export function undoPatch(dir: string): boolean {
  const past = history(dir)
  const prev = past.pop()
  if (!prev) return false
  writeJson(historyFile(dir), past)
  writeJson(themeFile(dir), prev)
  return true
}

export function resetPatch(dir: string) {
  commit(dir, {})
}

/** For set_appearance: flip the app between system, light and dark. */
export function setAppearance(dir: string, theme: 'system' | 'light' | 'dark') {
  const file = join(dir, 'settings.json')
  writeJson(file, { ...readJson<Record<string, unknown>>(file, {}), theme })
}

/**
 * For set_workdir: point mine's agents at another folder. Accepts ~, %VAR%,
 * $VAR and paths relative to the current folder. Returns the resolved folder,
 * or an error message.
 */
export function setWorkdir(dir: string, input: string): { path?: string; error?: string } {
  const file = join(dir, 'settings.json')
  const settings = readJson<Record<string, unknown>>(file, {})
  const current = typeof settings.workdir === 'string' ? settings.workdir : homedir()
  let p = input.trim().replace(/^["']|["']$/g, '')
  p = p.replace(/%([^%]+)%/g, (m, v) => process.env[v] ?? m).replace(/\$(\w+)|\$\{(\w+)\}/g, (m, a, b) => process.env[a ?? b] ?? m)
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = join(homedir(), p.slice(1))
  const target = isAbsolute(p) ? resolve(p) : resolve(current, p)
  try {
    if (!statSync(target).isDirectory()) return { error: `${target} is a file, not a folder.` }
  } catch {
    return { error: `There is no folder at ${target}.` }
  }
  writeJson(file, { ...settings, workdir: target })
  return { path: target }
}
