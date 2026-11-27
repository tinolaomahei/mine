import { execFile } from 'node:child_process'
import type { HarnessInfo } from '@shared/ipc'
import { ADAPTERS } from './registry'
import { launchFor, which } from './resolve'

function version(path: string): Promise<string | undefined> {
  const launch = launchFor(path)
  if (!launch) return Promise.resolve(undefined)
  return new Promise((done) => {
    execFile(
      launch.file,
      [...launch.prefix, '--version'],
      { timeout: 8000, windowsHide: true, env: { ...process.env, ...launch.env } },
      (err, stdout) => {
        if (err) return done(undefined)
        const line = stdout.trim().split(/\r?\n/)[0] ?? ''
        const m = line.match(/\d+\.\d+(\.\d+)?/)
        done(m ? m[0] : line.slice(0, 40) || undefined)
      },
    )
  })
}

let cache: Promise<HarnessInfo[]> | undefined

export function detectHarnesses(fresh = false): Promise<HarnessInfo[]> {
  if (!cache || fresh) {
    cache = Promise.all(
      ADAPTERS.map(async (a): Promise<HarnessInfo> => {
        const path = a.commands.map(which).find(Boolean)
        const base = { id: a.id, name: a.name, vendor: a.vendor, blurb: a.blurb, streams: a.format !== 'text' }
        if (!path || !launchFor(path)) return { ...base, found: false }
        return { ...base, found: true, path, version: await version(path) }
      }),
    )
  }
  return cache
}
