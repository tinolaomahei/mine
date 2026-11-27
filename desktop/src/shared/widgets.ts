// Widgets: small interactive cards built from HTML, CSS and JavaScript. mine
// ships some of its own (native, in resources/widgets) and the person's agents
// make more (yours, in userData/widgets/<name>/). Each runs sandboxed and
// offline; the person's only after they approve it. A widget reaches mine only
// through window.mine, and only the data collections it declared. Every widget
// carries sample data (mock.json) so the marketplace can show it working
// without touching anything real.

export const WIDGET_NAME = /^[a-z0-9][a-z0-9-]{0,47}$/

/** Where a widget is showing. Screens and previews give it a box to fill. */
export type WidgetPlace = 'conversation' | 'screen' | 'preview'

export type GridSize = { w: number; h: number }

export type WidgetInfo = {
  /** How mine refers to it: the folder name for yours, "<name>.native" for mine's own. */
  id: string
  name: string
  source: 'native' | 'yours'
  title: string
  description: string
  examples: string[]
  /** Data collections it may read and change. */
  data: string[]
  /** Its size when first added to a screen, and the smallest it can go, in grid cells. */
  size: GridSize
  minSize: GridSize
  /** Whether it has sample data for previews. */
  mock: boolean
  approved: boolean
  dir: string
  /** Set when widget.json or index.html is missing or broken. */
  error?: string
}

/** Sample data a widget is previewed with: its props and a few documents per collection. */
export type WidgetMock = {
  props?: Record<string, unknown>
  data?: Record<string, Record<string, unknown>[]>
}

// ---- screens ---------------------------------------------------------------------

/** The grid every screen is laid out on. */
export const GRID = { cols: 12, row: 72, gap: 12 } as const

/** One widget placed on a screen. */
export type ScreenItem = {
  id: string
  widget: string
  x: number
  y: number
  w: number
  h: number
  props?: Record<string, unknown>
}

/** A blank page the person fills with widgets and arranges how they like. */
export type Screen = {
  id: string
  name: string
  items: ScreenItem[]
  createdAt: number
  updatedAt: number
}

export const WIDGET_GUIDE = `A mine widget is a small interactive card built from HTML, CSS and JavaScript. It shows in the conversation, and the person can pin it to a screen (a page of widgets they arrange and resize on a grid) or try it in the widget marketplace. Make one when the person wants to see or work with something in mine (a to-do list, a timer, a tracker, a dashboard of their data).

Files, in widgets/<name>/ (name is lowercase-with-dashes):
- widget.json: { "title": "To-dos", "description": "The person's to-do list; add, tick off and clear items. Documents in \\"todos\\": { text: string, done: boolean }.", "examples": ["show my to-dos", "open my list"], "data": ["todos"], "size": { "w": 4, "h": 4 }, "minSize": { "w": 3, "h": 3 } }
  description and examples let the fast decisions model open it straight away when asked; say what shape its documents have. data lists every collection it reads or changes; it gets no others. size is its starting size on a screen in grid cells (12 columns wide, rows 72px tall); minSize the smallest it works at.
- index.html: the card. Plain HTML with inline <style> and <script>. Other files in the folder load by relative path.
- mock.json: sample data for the marketplace preview, so the person can try it without touching their real data: { "props": {}, "data": { "todos": [ { "id": "1", "text": "Book the dentist", "done": false } ] } }. Make it realistic. Always include it.

How it runs:
- Sandboxed and offline: no network at all (no fetch, no CDNs, no remote images or fonts), no localStorage. Write everything inline. No alert(), no new windows.
- mine.place says where it is: "conversation" (sized to its content, up to about 640px tall), "screen" or "preview" (it must fill its box: html and body are height:100%, the box is whatever size the person made it, so use a flex column, let lists scroll inside, and scale big type with container queries). <html data-place> is set too, for CSS.
- Background is transparent: it sits on mine's card. Don't draw an outer border or card.
- mine's theme is already applied: use var(--paper), var(--paper-2), var(--surface), var(--ink), var(--muted-ink), var(--neutral), var(--rule), var(--bloom), var(--on-bloom), var(--bloom-deep), var(--bloom-wash), var(--solid), var(--on-solid), var(--signal), var(--focus), var(--font-display), var(--font-ui), var(--font-body), var(--font-mono), var(--radius). Light and dark both work if you only use these. Match mine: calm, minimal, no shadows or gradients, roman (not italic) headings, small labels in var(--font-mono).

window.mine (all async except props, place and preview):
- mine.props: what it was opened with. On a screen, props.instance is unique to that placement (key per-placement documents by it).
- mine.place: "conversation" | "screen" | "preview". mine.preview is true while it runs on sample data.
- mine.data.list(collection, where?) / get(collection, id) / put(collection, doc) / patch(collection, id, fields) / remove(collection, id)
  docs are JSON objects; put without an id makes one; createdAt and updatedAt are added
- mine.data.watch(collection, callback): runs callback whenever that collection changes (from anywhere). Returns a stop function. Re-render from the data there.
- mine.run(command, params): run a mine command
- mine.ask(text): hand a request to the agent, as if the person said it
- mine.open(url): open a link in the browser (an issue, an event). Only https links to the person's connected services open; it answers false otherwise. Call it from a click.

The person approves a widget before it first shows, and again after any change to its files.`
