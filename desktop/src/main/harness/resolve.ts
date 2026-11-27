import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, extname, join, resolve } from 'node:path'

// Find a CLI on this machine and work out how to start it without a shell.
// Prompts are user speech, so they must never pass through cmd.exe or sh.

const isWin = process.platform === 'win32'

/** Directories apps launched from a dock or Start menu often miss. */
function extraDirs(): string[] {
  const home = homedir()
  const dirs = [join(home, '.local', 'bin'), join(home, '.bun', 'bin'), join(home, '.npm-global', 'bin')]
  if (isWin) {
    const appData = process.env.APPDATA
    if (appData) dirs.push(join(appData, 'npm'))
    dirs.push('C:\\Program Files\\nodejs')
  } else {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin', join(home, '.volta', 'bin'))
  }
  return dirs
}

function searchDirs(): string[] {
  const fromPath = (process.env.PATH ?? process.env.Path ?? '').split(delimiter).filter(Boolean)
  return [...new Set([...fromPath, ...extraDirs()])]
}

function isFile(p: string) {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

export function which(name: string): string | undefined {
  const exts = isWin ? ['.exe', '.cmd', '.bat', '.com'] : ['']
  for (const dir of searchDirs()) {
    for (const ext of exts) {
      const p = join(dir, name + ext)
      if (isFile(p)) return p
    }
  }
  return undefined
}

export type Launch = { file: string; prefix: string[]; env?: NodeJS.ProcessEnv }

/**
 * Turn a resolved path into something spawn() can run directly. On Windows,
 * npm installs CLIs as .cmd shims; we read the shim, find the script it points
 * at, and run that with node instead of going through cmd.exe.
 */
export function launchFor(path: string): Launch | undefined {
  const ext = extname(path).toLowerCase()
  if (!isWin || ext === '.exe' || ext === '.com') return { file: path, prefix: [] }

  if (ext === '.cmd' || ext === '.bat') {
    const text = readFileSync(path, 'utf8')
    const m = text.match(/%~?dp0%?\\([^"\r\n]+?\.[cm]?js)"/i)
    if (!m) return undefined
    const script = resolve(dirname(path), m[1])
    if (!existsSync(script)) return undefined
    const node = which('node')
    if (node) return { file: node, prefix: [script] }
    // No system node: Electron can act as one.
    return { file: process.execPath, prefix: [script], env: { ELECTRON_RUN_AS_NODE: '1' } }
  }
  return undefined
}
