import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute } from 'node:path'
import type { CommandCall } from '@shared/connections'
import { launchFor, which, type Launch } from '../harness/resolve'

const TIMEOUT_MS = 30_000
const MAX_OUT = 8 * 1024 * 1024
const MAX_ERR = 16 * 1024

type Ran = { code: number | null; stdout: string; stderr: string }

const isFile = (p: string) => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function locate(command: string): string {
  const path = isAbsolute(command) ? (isFile(command) ? command : undefined) : which(command)
  if (!path) throw new Error(`mine couldn’t find “${command}” on this computer. Check it’s installed and on your PATH.`)
  return path
}

function launch(command: string): Launch {
  const path = locate(command)
  const l = launchFor(path)
  if (!l) throw new Error(`${basename(path)} is a script mine can’t run without a shell, and mine never runs commands through one. Point it at the program itself.`)
  return l
}

function workingDir(cwd?: string) {
  if (!cwd) return homedir()
  if (!isAbsolute(cwd) || !isDir(cwd)) throw new Error(`“${cwd}” isn’t a folder on this computer.`)
  return cwd
}

function run(l: Launch, args: string[], cwd: string, name: string): Promise<Ran> {
  return new Promise((done, fail) => {
    const child = spawn(l.file, [...l.prefix, ...args], { cwd, env: { ...process.env, ...l.env }, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    let outBytes = 0
    let errBytes = 0
    let stopped: string | undefined
    const stop = (why: string) => {
      stopped ??= why
      child.kill()
    }
    const timer = setTimeout(() => stop(`${name} took longer than ${TIMEOUT_MS / 1000} seconds, so mine stopped it.`), TIMEOUT_MS)
    child.stdout.on('data', (b: Buffer) => {
      outBytes += b.length
      if (outBytes > MAX_OUT) return stop(`${name} printed more than ${MAX_OUT / 1024 / 1024} MB, so mine stopped it. Ask it for less.`)
      out.push(b)
    })
    child.stderr.on('data', (b: Buffer) => {
      if (errBytes < MAX_ERR) err.push(b)
      errBytes += b.length
    })
    child.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      fail(new Error(e.code === 'ENOENT' ? `mine couldn’t start ${name}: it isn’t there any more.` : `mine couldn’t start ${name}: ${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (stopped) return fail(new Error(stopped))
      done({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') })
    })
  })
}

function failure(name: string, r: Ran) {
  const lines = (r.stderr.trim() || r.stdout.trim()).split(/\r?\n/).filter((l) => l.trim())
  const said = lines.slice(0, 3).join(' ').replace(/\s+/g, ' ').slice(0, 400)
  return new Error(`${name} stopped with exit code ${r.code ?? 'unknown'}${said ? `: ${said}` : '.'}`)
}

function splitJson(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0 && start >= 0) parts.push(text.slice(start, i + 1))
    }
  }
  return parts
}

function notJson(name: string, text: string) {
  return new Error(`${name}’s output isn’t JSON: “${text.trim().replace(/\s+/g, ' ').slice(0, 120)}”. Use format "lines" for plain text, or "jsonl" for one JSON value per line.`)
}

function parseJson(text: string, name: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    const parts = splitJson(text)
    if (!parts.length) throw notJson(name, text)
    try {
      return parts.map((p) => JSON.parse(p) as unknown)
    } catch {
      throw notJson(name, text)
    }
  }
}

function parseJsonl(text: string, name: string): unknown[] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as unknown
      } catch {
        throw notJson(name, l)
      }
    })
}

export function parseOutput(text: string, format: CommandCall['format'], name: string): unknown {
  if (format === 'lines') return text.split(/\r?\n/).filter((l) => l.trim())
  if (format === 'jsonl') return parseJsonl(text, name)
  if (!text.trim()) return []
  return parseJson(text, name)
}

export async function runCommand(call: CommandCall): Promise<unknown> {
  const name = basename(call.command).replace(/\.(exe|com)$/i, '')
  const r = await run(launch(call.command), call.args, workingDir(call.cwd), name)
  if (r.code !== 0) throw failure(name, r)
  return parseOutput(r.stdout, call.format, name)
}
