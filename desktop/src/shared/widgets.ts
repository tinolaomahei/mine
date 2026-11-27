// Widgets: small interactive cards an agent builds from HTML, CSS and
// JavaScript. Each lives in userData/widgets/<name>/ as widget.json plus
// index.html. It runs sandboxed, offline, and only after the person approves
// it; it reaches mine only through window.mine, and only the data collections
// it declared.

export const WIDGET_NAME = /^[a-z0-9][a-z0-9-]{0,47}$/

export type WidgetInfo = {
  name: string
  title: string
  description: string
  examples: string[]
  /** Data collections it may read and change. */
  data: string[]
  approved: boolean
  dir: string
  /** Set when widget.json or index.html is missing or broken. */
  error?: string
}

export const WIDGET_GUIDE = `A mine widget is a small interactive card shown inside the conversation, built from HTML, CSS and JavaScript. Make one when the person wants to see or work with something in mine (a to-do list, a timer, a tracker, a dashboard of their data).

Files, in widgets/<name>/ (name is lowercase-with-dashes):
- widget.json: { "title": "To-dos", "description": "The person's to-do list; add, tick off and clear items.", "examples": ["show my to-dos", "open my list"], "data": ["todos"] }
  description and examples let the fast decisions model open it straight away when asked. data lists every collection it reads or changes; it gets no others.
- index.html: the card. Plain HTML with inline <style> and <script>. Other files in the folder load by relative path.

How it runs:
- Sandboxed and offline: no network at all (no fetch, no CDNs, no remote images or fonts). Write everything inline. No alert(), no new windows.
- Sized to its content, up to about 640px tall; scrolls inside beyond that. Background is transparent: it sits on mine's card.
- mine's theme is already applied: use var(--paper), var(--paper-2), var(--surface), var(--ink), var(--muted-ink), var(--neutral), var(--rule), var(--bloom), var(--bloom-deep), var(--bloom-wash), var(--solid), var(--on-solid), var(--signal), var(--font-ui), var(--font-body), var(--font-mono), var(--radius). Light and dark both work if you only use these. Match mine: calm, minimal, no shadows or gradients, roman (not italic) headings.

window.mine (all async):
- mine.props: what it was opened with
- mine.data.list(collection, where?) / get(collection, id) / put(collection, doc) / patch(collection, id, fields) / remove(collection, id)
  docs are JSON objects; put without an id makes one; createdAt and updatedAt are added
- mine.data.watch(collection, callback): runs callback whenever that collection changes (from anywhere). Returns a stop function.
- mine.run(command, params): run a mine command
- mine.ask(text): hand a request to the agent, as if the person said it

The person approves a widget before it first shows, and again after any change to its files.`
