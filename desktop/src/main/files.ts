import { openSync, readSync, closeSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { ipcMain, shell } from 'electron'
import type { FileEntry, FileListing, FilePreview, FileSaved } from '@shared/commands'

// Reading a file for the preview in a file view: text (capped), images as
// data URLs, and anything binary or huge just described.

const TEXT_MAX = 256 * 1024
const IMAGE_MAX = 10 * 1024 * 1024
const IMAGES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
}

export function previewFile(path: string): FilePreview {
  const st = statSync(path)
  if (st.isDirectory()) return { kind: 'error', path, message: 'That’s a folder.' }
  const ext = extname(path).toLowerCase()
  const base = { path, size: st.size, modified: st.mtimeMs }

  if (IMAGES[ext]) {
    if (st.size > IMAGE_MAX) return { kind: 'binary', ...base }
    return { kind: 'image', ...base, src: `data:${IMAGES[ext]};base64,${readFileSync(path).toString('base64')}` }
  }

  const n = Math.min(st.size, TEXT_MAX)
  const buf = Buffer.alloc(n)
  const fd = openSync(path, 'r')
  try {
    readSync(fd, buf, 0, n, 0)
  } finally {
    closeSync(fd)
  }
  // a NUL byte early on means it isn't text
  if (buf.subarray(0, 8192).includes(0)) return { kind: 'binary', ...base }
  let text = buf.toString('utf8')
  const bom = text.charCodeAt(0) === 0xfeff
  if (st.size > TEXT_MAX) text = text.slice(0, text.lastIndexOf('\n') > 0 ? text.lastIndexOf('\n') : text.length)
  return { kind: 'text', ...base, text: text.replace(/^﻿/, ''), truncated: st.size > TEXT_MAX, ext, bom }
}

const LIST_MAX = 3000

/** One folder's contents, folders first, for the explorer's tree. */
export function listDir(path: string): FileListing {
  const all = readdirSync(path, { withFileTypes: true })
  const entries: FileEntry[] = []
  for (const d of all.slice(0, LIST_MAX)) {
    const full = join(path, d.name)
    let isDir = d.isDirectory()
    let size: number | undefined
    let modified: number | undefined
    try {
      const st = statSync(full)
      isDir = st.isDirectory()
      size = isDir ? undefined : st.size
      modified = st.mtimeMs
    } catch {
      /* broken link or no access: list it anyway */
    }
    entries.push({ name: d.name, path: full, kind: isDir ? 'dir' : 'file', size, modified })
  }
  entries.sort((a, b) =>
    a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
  )
  const parent = dirname(path)
  return { path, parent: parent !== path ? parent : undefined, entries, more: Math.max(0, all.length - LIST_MAX) }
}

/**
 * Save text to a file. Refuses if the file changed on disk since `expected`
 * (its modified time when opened), unless forced.
 */
export function saveFile(path: string, text: string, expected?: number, force = false): FileSaved {
  try {
    const st = statSync(path, { throwIfNoEntry: false })
    if (st?.isDirectory()) return { ok: false, error: 'That’s a folder.' }
    if (st && expected && !force && Math.abs(st.mtimeMs - expected) > 1)
      return { ok: false, conflict: true, error: 'It changed on disk since you opened it.' }
    writeFileSync(path, text, 'utf8')
    return { ok: true, modified: statSync(path).mtimeMs }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return { ok: false, error: code === 'EPERM' || code === 'EACCES' ? 'mine isn’t allowed to write that file.' : (err as Error).message }
  }
}

export function wireFiles() {
  ipcMain.handle('files:write', (_e, path: string, text: string, expected?: number, force?: boolean) =>
    saveFile(String(path), String(text), expected, force === true),
  )
  ipcMain.handle('files:list', (_e, path: string) => {
    try {
      return listDir(String(path))
    } catch (err) {
      return { path, entries: [], error: (err as NodeJS.ErrnoException).code === 'EPERM' ? 'mine isn’t allowed to read that folder.' : (err as Error).message }
    }
  })
  ipcMain.handle('files:read', (_e, path: string) => {
    try {
      return previewFile(String(path))
    } catch (err) {
      return { kind: 'error', path, message: (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'That file isn’t there any more.' : (err as Error).message }
    }
  })
  ipcMain.handle('files:open', (_e, path: string) => shell.openPath(String(path)))
}
