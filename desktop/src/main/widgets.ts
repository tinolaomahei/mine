import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, watch } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'
import { app, ipcMain, net, protocol, shell, type BrowserWindow } from 'electron'
import { pathToFileURL } from 'node:url'
import { googleFontsUrl, themeCss } from '@shared/theme'
import { WIDGET_NAME, type WidgetInfo } from '@shared/widgets'
import { approve, forget, hashOf, isApproved } from './approvals'
import { themeState } from './theme'

// Widgets live in userData/widgets/<name>/ and are served over mine-widget://
// with a strict content policy: inline code runs, nothing reaches the network.
// Nothing is served until the person approves the folder's exact contents.

export const SCHEME = 'mine-widget'
export const widgetsDir = () => join(app.getPath('userData'), 'widgets')

const MAX_FILES = 60
const MAX_BYTES = 5 * 1024 * 1024

let list: WidgetInfo[] = []
let getWin: () => BrowserWindow | undefined = () => undefined

/** Must run before the app is ready. */
export function registerWidgetScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true } }])
}

const CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' ${SCHEME}:`,
  `style-src 'unsafe-inline' ${SCHEME}: https://fonts.googleapis.com`,
  `font-src ${SCHEME}: data: https://fonts.gstatic.com`,
  `img-src ${SCHEME}: data: blob:`,
  `media-src ${SCHEME}: data: blob:`,
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}

function filesOf(dir: string) {
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (out.length > MAX_FILES) throw new Error(`More than ${MAX_FILES} files.`)
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile()) out.push(p)
    }
  }
  walk(dir)
  return out.sort()
}

/** One hash over every file's path and bytes, so any change needs approving again. */
function folderHash(dir: string) {
  let total = 0
  const parts: Buffer[] = []
  for (const f of filesOf(dir)) {
    const bytes = readFileSync(f)
    total += bytes.length
    if (total > MAX_BYTES) throw new Error('Over 5 MB.')
    parts.push(Buffer.from(relative(dir, f).split(sep).join('/') + '\0'), bytes, Buffer.from('\0'))
  }
  return hashOf(Buffer.concat(parts))
}

function readWidget(name: string): WidgetInfo {
  const dir = join(widgetsDir(), name)
  const base: WidgetInfo = { name, title: name, description: '', examples: [], data: [], approved: false, dir }
  try {
    const meta = JSON.parse(readFileSync(join(dir, 'widget.json'), 'utf8'))
    statSync(join(dir, 'index.html'))
    const data = Array.isArray(meta.data) ? meta.data.map(String) : []
    return {
      ...base,
      title: String(meta.title ?? name),
      description: String(meta.description ?? ''),
      examples: Array.isArray(meta.examples) ? meta.examples.map(String).slice(0, 8) : [],
      data: data.filter((c: string) => /^[a-z0-9][a-z0-9_-]{0,47}$/.test(c)),
      approved: isApproved('widget', name, folderHash(dir)),
    }
  } catch (err) {
    return { ...base, error: (err as Error).message.split('\n')[0] }
  }
}

export function reloadWidgets() {
  let names: string[] = []
  try {
    names = readdirSync(widgetsDir(), { withFileTypes: true })
      .filter((e) => e.isDirectory() && WIDGET_NAME.test(e.name))
      .map((e) => e.name)
  } catch {
    /* none yet */
  }
  list = names.map(readWidget)
  const w = getWin()
  if (w && !w.isDestroyed()) w.webContents.send('widgets:changed', list)
  return list
}

export const widgets = () => list

// --- what every widget gets -----------------------------------------------------

/** The theme as CSS, with short names for the fonts. */
function baseCss() {
  const theme = themeState().theme
  // Bloom's fonts are bundled with the app as "<Name> Variable"; widgets get the Google copies
  const alias = (f: string) => f.replace(/'([^']+) Variable'/g, "'$1 Variable', '$1'")
  const google = [...theme.fonts.google]
  const all = [theme.fonts.display, theme.fonts.ui, theme.fonts.body, theme.fonts.mono].join(',')
  if (all.includes('Familjen Grotesk')) google.push('Familjen Grotesk:wght@400..700')
  if (all.includes('Newsreader')) google.push('Newsreader:opsz,wght@6..72,400..600')
  if (all.includes('Martian Mono')) google.push('Martian Mono:wght@400;500')
  const url = googleFontsUrl([...new Set(google)])
  return `${url ? `@import url("${url}");\n` : ''}${themeCss(theme)}
:root {
  color-scheme: light dark;
  --font-display: ${alias(theme.fonts.display)};
  --font-ui: ${alias(theme.fonts.ui)};
  --font-body: ${alias(theme.fonts.body)};
  --font-mono: ${alias(theme.fonts.mono)};
}
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; background: transparent; }
body { color: var(--ink); font: 15px/1.45 var(--font-ui); -webkit-font-smoothing: antialiased; }
button, input, select, textarea { font: inherit; color: inherit; }
`
}

const BRIDGE = `(() => {
  let n = 0
  const pending = new Map()
  const watchers = new Map()
  const call = (method, ...args) =>
    new Promise((resolve, reject) => {
      const id = ++n
      pending.set(id, { resolve, reject })
      parent.postMessage({ mine: 1, id, method, args }, '*')
    })
  let props = {}
  try { props = JSON.parse(decodeURIComponent(location.hash.slice(1)) || '{}') } catch {}
  addEventListener('message', (e) => {
    if (e.source !== parent) return
    const m = e.data
    if (!m || !m.mine) return
    if (m.id) {
      const p = pending.get(m.id)
      pending.delete(m.id)
      if (p) m.ok ? p.resolve(m.value) : p.reject(new Error(m.error))
    } else if (m.event === 'data') {
      for (const fn of watchers.get(m.collection) || []) try { fn() } catch (err) { console.error(err) }
    } else if (m.event === 'theme') {
      const link = document.getElementById('mine-base')
      if (link) link.href = '${SCHEME}://_/base.css?' + Date.now()
    }
  })
  window.mine = {
    props,
    data: {
      list: (c, where) => call('data.list', c, where),
      get: (c, id) => call('data.get', c, id),
      put: (c, doc) => call('data.put', c, doc),
      patch: (c, id, fields) => call('data.patch', c, id, fields),
      remove: (c, id) => call('data.remove', c, id),
      watch(c, fn) {
        if (!watchers.has(c)) watchers.set(c, new Set())
        watchers.get(c).add(fn)
        return () => watchers.get(c).delete(fn)
      },
    },
    run: (command, params) => call('run', command, params || {}),
    ask: (text) => call('ask', String(text)),
  }
  const size = () => parent.postMessage({ mine: 1, event: 'height', height: Math.ceil(document.documentElement.getBoundingClientRect().height) }, '*')
  addEventListener('DOMContentLoaded', () => { new ResizeObserver(size).observe(document.documentElement); size() })
  addEventListener('error', (e) => parent.postMessage({ mine: 1, event: 'error', message: String(e.message || e) }, '*'))
  addEventListener('unhandledrejection', (e) => parent.postMessage({ mine: 1, event: 'error', message: String((e.reason && e.reason.message) || e.reason) }, '*'))
})()
`

const respond = (body: string | Buffer, type: string, status = 200) =>
  new Response(typeof body === 'string' ? body : new Uint8Array(body), { status, headers: { 'content-type': type, 'content-security-policy': CSP, 'cache-control': 'no-store' } })

function inject(html: string) {
  const head = `<meta charset="utf-8"><link id="mine-base" rel="stylesheet" href="${SCHEME}://_/base.css"><script src="${SCHEME}://_/bridge.js"></script>`
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + head) : head + html
}

function serve(req: Request) {
  const url = new URL(req.url)
  const host = url.hostname
  if (host === '_') {
    if (url.pathname === '/base.css') return respond(baseCss(), TYPES['.css'])
    if (url.pathname === '/bridge.js') return respond(BRIDGE, TYPES['.js'])
    return respond('Not found', 'text/plain', 404)
  }
  if (!WIDGET_NAME.test(host)) return respond('Not found', 'text/plain', 404)
  const dir = join(widgetsDir(), host)
  // check the exact files on disk now, not what was there at the last scan
  let ok = false
  try {
    ok = isApproved('widget', host, folderHash(dir))
  } catch {
    ok = false
  }
  if (!ok) return respond('This widget isn’t approved.', 'text/plain', 403)
  const path = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)
  const file = resolve(dir, '.' + path)
  if (!file.startsWith(dir + sep)) return respond('Not found', 'text/plain', 404)
  const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
  try {
    if (extname(file).toLowerCase() === '.html') return respond(inject(readFileSync(file, 'utf8')), type)
    return net.fetch(pathToFileURL(file).toString()).then(async (r) => respond(Buffer.from(await r.arrayBuffer()), type, r.status))
  } catch {
    return respond('Not found', 'text/plain', 404)
  }
}

export function approveWidget(name: string) {
  if (!WIDGET_NAME.test(name)) throw new Error('Not a widget name.')
  approve('widget', name, folderHash(join(widgetsDir(), name)))
  return reloadWidgets()
}

export function removeWidget(name: string) {
  if (!WIDGET_NAME.test(name)) throw new Error('Not a widget name.')
  rmSync(join(widgetsDir(), name), { recursive: true, force: true })
  forget('widget', name)
  return reloadWidgets()
}

export function wireWidgets(win: () => BrowserWindow | undefined) {
  getWin = win
  protocol.handle(SCHEME, serve)
  reloadWidgets()

  let timer: NodeJS.Timeout | undefined
  const rescan = () => {
    clearTimeout(timer)
    timer = setTimeout(reloadWidgets, 200)
  }
  try {
    mkdirSync(widgetsDir(), { recursive: true })
    watch(widgetsDir(), { recursive: true }, rescan)
  } catch {
    /* recursive watch unsupported: rescans happen on approve/remove */
  }

  ipcMain.handle('widgets:list', () => list)
  // only ever from the window: the person clicking Approve
  ipcMain.handle('widgets:approve', (_e, name: string) => approveWidget(name))
  ipcMain.handle('widgets:remove', (_e, name: string) => removeWidget(name))
  ipcMain.handle('widgets:reveal', (_e, name: string) => {
    if (WIDGET_NAME.test(name)) void shell.openPath(join(widgetsDir(), name))
  })
}
