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
import { saveTheme } from '../theme-store'
import type { ThemePatch } from '@shared/theme'
import type { ThemeInfo } from '@shared/themes'

type Result = { text: string; isError?: boolean }

const DIR = process.env.MINE_DIR!

/** Ask the running app something over its local pipe. */
function app<T>(method: string, args: Record<string, unknown> = {}, wait = 20_000): Promise<T> {
  const path = process.env.MINE_PIPE
  const token = process.env.MINE_TOKEN
  if (!path || !token) return Promise.reject(new Error('mine isn’t reachable from here.'))
  return new Promise((ok, fail) => {
    const sock = connect(path)
    let buf = ''
    sock.setEncoding('utf8')
    sock.setTimeout(wait, () => sock.destroy(new Error('mine didn’t answer.')))
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
        mock: {
          type: 'object',
          description: 'mock.json: sample data for the marketplace preview, { props: {...}, data: { <collection>: [docs] } }. Realistic, never the person\u2019s real data.',
        },
        size: { type: 'object', description: 'Starting size on a screen in grid cells, { w, h } (12 columns; rows 72px).' },
        minSize: { type: 'object', description: 'Smallest size it works at, { w, h }.' },
        files: { type: 'object', additionalProperties: { type: 'string' }, description: 'Optional extra text files by relative path.' },
      },
      ['name', 'title', 'description', 'html', 'mock'],
    ),
  },
  {
    name: 'permission_prompt',
    description:
      'Claude Code calls this to ask the person before a tool runs. It waits for their click in mine. Don’t call it yourself; it approves nothing.',
    // loose on purpose: Claude Code may send more fields than these
    inputSchema: { type: 'object', properties: { tool_name: str, input: { type: 'object' }, tool_use_id: str }, required: ['tool_name', 'input'] },
  },
  {
    name: 'save_theme',
    description:
      'Put a theme in mine’s theme marketplace, on the person’s shelf, so they can apply it any time. Same shape as set_theme (light, dark, fonts, radius), validated the same way. Use it when the person likes a look you made, or asks for a theme to keep. It doesn’t apply it: set_theme does that.',
    inputSchema: obj(
      {
        name: { type: 'string', description: 'The theme’s name, e.g. "Harbour".' },
        description: { type: 'string', description: 'One or two plain sentences on its mood.' },
        theme: { type: 'object', description: 'A theme patch: { light, dark, fonts, radius }, like set_theme takes.' },
      },
      ['name', 'theme'],
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
  {
    name: 'list_connections',
    description:
      'The tools the person uses every day, joined to mine: mine’s catalogue of services (with the ways each can connect, and whether signing in is open yet), the person’s connections and how far through each checklist they are, the sources syncing data into collections, and the standard collections mine’s own widgets show (work, agenda, messages). Check here first.',
    inputSchema: obj({}),
  },
  {
    name: 'suggest_connection',
    description: `Put a tool the person uses on their connection checklist, which mine shows them as steps to follow (sign in, or make and paste a token). Use it whenever they mention a tool they use ("I use Jira daily"). For one of mine's services, give service (its id from list_connections) and why; mine knows the steps. Prefer signing in (OAuth) when that way is ready; pass way to choose another. For anything else, design it yourself: name, why, way and steps.

way is one of:
- { kind: "mcp", url, auth: "oauth" }: the service's remote MCP server, signed in through the browser. Best when one exists.
- { kind: "mcp", url, auth: "fields", fields: [...], headers: { "Authorization": "Bearer {{token}}" } }
- { kind: "api", base, hosts, auth: "fields", fields: [...], headers, test?: { path, account? } }: a web API read with GETs. hosts are the only hosts the person's details are ever sent to. In base and headers, {{key}} is a field's value and {{base64:a:b}} is "a:b" in base64.
- { kind: "api", base, hosts, auth: "oauth", oauth: { authorize, token, scopes, client } }: needs mine registered with the service.
fields: [{ key, label, placeholder?, secret?: true for tokens, url?: true for addresses, help? }]. steps: what the person does before that, as [{ kind: "link", label, url, detail? } | { kind: "confirm", label } | { kind: "note", label }]. Be exact: name the page, the button and what to copy. mine adds the sign-in, the fields and a check itself.

You never see what the person types into a secret field, and you can't fill one in. Tell them in a sentence what to do, and that the checklist is on their screen.`,
    inputSchema: obj({
      service: { type: 'string', description: 'One of mine’s services, by id.' },
      why: { type: 'string', description: 'Why, in their terms: "So your Jira issues show on your Work screen."' },
      way: { description: 'For mine’s services: which way, by index. For your own: the way object.' },
      fields: { type: 'object', description: 'Non-secret values you already know, e.g. { "site": "acme.atlassian.net" }.' },
      name: { type: 'string', description: 'Your own connection’s name.' },
      steps: { type: 'array', items: { type: 'object' } },
      opens: { ...strs, description: 'Hosts its widgets may open links to, e.g. ["app.example.com"].' },
    }),
  },
  {
    name: 'connection_tools',
    description:
      'What you can read from a connected service: an MCP connection’s tools (with whether each only reads), or a web API connection’s base address and mine’s ready-made sources for it.',
    inputSchema: obj({ connection: str }, ['connection']),
  },
  {
    name: 'connection_call',
    description:
      'Read from a connected service on the person’s behalf, to see what its data looks like before you make a source or a widget. For MCP: { connection, tool, args }. A tool that might change something asks the person first. For a web API: { connection, path, query?, format? } (GET only; query values can use {{$now}}, {{$today}}, {{$in:7d}}, {{$ago:1d}}). Ask for small pages.',
    inputSchema: obj({
      connection: str,
      tool: str,
      args: { type: 'object' },
      path: str,
      query: { type: 'object', additionalProperties: { type: 'string' } },
      format: { type: 'string', enum: ['json', 'ics'] },
    }, ['connection']),
  },
  {
    name: 'save_source',
    description: `Keep data from a connection flowing into a collection, every so often, so widgets show it. Prefer a standard collection (work, agenda, messages) so mine's own widgets show it with nothing more to build; otherwise use a new collection and build a widget for it (save_widget with data: [collection]).

call: { tool, args } for MCP (a tool that only reads), or { path, query?, format? } for a web API.
pick turns the answer into documents: { items: "path.to.list", id: "path.to.id", fields: { title: "fields.summary", url: "{{@site}}/browse/{{key}}", service: "=Jira" } }, where a field is a dotted path into each item, a template ({{path}} reads the item, {{@key}} a connection field), or a fixed value after "=". Try the call with connection_call first and check the shape.

The person must approve it in mine before it runs (and again after any change). Tell them it's waiting for their OK.`,
    inputSchema: obj(
      {
        connection: str,
        title: { type: 'string', description: 'e.g. "My open Linear issues"' },
        what: { type: 'string', description: 'What it fetches, in plain words, for the approval card.' },
        call: { type: 'object' },
        every: { type: 'number', description: 'Minutes between syncs, 5 to 1440. 15 is a good default.' },
        into: { type: 'string', description: 'The collection to fill.' },
        pick: { type: 'object' },
        id: { type: 'string', description: 'To replace one you made before.' },
      },
      ['connection', 'title', 'call', 'into'],
    ),
  },
  { name: 'sync_source', description: 'Run an approved source now and see how it went.', inputSchema: obj({ id: str }, ['id']) },
  { name: 'remove_source', description: 'Stop a source and take what it synced out of its collection.', inputSchema: obj({ id: str }, ['id']) },
]

export const ABILITY_NAMES = new Set(ABILITY_TOOLS.map((t) => t.name))

export async function abilityCall(name: string, input: Record<string, any>): Promise<Result> {
  switch (name) {
    case 'list_abilities': {
      const [cmds, wids, themes] = await Promise.all([
        app<CommandsState>('list'),
        app<WidgetInfo[]>('widgets'),
        app<ThemeInfo[]>('themes').catch(() => [] as ThemeInfo[]),
      ])
      return {
        text: [
          `Commands (in ${cmds.dir}):`,
          json(cmds.commands.map(({ name, title, description, examples, params, canUndo }) => ({ name, title, description, examples, params, canUndo }))),
          'mine\u2019s own commands (run them with run_command too):',
          json(cmds.app.map(({ name, description, params }) => ({ name, description, params }))),
          cmds.pending.length ? `Waiting for the person's approval: ${cmds.pending.map((p) => p.name).join(', ')}` : '',
          cmds.errors.length ? `Failed to load:\n${cmds.errors.map((e) => `- ${e.file}: ${e.message}`).join('\n')}` : '',
          'Widgets:',
          json(
            wids.map(({ id, source, title, description, data, size, approved, error }) => ({
              id,
              source: source === 'native' ? 'mine\u2019s own' : 'the person\u2019s',
              title,
              description,
              data,
              size,
              approved,
              error,
            })),
          ),
          'Themes in the marketplace (apply one with run_command apply-theme; add one with save_theme):',
          json(themes.map(({ id, name, description, source }) => ({ id, name, description, source: source === 'native' ? 'mine’s own' : 'the person’s' }))),
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
      const meta = { title: input.title, description: input.description, examples: input.examples ?? [], data, size: input.size, minSize: input.minSize }
      writeAtomic(join(dir, 'widget.json'), JSON.stringify(meta, null, 2))
      writeAtomic(join(dir, 'index.html'), String(input.html ?? ''))
      if (input.mock && typeof input.mock === 'object') writeAtomic(join(dir, 'mock.json'), JSON.stringify(input.mock, null, 2))
      for (const [rel, text] of Object.entries((input.files ?? {}) as Record<string, string>)) {
        const file = resolve(dir, rel)
        if (!file.startsWith(dir + sep) || rel === 'widget.json' || rel === 'mock.json') return { text: `Can't write ${rel} there.`, isError: true }
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
    case 'permission_prompt': {
      // the person answers in mine's window; a long wait is fine (they might be away)
      try {
        const r = await app<{ allow: boolean; message?: string }>(
          'permission',
          { tool: String(input.tool_name ?? ''), input: input.input ?? {}, run: process.env.MINE_RUN_ID ?? '' },
          25 * 60_000,
        )
        return {
          text: JSON.stringify(
            r.allow ? { behavior: 'allow', updatedInput: input.input ?? {} } : { behavior: 'deny', message: r.message ?? 'The person said no.' },
          ),
        }
      } catch (err) {
        return { text: JSON.stringify({ behavior: 'deny', message: `mine couldn’t ask the person: ${(err as Error).message}` }) }
      }
    }
    case 'save_theme': {
      const name = String(input.name ?? '').trim().slice(0, 60)
      if (!name) return { text: 'Give the theme a name.', isError: true }
      const { name: _n, ...patch } = (input.theme ?? {}) as Record<string, unknown>
      const r = saveTheme(join(DIR, 'themes'), name, String(input.description ?? ''), patch as ThemePatch)
      return r.error ? { text: `That theme isn’t valid: ${r.error}`, isError: true } : { text: `Saved ${name} to the theme marketplace (as ${r.id}). The person can apply it from there.` }
    }
    case 'list_connections':
      return { text: json(await app('connections')) }
    case 'suggest_connection': {
      const r = await app<{ id: string; name: string; steps: string[]; stepsLeft: number }>('suggestConnection', input)
      return {
        text: `${r.name} is on the person’s checklist (as ${r.id}), with these steps: ${r.steps.map((s, i) => `${i + 1}. ${s}`).join(' ')}. mine is showing it to them. Once it says connected (list_connections), look at connection_tools and save a source.`,
      }
    }
    case 'connection_tools':
      return { text: json(await app('connectionTools', input, 60_000)) }
    case 'connection_call':
      // it may wait for the person to say yes
      return { text: await app<string>('connectionCall', { ...input, run: process.env.MINE_RUN_ID ?? '' }, 25 * 60_000) }
    case 'save_source': {
      const r = await app<{ id: string }>('saveSource', input)
      return { text: `Saved source ${r.id}. mine is asking the person to approve it; it won’t run until they do. Then sync_source runs it now.` }
    }
    case 'sync_source':
      return { text: json(await app('syncSource', input, 90_000)) }
    case 'remove_source':
      return { text: (await app<boolean>('removeSource', input)) ? 'Removed it and what it synced.' : 'There was no such source.' }
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
