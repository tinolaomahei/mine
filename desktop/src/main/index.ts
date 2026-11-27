import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, session, shell } from 'electron'
import type { RunRequest, Settings } from '@shared/ipc'
import { detectHarnesses } from './harness/detect'
import { cancelAgent, cancelAll, runAgent, stopTool } from './harness/run'
import { getSettings, setSettings } from './settings'
import { onSpeechStatus, prepareSpeech, speechStatus, stopSpeech, transcribe } from './speech/service'
import { agentContext, frameColors, watchTheme } from './theme'
import { wireDecisions } from './decisions'
import { wireConversations } from './conversations'
import { wireFiles } from './files'
import { wireCommands } from './commands'
import { reloadWidgets, registerWidgetScheme, widgets, wireWidgets } from './widgets'
import { dataCall, dataDir } from './data-store'
import { mkdirSync, watch } from 'node:fs'


// One place on disk for settings and the speech model, however we're launched.
app.setName('mine')
app.setPath('userData', join(app.getPath('appData'), 'mine'))
registerWidgetScheme()

let win: BrowserWindow | undefined
let ctx: ReturnType<typeof agentContext>

function createWindow() {
  // the frame is drawn before React loads, so it takes the theme's colours as hex
  const frame = frameColors()
  win = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 440,
    minHeight: 560,
    show: false,
    title: 'mine',
    icon: join(__dirname, '../../resources/icon.png'),
    backgroundColor: frame.paper,
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 18, y: 18 } }
      : { titleBarOverlay: { color: frame.paper, symbolColor: frame.ink, height: 48 } }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => win?.show())

  // Ctrl+W goes to the window (closing a tab in the explorer, else the window)
  // instead of straight to the default menu's Close.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && (input.control || input.meta) && !input.shift && !input.alt && input.key.toLowerCase() === 'w') {
      e.preventDefault()
      win?.webContents.send('shortcut', 'close-tab')
    }
  })

  // unsaved edits in the explorer: ask before the window goes
  win.webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win!, {
      type: 'question',
      buttons: ['Close without saving', 'Stay'],
      defaultId: 1,
      cancelId: 1,
      title: 'mine',
      message: 'You have unsaved changes.',
      detail: 'Files you edited in the explorer haven’t been saved.',
    })
    if (choice === 0) e.preventDefault()
  })

  // Links open in the real browser; the window itself never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) e.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function wireIpc() {
  ipcMain.handle('harness:detect', () => detectHarnesses(true))

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    const next = setSettings(patch)
    if (patch.theme) nativeTheme.themeSource = next.theme
    return next
  })
  ipcMain.handle('settings:pick-workdir', async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Where should agents work?',
      defaultPath: getSettings().workdir,
      properties: ['openDirectory', 'createDirectory'],
    })
    return res.canceled || !res.filePaths[0] ? getSettings() : setSettings({ workdir: res.filePaths[0] })
  })

  ipcMain.handle('speech:status', () => speechStatus())
  ipcMain.handle('speech:prepare', () => prepareSpeech())
  ipcMain.handle('speech:transcribe', (_e, samples: Float32Array) => transcribe(samples))
  onSpeechStatus((s) => win?.webContents.send('speech:status', s))

  ipcMain.handle('agent:run', (e, req: RunRequest) => {
    const { harness, workdir } = getSettings()
    if (!harness) throw new Error('Pick a harness first.')
    void runAgent(harness, workdir, ctx, req, (ev) => {
      if (!e.sender.isDestroyed()) e.sender.send('agent:event', ev)
    })
  })
  ipcMain.handle('agent:cancel', (_e, runId: string) => cancelAgent(runId))
  ipcMain.handle('agent:stop-tool', (_e, runId: string, toolId: string) => stopTool(runId, toolId))
}

/** The data store, for the window (widgets reach it through here) and change events. */
function wireData() {
  const dir = app.getPath('userData')
  ipcMain.handle('data:call', (_e, method: string, args: unknown[]) => dataCall(dir, method, args))
  mkdirSync(dataDir(dir), { recursive: true })
  const timers = new Map<string, NodeJS.Timeout>()
  watch(dataDir(dir), (_e, name) => {
    const f = String(name ?? '')
    if (!f.endsWith('.json')) return
    const collection = f.slice(0, -5)
    clearTimeout(timers.get(collection))
    timers.set(collection, setTimeout(() => win?.webContents.send('data:changed', collection), 60))
  })
}

app.whenReady().then(() => {
  // The microphone is the only permission the window gets.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => {
    cb(permission === 'media' && (details as { mediaTypes?: string[] }).mediaTypes?.every((t) => t === 'audio') !== false)
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')

  nativeTheme.themeSource = getSettings().theme
  watchTheme(() => win)
  wireData()
  wireFiles()
  wireWidgets(() => win)
  const showWidget = (name: string, props: unknown) => win?.webContents.send('widgets:show', { name, props })
  const pipe = wireCommands(() => win, {
    showWidget,
    pipe: {
      widgets: () => widgets(),
      reloadWidgets: () => reloadWidgets(),
      show: (req) => showWidget(String(req.name ?? ''), req.props ?? {}),
    },
  })
  ctx = agentContext(pipe)

  wireIpc()
  wireDecisions()
  wireConversations()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  cancelAll()
  stopSpeech()
})
