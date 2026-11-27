// Starts the packaged app as Node and checks it can load speech recognition and its bundled resources.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const dist = join(import.meta.dirname, '..', 'dist')

function packaged() {
  const dirs = readdirSync(dist).map((d) => join(dist, d))
  for (const dir of dirs) {
    const app = join(dir, 'mine.app')
    if (existsSync(app)) return { exe: join(app, 'Contents', 'MacOS', 'mine'), resources: join(app, 'Contents', 'Resources') }
    for (const name of ['mine.exe', 'mine']) {
      const exe = join(dir, name)
      if (existsSync(exe) && existsSync(join(dir, 'resources'))) return { exe, resources: join(dir, 'resources') }
    }
  }
  throw new Error(`No packaged app found in ${dist}`)
}

const check = `
const fs = require('fs')
const path = require('path')
const app = process.argv[1]
const speech = require(path.join(app, 'node_modules', 'sherpa-onnx-node'))
if (typeof speech.OfflineRecognizer !== 'function' || typeof speech.Vad !== 'function') throw new Error('speech recognition did not load')
for (const p of ['out/main/index.js', 'out/main/speech.js', 'out/main/commands.js', 'out/main/theme-mcp.js', 'out/renderer/index.html', 'resources/services', 'resources/widgets', 'resources/themes', 'resources/icon.png']) {
  if (!fs.existsSync(path.join(app, p))) throw new Error('missing from the package: ' + p)
}
console.log('packaged app is ok')
`

const { exe, resources } = packaged()
console.log(`checking ${exe}`)
execFileSync(exe, ['-e', check, join(resources, 'app.asar')], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
