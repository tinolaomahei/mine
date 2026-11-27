// Prints a release's title, notes file and graphic for GITHUB_OUTPUT, from
// releases/trees.json and releases/<version>.md / <version>.png when they exist.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('Pass a version, like 0.1.0')
const dir = join(import.meta.dirname, '..', '..', 'releases')
const trees = JSON.parse(readFileSync(join(dir, 'trees.json'), 'utf8'))
const tree = trees[version.split('.')[0]]?.name
const slug = tree?.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const notes = join(dir, `${version}.md`)
const art = join(dir, `${version}.png`)

console.log(`title=mine ${version}${tree ? ` · ${tree}` : ''}`)
console.log(`notes=${existsSync(notes) ? notes : ''}`)
console.log(`art=${existsSync(art) && slug ? art : ''}`)
console.log(`art_name=${slug ? `mine-${version}-${slug}.png` : ''}`)
