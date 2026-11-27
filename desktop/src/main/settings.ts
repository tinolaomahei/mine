import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { Settings } from '@shared/ipc'

const file = () => join(app.getPath('userData'), 'settings.json')

const defaults = (): Settings => ({ harness: null, theme: 'system', workdir: homedir() })

let current: Settings | undefined

export function getSettings(): Settings {
  if (!current) {
    try {
      current = { ...defaults(), ...JSON.parse(readFileSync(file(), 'utf8')) }
    } catch {
      current = defaults()
    }
  }
  return current!
}

/** Re-read from disk; an agent may have changed the file. */
export function reloadSettings(): Settings {
  current = undefined
  return getSettings()
}

export function setSettings(patch: Partial<Settings>): Settings {
  current = { ...getSettings(), ...patch }
  mkdirSync(dirname(file()), { recursive: true })
  writeFileSync(file(), JSON.stringify(current, null, 2))
  return current
}
