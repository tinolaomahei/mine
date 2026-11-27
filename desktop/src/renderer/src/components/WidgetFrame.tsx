import { useEffect, useMemo, useRef, useState } from 'react'
import { LayoutDashboard, RotateCw } from 'lucide-react'
import type { WidgetMock, WidgetPlace } from '@shared/widgets'
import { useAbilities } from '@/lib/abilities'
import { mockStore } from '@/lib/mockStore'
import { cn } from '@/lib/utils'
import { Approval } from './Approval'

// A live widget, sandboxed and offline, talking to mine only through its
// bridge. In the conversation it sizes itself to its content; on a screen or in
// a preview it fills the box it's given. Previews run on the widget's sample
// data, in memory, so trying one never touches the person's real data.

type Message = {
  mine?: number
  id?: number
  method?: string
  args?: unknown[]
  event?: string
  height?: number
  message?: string
}

export function WidgetFrame({
  id,
  props,
  place = 'conversation',
  sample = false,
  reloadKey = 0,
  onNote,
  className,
}: {
  id: string
  props?: Record<string, unknown>
  place?: WidgetPlace
  /** Run on the widget's sample data instead of the real store. */
  sample?: boolean
  /** Change it to reload the widget. */
  reloadKey?: number
  /** Something to tell the person, e.g. that a preview can't run commands. */
  onNote?: (text: string) => void
  className?: string
}) {
  const { widgets, run, ask, addToScreen } = useAbilities()
  // older conversations refer to the person's widgets by folder name
  const w = widgets.find((x) => x.id === id) ?? widgets.find((x) => x.name === id && x.source === 'yours')
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(96)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const [mock, setMock] = useState<WidgetMock | null>(sample ? null : {})
  const noteRef = useRef(onNote)
  noteRef.current = onNote
  const fill = place !== 'conversation'

  // previews: fetch the sample data once; each preview gets its own copy
  useEffect(() => {
    if (!sample || !w) return
    let live = true
    void window.mine.widgets.mock(w.id).then((m) => live && setMock(m))
    return () => {
      live = false
    }
  }, [sample, w?.id])
  const store = useMemo(() => (sample && mock ? mockStore(mock.data) : null), [sample, mock, nonce, reloadKey])

  const post = (m: unknown) => ref.current?.contentWindow?.postMessage(m, '*')

  useEffect(() => {
    if (!w?.approved || (sample && !store)) return
    const allowed = new Set(w.data)
    const onMessage = async (e: MessageEvent) => {
      if (!ref.current || e.source !== ref.current.contentWindow) return
      const m = e.data as Message
      if (!m?.mine) return
      if (m.event === 'height') return fill ? undefined : setHeight(Math.min(640, Math.max(32, Number(m.height) || 0)))
      if (m.event === 'error') return setError(String(m.message))
      if (!m.id || !m.method) return
      const args = m.args ?? []
      const reply = (ok: boolean, value?: unknown, err?: string) => post({ mine: 1, id: m.id, ok, value, error: err })
      try {
        if (m.method.startsWith('data.')) {
          const op = m.method.slice(5) as 'list' | 'get' | 'put' | 'patch' | 'remove'
          const c = String(args[0])
          if (!allowed.has(c)) throw new Error(`This widget didn’t ask for the “${c}” data, so it can’t use it.`)
          if (store) {
            const r = store(op, args)
            reply(true, r.value)
            // tell it, the way the real store's watcher would
            if (r.changed) setTimeout(() => post({ mine: 1, event: 'data', collection: r.changed }), 0)
          } else reply(true, await window.mine.data.call(op, args))
        } else if (m.method === 'run') {
          if (sample) {
            noteRef.current?.(`In a preview, “${String(args[0])}” doesn’t run.`)
            return reply(true, { say: 'Preview: nothing ran.' })
          }
          const r = await run(String(args[0]), (args[1] ?? {}) as Record<string, string>)
          if (r.error) throw new Error(r.error)
          reply(true, { say: r.say, view: r.view })
        } else if (m.method === 'open') {
          if (sample) {
            noteRef.current?.('In a preview, links don’t open.')
            return reply(true, false)
          }
          reply(true, await window.mine.connections.open(String(args[0] ?? '')))
        } else if (m.method === 'ask') {
          if (sample) {
            noteRef.current?.('In a preview, nothing goes to the agent.')
            return reply(true, false)
          }
          ask(String(args[0] ?? ''))
          reply(true, true)
        } else throw new Error(`Unknown call ${m.method}`)
      } catch (err) {
        reply(false, undefined, (err as Error).message)
      }
    }
    window.addEventListener('message', onMessage)
    const offData = sample ? () => {} : window.mine.data.onChange((c) => allowed.has(c) && post({ mine: 1, event: 'data', collection: c }))
    const offTheme = window.mine.theme.onChange(() => post({ mine: 1, event: 'theme' }))
    return () => {
      window.removeEventListener('message', onMessage)
      offData()
      offTheme()
    }
  }, [w, run, ask, sample, store, fill])

  if (!w) return <p className="p-3 text-sm text-muted-foreground">There’s no widget called {id} any more.</p>
  if (w.error)
    return (
      <p className="p-3 font-mono text-[11.5px] text-signal">
        Widget {w.title} is broken: {w.error}
      </p>
    )
  if (!w.approved)
    return fill ? (
      <div className="scroll-soft h-full overflow-auto p-3">
        <Approval item="widget" name={w.name} />
      </div>
    ) : (
      <Approval item="widget" name={w.name} />
    )
  if (sample && !mock) return <div className={cn('h-full', className)} aria-busy="true" />

  const hash = encodeURIComponent(
    JSON.stringify({
      p: { ...(sample ? mock?.props : {}), ...props },
      place,
      preview: sample,
    }),
  )
  const iframe = (
    <iframe
      key={`${nonce}.${reloadKey}`}
      ref={ref}
      title={w.title}
      sandbox="allow-scripts allow-forms"
      referrerPolicy="no-referrer"
      src={`mine-widget://${w.id}/index.html#${hash}`}
      style={fill ? undefined : { height }}
      className={cn('block w-full border-0', fill && 'h-full')}
    />
  )

  if (fill)
    return (
      <div className={cn('relative h-full', className)}>
        {iframe}
        {error && (
          <p className="absolute inset-x-0 bottom-0 border-t border-rule/70 bg-surface px-3 py-1.5 font-mono text-[11px] text-signal">{error}</p>
        )}
      </div>
    )

  return (
    <figure className={cn('group/widget relative overflow-hidden rounded-xl border border-rule bg-surface', className)} aria-label={w.title}>
      <div className="absolute top-1.5 right-1.5 z-10 flex gap-0.5 rounded-full bg-surface opacity-0 transition-opacity group-hover/widget:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          onClick={() => addToScreen(w.id, props)}
          aria-label={`Add ${w.title} to a screen`}
          title="Add to a screen"
          className="grid size-7 place-items-center rounded-full text-neutral hover:bg-paper-2 hover:text-ink"
        >
          <LayoutDashboard className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            setError(null)
            setNonce((n) => n + 1)
          }}
          aria-label={`Reload ${w.title}`}
          title={`Reload ${w.title}`}
          className="grid size-7 place-items-center rounded-full text-neutral hover:bg-paper-2 hover:text-ink"
        >
          <RotateCw className="size-3.5" />
        </button>
      </div>
      {iframe}
      {error && <p className="border-t border-rule/70 px-3.5 py-2 font-mono text-[11px] text-signal">{error}</p>}
    </figure>
  )
}
