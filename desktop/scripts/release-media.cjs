// Turns an animation in releases/media (an HTML page with window.frameAt(seconds))
// into a looping GIF and an MP4 next to it, frame by frame, so it's the same every time.
// Run with Electron: npx electron scripts/release-media.cjs widgets
const { app, BrowserWindow } = require('electron')
const { execFileSync } = require('node:child_process')
const { mkdirSync, rmSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const W = 1200
const H = 675
const FPS = 20
const name = process.argv.slice(2).find((a) => /^[a-z0-9-]+$/.test(a))
if (!name) throw new Error('Pass an animation name, like widgets')

const media = join(__dirname, '..', '..', 'releases', 'media')
const frames = join(app.getPath('temp'), `mine-media-${name}`)

function encode() {
  const input = join(frames, 'f%04d.png')
  const palette = join(frames, 'palette.png')
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(FPS), '-i', input, '-vf', 'palettegen=max_colors=160:stats_mode=diff', palette])
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(FPS), '-i', input, '-i', palette, '-lavfi', 'paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', '-loop', '0', join(media, `${name}.gif`)])
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(FPS), '-i', input, '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', join(media, `${name}.mp4`)])
}

async function render() {
  rmSync(frames, { recursive: true, force: true })
  mkdirSync(frames, { recursive: true })
  const win = new BrowserWindow({ width: W, height: H, show: false, enableLargerThanScreen: true, webPreferences: { offscreen: true } })
  win.setContentSize(W, H)
  await win.loadFile(join(media, `${name}.html`), { search: 'still' })
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
  const length = await win.webContents.executeJavaScript('window.LENGTH')
  const count = Math.round(length * FPS)
  for (let i = 0; i < count; i++) {
    await win.webContents.executeJavaScript(`window.frameAt(${i / FPS}); new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`)
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: W, height: H })
    writeFileSync(join(frames, `f${String(i).padStart(4, '0')}.png`), image.toPNG())
  }
  encode()
  rmSync(frames, { recursive: true, force: true })
  console.log(`${count} frames -> releases/media/${name}.gif and ${name}.mp4`)
}

app.whenReady().then(() =>
  render().then(
    () => app.quit(),
    (err) => {
      console.error(err.message)
      app.exit(1)
    },
  ),
)
