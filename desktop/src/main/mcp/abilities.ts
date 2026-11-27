// MCP tools for building new abilities into mine at runtime: commands (instant
// actions), widgets (interactive cards) and data (local collections). Saving
// writes files; the running app picks them up, and asks the person to approve
// anything new before it runs.

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { dirname, join, resolve, sep } from 'node:path'
import { compileFunction } from 'node:vm'
import { COMMAND_GUIDE, COMMAND_NAME, type CommandsState } from '@shared/commands'
import { WIDGET_GUIDE, WIDGET_NAME, type WidgetInfo } from '@shared/widgets'
import { COLLECTION, dataCall } from '../data-store'

type Result = { text: string; isError?: boolean }

const DIR = process.env.MINE_DIR!

/** Ask the running app something over its local pipe. */
function app<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const path = process.env.MINE_PIPE
  const token = process.env.MINE_TOKEN
  if (!path || !token) return Promise.reject(new Error('mine isn’t reachable from here.'))
  return new Promise((ok, fail) => {
    const sock = connect(path)
    let buf = ''
    sock.setEncoding('utf8')
    sock.setTimeout(20_000, () => sock.destroy(new Error('mine didn’t answer.')))
    sock.on('connect', () => sock.write(JSON.stringify({ ...args, method, token }) + '\n'))
    sock.on('data', (c) => (buf += c))
    sock.on('end', () => {
      try {
        const r = JSON.parse(buf)
        if (r.error) fail(new Error(r.error))
        else ok(r.value as T)
      } catch {
        fail(new Error('mine sent back something unreadable.'))
      }
    })
    sock.on('error', fail)
  })
}

function writeAtomic(file: string, text: string) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, file)
}

const json = (v: unknown) => '```json\n' + JSON.stringify(v, null, 2) + '\n```'
const str = { type: 'string' }
const strs = { type: 'array', items: { type: 'string' } }
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })

export const ABILITY_TOOLS = [
  {
    name: 'list_abilities',
    description:
      'See what the person has added to mine: their commands (instant actions), widgets (interactive cards), data collections, and anything waiting for their approval or failing to load. Check here before making something new.',
    inputSchema: obj({}),
  },
  {
    name: 'save_command',
    description: `Create or replace a mine command: an instant action the fast decisions model can pick from what the person says, with no agent involved. Use it when the person wants mine to be able to do something new and quick (minimize the window, open a folder, log a thing).\n\n${COMMAND_GUIDE}\n\nThe person must approve it in mine before it runs. Tell them it's waiting for their OK. Once approved, test it with run_command.`,
    inputSchema: obj(
      { name: { type: 'string', description: 'lowercase-with-dashes; the file name' }, source: { type: 'string', description: 'The whole .js file.' } },
      ['name', 'source'],
    ),
  },
  { name: 'remove_command', description: 'Delete one of the person’s commands.', inputSchema: obj({ name: str }, ['name']) },
  {
    name: 'run_command',
    description: 'Run a mine command now, e.g. to test one you made or to do something the person asked for. params maps each param to one of its option values.',
    inputSchema: obj({ name: str, params: { type: 'object', additionalProperties: { type: 'string' } } }, ['name']),
  },
  {
    name: 'save_widget',
    description: `Create or replace a mine widget.\n\n${WIDGET_GUIDE}\n\nAfter saving, show it with show_widget; mine asks the person to approve it first.`,
    inputSchema: obj(
      {
        name: { type: 'string', description: 'lowercase-with-dashes; the folder name' },
        title: str,
        description: { type: 'string', description: 'What it is and does. The decisions model reads this.' },
        examples: { ...strs, description: '2-5 ways the person might ask to see it.' },
        data: { ...strs, description: 'Collections it reads or changes.' },
        html: { type: 'string', description: 'index.html: the whole widget, inline CSS and JS.' },
        files: { type: 'object', additionalProperties: { type: 'string' }, description: 'Optional extra text files by relative path.' },
      },
      ['name', 'title', 'description', 'html'],
    ),
  },
  { name: 'remove_widget', description: 'Delete one of the person’s widgets.', inputSchema: obj({ name: str }, ['name']) },
  {
    name: 'show_widget',
    description: 'Show a widget in the conversation, under your reply. props reach it as mine.props.',
    inputSchema: obj({ name: str, props: { type: 'object' } }, ['name']),
  },
  {
    name: 'data_list',
    description:
      'mine’s local data store: list the documents in a collection, optionally only those whose fields equal `where`. Without a collection, lists the collections. Commands, widgets and you share this data.',
    inputSchema: obj({ collection: str, where: { type: 'object' } }),
  },
  { name: 'data_get', description: 'Read one document from a collection.', inputSchema: obj({ collection: str, id: str }, ['collection', 'id']) },
  {
    name: 'data_put',
    description:
      'Add or replace a document (a JSON object) in a collection, creating the collection if needed. Without an id, one is made. Widgets watching the collection update straight away.',
    inputSchema: obj({ collection: str, doc: { type: 'object' } }, ['collection', 'doc']),
  },
  {
    name: 'data_patch',
    description: 'Change some fields of a document.',
    inputSchema: obj({ collection: str, id: str, fields: { type: 'object' } }, ['collection', 'id', 'fields']),
  },
  { name: 'data_remove', description: 'Delete a document.', inputSchema: obj({ collection: str, id: str }, ['collection', 'id']) },
]

export const ABILITY_NAMES = new Set(ABILITY_TOOLS.map((t) => t.name))

export async function abilityCall(name: string, input: Record<string, any>): Promise<Result> {
  switch (name) {
    case 'list_abilities': {
      const [cmds, wids] = await Promise.all([app<CommandsState>('list'), app<WidgetInfo[]>('widgets')])
      return {
        text: [
          `Commands (in ${cmds.dir}):`,
          json(cmds.commands.map(({ name, title, description, examples, params, canUndo }) => ({ name, title, description, examples, params, canUndo }))),
          cmds.pending.length ? `Waiting for the person's approval: ${cmds.pending.map((p) => p.name).join(', ')}` : '',
          cmds.errors.length ? `Failed to load:\n${cmds.errors.map((e) => `- ${e.file}: ${e.message}`).join('\n')}` : '',
          'Widgets:',
          json(wids.map(({ name, title, description, data, approved, error }) => ({ name, title, description, data, approved, error }))),
          'Data collections:',
          json(dataCall(DIR, 'collections', [])),
        ]
          .filter(Boolean)
          .join('\n'),
      }
    }
    case 'save_command': {
      const n = String(input.name ?? '')
      if (!COMMAND_NAME.test(n)) return { text: 'name must be lowercase-with-dashes, like minimize-window.', isError: true }
      const source = String(input.source ?? '')
      try {
        // compile only, to catch syntax errors; nothing runs until the person approves it
        compileFunction(source, ['exports', 'require', 'module', '__filename', '__dirname'], { filename: `${n}.js` })
      } catch (err) {
        return { text: `That doesn't compile: ${(err as Error).message}`, isError: true }
      }
      writeAtomic(join(DIR, 'commands', `${n}.js`), source)
      const s = await app<CommandsState>('reload').catch(() => null)
      const waiting = s?.pending.some((p) => p.name === n)
      return {
        text: waiting
          ? `Saved ${n}. mine is showing the person an approval card; it can't run until they approve it. Ask them to, then test it with run_command.`
          : s?.errors.find((e) => e.file.endsWith(`${n}.js`))?.message
            ? `Saved, but it failed to load: ${s.errors.find((e) => e.file.endsWith(`${n}.js`))!.message}`
            : `Saved ${n}. It's live.`,
      }
    }
    case 'remove_command': {
      const n = String(input.name ?? '')
      if (!COMMAND_NAME.test(n)) return { text: 'Not a command name.', isError: true }
      rmSync(join(DIR, 'commands', `${n}.js`), { force: true })
      await app('reload').catch(() => null)
      return { text: `Removed ${n}.` }
    }
    case 'run_command': {
      const r = await app<{ ok: boolean; say?: string; view?: unknown; error?: string }>('run', {
        name: String(input.name ?? ''),
        params: input.params ?? {},
      })
      if (!r.ok) return { text: r.error ?? 'It failed.', isError: true }
      return { text: [r.say ?? 'Done.', r.view ? `It showed:\n${json(r.view).slice(0, 4000)}` : ''].filter(Boolean).join('\n') }
    }
    case 'save_widget': {
      const n = String(input.name ?? '')
      if (!WIDGET_NAME.test(n)) return { text: 'name must be lowercase-with-dashes, like todo-list.', isError: true }
      const data = Array.isArray(input.data) ? input.data.map(String) : []
      const bad = data.find((c: string) => !COLLECTION.test(c))
      if (bad) return { text: `"${bad}" isn't a collection name. Use lowercase letters, digits, - and _.`, isError: true }
      const dir = join(DIR, 'widgets', n)
      const meta = { title: input.title, description: input.description, examples: input.examples ?? [], data }
      writeAtomic(join(dir, 'widget.json'), JSON.stringify(meta, null, 2))
      writeAtomic(join(dir, 'index.html'), String(input.html ?? ''))
      for (const [rel, text] of Object.entries((input.files ?? {}) as Record<string, string>)) {
        const file = resolve(dir, rel)
        if (!file.startsWith(dir + sep) || rel === 'widget.json') return { text: `Can't write ${rel} there.`, isError: true }
        writeAtomic(file, String(text))
      }
      await app('reloadWidgets').catch(() => null)
      return { text: `Saved widget ${n}. Show it with show_widget; mine will ask the person to approve it first (and again after any change).` }
    }
    case 'remove_widget': {
      const n = String(input.name ?? '')
      if (!WIDGET_NAME.test(n)) return { text: 'Not a widget name.', isError: true }
      rmSync(join(DIR, 'widgets', n), { recursive: true, force: true })
      await app('reloadWidgets').catch(() => null)
      return { text: `Removed widget ${n}.` }
    }
    case 'show_widget':
      await app('show', { name: String(input.name ?? ''), props: input.props ?? {} })
      return { text: 'Showing it under your reply (after the person approves it, if they haven’t yet).' }
    case 'data_list':
      return input.collection
        ? { text: json(dataCall(DIR, 'list', [input.collection, input.where])) }
        : { text: json(dataCall(DIR, 'collections', [])) }
    case 'data_get':
      return { text: json(dataCall(DIR, 'get', [input.collection, input.id])) }
    case 'data_put':
      return { text: json(dataCall(DIR, 'put', [input.collection, input.doc])) }
    case 'data_patch':
      return { text: json(dataCall(DIR, 'patch', [input.collection, input.id, input.fields])) }
    case 'data_remove':
      return { text: dataCall(DIR, 'remove', [input.collection, input.id]) ? 'Removed.' : 'There was no such document.' }
  }
  return { text: `Unknown tool ${name}`, isError: true }
}
