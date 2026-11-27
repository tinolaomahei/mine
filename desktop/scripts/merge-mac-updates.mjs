// The Apple silicon and Intel builds each write a latest-mac.yml. Installed Macs
// read one file and pick their own zip from its list, so this joins the two.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
const parts = ['latest-mac-arm64.yml', 'latest-mac-x64.yml'].map((f) => join(dir, f))

function split(text) {
  const lines = text.replace(/\r\n/g, '\n').trimEnd().split('\n')
  const start = lines.indexOf('files:')
  if (start < 0) throw new Error('no files: list in latest-mac.yml')
  let end = start + 1
  while (end < lines.length && lines[end].startsWith('  ')) end++
  return { head: lines.slice(0, start + 1), files: lines.slice(start + 1, end), tail: lines.slice(end) }
}

const [arm, intel] = parts.map((p) => split(readFileSync(p, 'utf8')))
const merged = [...intel.head, ...intel.files, ...arm.files, ...intel.tail].join('\n') + '\n'
for (const arch of ['arm64', 'x64']) {
  if (!merged.includes(`-mac-${arch}.zip`)) throw new Error(`the merged file has no ${arch} zip`)
}
writeFileSync(join(dir, 'latest-mac.yml'), merged)
parts.forEach((p) => rmSync(p))
console.log(merged)
