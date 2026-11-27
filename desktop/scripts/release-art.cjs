// Draws a release's graphic: its tree's name, and the trunk so far. Each major
// version is a pink ring and each minor release a fine growth line inside it.
// Run with Electron: npx electron scripts/release-art.cjs 0.1.0
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = join(__dirname, '..', '..')
const W = 1280
const H = 640
const SCALE = 2
const CX = 1000
const CY = 330

const version = process.argv.find((a) => /^\d+\.\d+\.\d+$/.test(a))
if (!version) throw new Error('Pass a version, like 0.1.0')
const [major, minor] = version.split('.').map(Number)
const tree = JSON.parse(readFileSync(join(ROOT, 'releases', 'trees.json'), 'utf8'))[String(major)]
if (!tree) throw new Error(`releases/trees.json has no tree for major version ${major}`)

function seeded(text) {
  let h = 2166136261
  for (const c of text) h = Math.imul(h ^ c.codePointAt(0), 16777619)
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296
}

const rand = seeded(tree.name)
const waves = [2, 3, 5, 7].map((k) => ({ k, phase: rand() * Math.PI * 2, size: (0.009 + rand() * 0.008) / Math.sqrt(k) }))
const lean = { x: (rand() - 0.5) * 0.08, y: (rand() - 0.5) * 0.08 }

function ring(r) {
  const points = []
  for (let i = 0; i < 240; i++) {
    const t = (i / 240) * Math.PI * 2
    const wobble = waves.reduce((sum, w) => sum + w.size * Math.sin(w.k * t + w.phase), 0) * Math.min(1, r / 140)
    const rr = r * (1 + wobble)
    points.push(`${(CX + lean.x * r + rr * Math.cos(t)).toFixed(1)},${(CY + lean.y * r + rr * Math.sin(t)).toFixed(1)}`)
  }
  return `M${points.join('L')}Z`
}

const EMBLEMS = {
  manuka: () => {
    const petals = [0, 1, 2, 3, 4]
      .map((i) => {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2
        return `<ellipse cx="${CX + Math.cos(a) * 25}" cy="${CY + Math.sin(a) * 25}" rx="22" ry="20" transform="rotate(${(a * 180) / Math.PI + 90} ${CX + Math.cos(a) * 25} ${CY + Math.sin(a) * 25})" fill="var(--petal)" />`
      })
      .join('')
    const stamens = Array.from({ length: 14 }, (_, i) => {
      const a = (i / 14) * Math.PI * 2
      return `<circle cx="${CX + Math.cos(a) * 17}" cy="${CY + Math.sin(a) * 17}" r="2.4" fill="var(--accent)" />`
    }).join('')
    return `${petals}<circle cx="${CX}" cy="${CY}" r="15" fill="var(--centre)" />${stamens}`
  },
}

const emblem = (EMBLEMS[tree.emblem] ?? (() => `<circle cx="${CX}" cy="${CY}" r="34" fill="var(--accent)" />`))()

const FIRST = 92
const STEP = 42
const majors = Array.from({ length: major + 1 }, (_, i) => FIRST + i * STEP)
const growth = Array.from({ length: minor }, (_, i) => majors[major] - STEP + ((i + 1) * STEP) / (minor + 1)).filter((r) => r > 60)
const faint = Array.from({ length: 16 }, (_, i) => majors[major] + (i + 1) * STEP)

const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  ${faint.map((r, i) => `<path d="${ring(r)}" fill="none" stroke="var(--faint)" stroke-width="2" opacity="${Math.max(0.18, 0.75 - i * 0.04).toFixed(2)}" />`).join('')}
  ${growth.map((r) => `<path d="${ring(r)}" fill="none" stroke="var(--accent)" stroke-width="1.5" opacity="0.55" />`).join('')}
  ${majors.map((r) => `<path d="${ring(r)}" fill="none" stroke="var(--accent)" stroke-width="7" />`).join('')}
  ${emblem}
</svg>`

const fonts = ['familjen-grotesk', 'newsreader', 'martian-mono']
  .map((f) => `<link rel="stylesheet" href="${pathToFileURL(join(__dirname, '..', 'node_modules', '@fontsource-variable', f, 'wght.css')).href}">`)
  .join('')

const html = `<!doctype html><html><head><meta charset="utf-8">${fonts}<style>
  :root { --bg: oklch(21% 0.045 330); --ink: oklch(96% 0.014 350); --muted: oklch(80% 0.04 345); --accent: oklch(81% 0.14 352);
    --faint: oklch(52% 0.11 345); --petal: oklch(97% 0.012 350); --centre: oklch(45% 0.13 355); }
  html { zoom: ${SCALE}; }
  * { margin: 0; box-sizing: border-box; }
  body { width: ${W}px; height: ${H}px; background: var(--bg); overflow: hidden; position: relative; color: var(--ink); }
  svg { position: absolute; inset: 0; }
  .text { position: absolute; left: 84px; top: 72px; bottom: 64px; display: flex; flex-direction: column; }
  .mark { font: 650 40px/1 'Familjen Grotesk Variable'; letter-spacing: -0.02em; display: inline-flex; align-items: baseline; }
  .mark::after { content: ''; width: 0.21em; height: 0.21em; margin-left: 0.05em; border-radius: 50%; background: var(--accent); }
  .eyebrow { margin-top: auto; font: 500 17px/1 'Martian Mono Variable'; letter-spacing: 0.06em; color: var(--accent); text-transform: uppercase; }
  h1 { margin-top: 18px; font: 650 168px/0.9 'Familjen Grotesk Variable'; letter-spacing: -0.045em; }
  p { margin-top: 26px; max-width: 560px; font: 400 34px/1.2 'Newsreader Variable'; color: var(--ink); }
  .foot { margin-top: 30px; font: 400 15px/1 'Martian Mono Variable'; color: var(--muted); }
  .foot em { font-style: italic; }
</style></head><body>${svg}
  <div class="text">
    <span class="mark">mine</span>
    <span class="eyebrow">Release ${version}</span>
    <h1>${tree.name}</h1>
    <p>${tree.line}</p>
    <span class="foot"><em>${tree.botanical}</em> &nbsp;•&nbsp; mine.computer</span>
  </div>
</body></html>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: W * SCALE, height: H * SCALE, show: false, enableLargerThanScreen: true, webPreferences: { offscreen: true } })
  win.setContentSize(W * SCALE, H * SCALE)
  const page = join(app.getPath('temp'), `mine-release-${version}.html`)
  writeFileSync(page, html)
  await win.loadFile(page)
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
  await new Promise((r) => setTimeout(r, 300))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: W * SCALE, height: H * SCALE })
  const out = join(ROOT, 'releases', `${version}.png`)
  writeFileSync(out, image.toPNG())
  console.log(`${out} (${image.getSize().width}x${image.getSize().height})`)
  app.quit()
})
