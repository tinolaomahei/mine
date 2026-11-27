import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'

// API keys, encrypted with the OS keychain (DPAPI on Windows, Keychain on
// macOS, libsecret on Linux). They stay in the main process and are never
// sent to the window.

const file = () => join(app.getPath('userData'), 'secrets.json')
const memory = new Map<string, string>()

export const canEncrypt = () => safeStorage.isEncryptionAvailable()

function readAll(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(file(), 'utf8'))
  } catch {
    return {}
  }
}

export function getSecret(name: string): string | undefined {
  if (memory.has(name)) return memory.get(name)
  const enc = readAll()[name]
  if (!enc || !canEncrypt()) return undefined
  try {
    const value = safeStorage.decryptString(Buffer.from(enc, 'base64'))
    memory.set(name, value)
    return value
  } catch {
    return undefined
  }
}

export function hasSecret(name: string) {
  return memory.has(name) || !!readAll()[name]
}

export function setSecret(name: string, value: string) {
  memory.set(name, value)
  // Without OS encryption the key lives for this session only; never write it in the clear.
  if (!canEncrypt()) return
  const all = readAll()
  all[name] = safeStorage.encryptString(value).toString('base64')
  writeFileSync(file(), JSON.stringify(all, null, 2))
}

/** Forget every secret whose name starts with a prefix (e.g. a connection's). */
export function deleteSecrets(prefix: string) {
  for (const k of [...memory.keys()]) if (k.startsWith(prefix)) memory.delete(k)
  const all = readAll()
  const keep = Object.fromEntries(Object.entries(all).filter(([k]) => !k.startsWith(prefix)))
  if (Object.keys(keep).length !== Object.keys(all).length) writeFileSync(file(), JSON.stringify(keep, null, 2))
}
