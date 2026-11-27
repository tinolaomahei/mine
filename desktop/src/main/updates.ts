import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import type { UpdateState } from '@shared/ipc'
import { getSettings } from './settings'

// mine updates itself from the latest published GitHub release. Windows and
// Linux download it in the background and install it when mine restarts. A Mac
// copy that isn't signed with a Developer ID can't replace itself, so there it's
// a download from the release page.

const RELEASE_PAGE = 'https://github.com/tinolaomahei/mine/releases/latest'
const FIRST_CHECK_MS = 15_000
const EVERY_MS = 4 * 60 * 60 * 1000

let state: UpdateState = { state: 'idle' }
let selfInstall: Promise<boolean> | undefined
let send: (s: UpdateState) => void = () => {}

function set(next: UpdateState) {
  state = next
  send(state)
}

function signedMac(): Promise<boolean> {
  const bundle = resolve(process.execPath, '..', '..', '..')
  return new Promise((done) => {
    execFile('codesign', ['-dv', '--verbose=2', bundle], (_err, stdout, stderr) => done(/Authority=Developer ID Application/.test(`${stdout}${stderr}`)))
  })
}

function linuxPackage() {
  return !!process.env.APPIMAGE || existsSync(join(process.resourcesPath, 'package-type'))
}

/** Whether this copy of mine can replace itself, or needs a download. */
function canInstallItself(): Promise<boolean> {
  if (process.platform === 'darwin') return signedMac()
  if (process.platform === 'linux') return Promise.resolve(linuxPackage())
  return Promise.resolve(true)
}

const DEVELOPING = 'Updates work in the installed app, not while developing mine.'

function plainError(err: Error): string {
  const m = err.message
  if (/No published versions/i.test(m)) return 'There’s no published release on GitHub yet.'
  if (/latest(-mac|-linux)?\.yml/i.test(m)) return 'The latest release doesn’t have update files, so this one has to be downloaded by hand.'
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ERR_INTERNET|net::/i.test(m)) return 'Couldn’t reach GitHub. Check the internet connection and try again.'
  return `Couldn’t check for updates: ${m.split('\n')[0]}`
}

async function onAvailable(info: UpdateInfo) {
  const manual = !(await (selfInstall ??= canInstallItself()))
  set({ state: 'available', version: info.version, manual })
  if (!manual) void autoUpdater.downloadUpdate().catch((err: Error) => set({ state: 'error', message: plainError(err) }))
}

function onProgress(p: ProgressInfo) {
  if (state.state === 'available' || state.state === 'downloading') set({ state: 'downloading', version: state.version, percent: Math.round(p.percent) })
}

function listen() {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }))
  autoUpdater.on('update-not-available', () => set({ state: 'current', checkedAt: Date.now() }))
  autoUpdater.on('update-available', (info) => void onAvailable(info))
  autoUpdater.on('download-progress', onProgress)
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }))
  autoUpdater.on('error', (err) => {
    if (state.state !== 'ready') set({ state: 'error', message: plainError(err) })
  })
}

/** Look for a new version, unless one is already on its way or waiting. */
export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged) {
    set({ state: 'off', reason: DEVELOPING })
    return state
  }
  if (['checking', 'downloading', 'ready'].includes(state.state)) return state
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    set({ state: 'error', message: plainError(err as Error) })
  }
  return state
}

function installNow() {
  if (state.state !== 'ready') return
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
}

function checkOnSchedule() {
  if (getSettings().autoUpdate !== false) void checkForUpdates()
}

export function wireUpdates(getWin: () => BrowserWindow | null | undefined) {
  send = (s) => getWin()?.webContents.send('updates:changed', s)
  ipcMain.handle('updates:state', () => state)
  ipcMain.handle('updates:check', () => checkForUpdates())
  ipcMain.handle('updates:install', () => installNow())
  ipcMain.handle('updates:open-release', () => shell.openExternal(RELEASE_PAGE))
  if (!app.isPackaged) return set({ state: 'off', reason: DEVELOPING })
  listen()
  setTimeout(checkOnSchedule, FIRST_CHECK_MS)
  setInterval(checkOnSchedule, EVERY_MS)
}
