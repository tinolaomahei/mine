// Commands mine writes into the commands folder once, as ordinary files. They
// are examples as much as features: the person (or an agent) can change or
// delete them like any other command.

const showFolder = `// Show what's in a folder as a file list inside the conversation.
// Clicking a folder in the list runs this again with { path }.
const fs = require('node:fs')
const path = require('node:path')

module.exports = {
  title: 'Show folder',
  description: 'Show the files and folders in the current working folder as a file list in the conversation.',
  examples: ["what's in this folder", 'show me the files here', 'list this directory', 'what files are here'],
  async run({ params, workdir }) {
    const dir = path.resolve(workdir, params.path || '.')
    const all = fs.readdirSync(dir, { withFileTypes: true })
    const entries = []
    for (const d of all.slice(0, 2000)) {
      const full = path.join(dir, d.name)
      let st
      try { st = fs.statSync(full) } catch { continue }
      const isDir = st.isDirectory()
      entries.push({ name: d.name, path: full, kind: isDir ? 'dir' : 'file', size: isDir ? undefined : st.size, modified: st.mtimeMs })
    }
    entries.sort((a, b) =>
      a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
    )
    const MAX = 400
    const parent = path.dirname(dir)
    const folders = entries.filter((e) => e.kind === 'dir').length
    const files = entries.length - folders
    return {
      say: folders + (folders === 1 ? ' folder' : ' folders') + ' and ' + files + (files === 1 ? ' file' : ' files') + ' in ' + (path.basename(dir) || dir),
      view: {
        type: 'files',
        path: dir,
        parent: parent !== dir ? parent : undefined,
        entries: entries.slice(0, MAX),
        more: Math.max(0, all.length - MAX),
        open: { command: 'show-folder', param: 'path' },
      },
    }
  },
}
`

const goUp = `// Move the working folder up one level. Undo puts it back.
const path = require('node:path')

module.exports = {
  title: 'Go up a folder',
  description: 'Move the working folder up one level, to its parent folder.',
  examples: ['go up a folder', 'go back a directory', 'cd ..', 'up one level'],
  async run({ workdir }, mine) {
    const parent = path.dirname(workdir)
    if (parent === workdir) throw new Error("You're already at the top of the drive.")
    await mine.workdir.set(parent)
    return { say: 'Now working in ' + parent, undoState: workdir }
  },
  async undo(previous, ctx, mine) {
    await mine.workdir.set(previous)
    return { say: 'Back in ' + previous }
  },
}
`

const goInto = `// Move the working folder into one of the folders inside it. The choices are
// worked out when it's asked for, so they're always the folders that exist.
const fs = require('node:fs')
const path = require('node:path')

module.exports = {
  title: 'Go into a folder',
  description: 'Move the working folder into one of the folders inside the current one.',
  examples: ['go into src', 'open the docs folder', 'cd into landing', 'switch to the desktop folder in here'],
  params: {
    folder: {
      description: 'Which folder inside the current one to go into',
      async options({ workdir }) {
        const out = {}
        for (const d of fs.readdirSync(workdir, { withFileTypes: true })) {
          if (d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules') out[d.name] = 'The ' + d.name + ' folder'
          if (Object.keys(out).length >= 60) break
        }
        return out
      },
    },
  },
  async run({ params, workdir }, mine) {
    const to = path.join(workdir, params.folder)
    await mine.workdir.set(to)
    return { say: 'Now working in ' + to, undoState: workdir }
  },
  async undo(previous, ctx, mine) {
    await mine.workdir.set(previous)
    return { say: 'Back in ' + previous }
  },
}
`

const showFile = `// Show what's in a file. The choices are the files in the working folder,
// worked out when it's asked for.
const fs = require('node:fs')
const path = require('node:path')

module.exports = {
  title: 'Show a file',
  description: 'Show what is in one of the files in the current working folder.',
  examples: ['show me package.json', "what's in the readme", 'open index.html', 'let me see the config file'],
  params: {
    file: {
      description: 'Which file to show',
      async options({ workdir }) {
        const out = {}
        for (const d of fs.readdirSync(workdir, { withFileTypes: true })) {
          if (d.isFile()) out[d.name] = 'The file ' + d.name
          if (Object.keys(out).length >= 80) break
        }
        return out
      },
    },
  },
  async run({ params, workdir }) {
    const file = path.resolve(workdir, params.file || params.path || '')
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error("There's no file called " + params.file + ' here.')
    return { say: path.basename(file), view: { type: 'file', path: file } }
  },
}
`

const whereAmI = `// Say which folder mine is working in.
module.exports = {
  title: 'Where am I',
  description: 'Say which folder mine and its agents are working in right now.',
  examples: ['where am I', 'what folder is this', 'print working directory', 'pwd'],
  async run({ workdir }) {
    return { say: 'Working in ' + workdir }
  },
}
`

export const STARTERS: Record<string, string> = {
  'show-folder': showFolder,
  'go-up-folder': goUp,
  'go-into-folder': goInto,
  'where-am-i': whereAmI,
  'show-file': showFile,
}
