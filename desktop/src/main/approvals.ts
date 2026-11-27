import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { getSecret, setSecret } from './secrets'

// What the person has OKed. Anything an agent writes (a command, a widget)
// stays inert until approved, and any change to it needs approving again.
// Each approval is the content's hash, signed with a key kept in the system
// keychain, so an agent that can write files still can't approve its own work.

export type Kind = 'command' | 'widget' | 'source'

const file = () => join(app.getPath('userData'), 'approvals.json')
const KEY = 'approvals.key'

export const hashOf = (content: string | Buffer) => createHash('sha256').update(content).digest('hex')

function key() {
  let k = getSecret(KEY)
  if (!k) {
    k = randomBytes(32).toString('hex')
    setSecret(KEY, k)
  }
  return k
}

const sign = (kind: Kind, name: string, hash: string) => createHmac('sha256', key()).update(`${kind}:${name}:${hash}`).digest('hex')

function read(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(file(), 'utf8'))
  } catch {
    return {}
  }
}

export function isApproved(kind: Kind, name: string, hash: string) {
  const sig = read()[`${kind}:${name}`]
  if (!sig) return false
  const want = Buffer.from(sign(kind, name, hash), 'hex')
  const got = Buffer.from(sig, 'hex')
  return got.length === want.length && timingSafeEqual(got, want)
}

export function approve(kind: Kind, name: string, hash: string) {
  const all = read()
  all[`${kind}:${name}`] = sign(kind, name, hash)
  const tmp = `${file()}.tmp`
  writeFileSync(tmp, JSON.stringify(all, null, 2))
  renameSync(tmp, file())
}

export function forget(kind: Kind, name: string) {
  const all = read()
  delete all[`${kind}:${name}`]
  writeFileSync(file(), JSON.stringify(all, null, 2))
}
