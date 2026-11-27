import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react'
import { ArrowLeft, ArrowRight, ArrowUp, Check, ExternalLink, KeyRound, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { commandLine, isCommandCall, isToolCall, stepDone, stepsLeft, type CommandCall, type Connection, type ConnectionsState, type Field, type ServiceInfo, type SourceInfo, type Step } from '@shared/connections'
import type { Answer } from '@shared/ipc'
import { setupLeft, useLogos } from '@/lib/useConnections'
import { cn } from '@/lib/utils'

// Connecting the tools the person uses: each connection is a checklist of
// exactly what to do (sign in, or make a token and paste it), and the sources
// that then keep data flowing into their widgets. What they paste goes
// straight to mine's main process; it never comes back to this window.

const WIDGET_FOR: Record<string, string> = { work: 'Work', agenda: 'Agenda', messages: 'Messages' }

/** Readable text on a brand colour. */
function textOn(hex?: string) {
  const m = hex?.match(/^#([0-9a-f]{6})$/i)
  if (!m) return '#fff'
  const n = parseInt(m[1], 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#141414' : '#ffffff'
}

/**
 * A service's mark: its real logo on a light tile, like an app icon (light in
 * dark mode too, so black logos like GitHub's and Notion's still show). A
 * connection mine doesn't know shows its initial on its own colour.
 */
export function Mark({ name, colour, logo, className }: { name: string; colour?: string; logo?: string; className?: string }) {
  if (logo)
    return (
      <span
        aria-hidden="true"
        className={cn('grid size-9 shrink-0 place-items-center overflow-hidden rounded-[calc(var(--radius)*0.75)] bg-[#fff] ring-1 ring-rule/80', className)}
      >
        <img src={logo} alt="" draggable={false} className={logo.startsWith('data:image/png') ? 'size-full object-contain p-[3px]' : 'size-[58%] object-contain'} />
      </span>
    )
  const bg = colour ?? 'var(--solid)'
  return (
    <span
      aria-hidden="true"
      className={cn('grid size-9 shrink-0 place-items-center rounded-[calc(var(--radius)*0.75)] font-display text-[15px] font-semibold', className)}
      style={{ background: bg, color: colour ? textOn(colour) : 'var(--on-solid)' }}
    >
      {name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 1).toUpperCase()}
    </span>
  )
}

const ago = (t?: number) => {
  if (!t) return 'not yet'
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(t).toLocaleDateString()
}

/** Where the person's details are ever sent, in their words. */
function whereTo(c: Connection) {
  if (c.way.kind === 'local') return []
  if (c.way.kind === 'mcp') return [new URL(c.way.url).host]
  return c.way.hosts
    .map((h) => {
      if (!h.includes('{{')) return h
      const k = h.match(/\{\{\s*([^}\s]+)\s*\}\}/)?.[1]
      const v = k ? c.fields[k] : ''
      try {
        return v ? new URL(v).host : `your ${k}`
      } catch {
        return `your ${k}`
      }
    })
    .filter(Boolean)
}

function useAction() {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = async (key: string, p: Promise<Answer<unknown>>) => {
    setBusy(key)
    setError(null)
    const r = await p
    setBusy(null)
    if (!r.ok) setError(r.error)
    else if (r.value && typeof r.value === 'object' && 'ok' in r.value && !(r.value as { ok: boolean }).ok) setError((r.value as { error?: string }).error ?? 'That didn’t work.')
    return r
  }
  return { busy, error, setError, run }
}

const btn = 'inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[0.8125rem] font-semibold transition-colors disabled:opacity-60'
const primary = cn(btn, 'bg-solid text-on-solid hover:bg-solid-hover')
const quiet = cn(btn, 'border border-rule hover:bg-paper-2')

// --- steps ------------------------------------------------------------------------------

function FieldStep({ c, field }: { c: Connection; field: Field }) {
  const has = field.secret ? c.secrets.includes(field.key) : !!c.fields[field.key]
  const [editing, setEditing] = useState(!has)
  const [value, setValue] = useState('')
  const { busy, error, run } = useAction()
  useEffect(() => setEditing(!has), [has])
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!value.trim()) return
    const r = await run('save', window.mine.connections.setField(c.id, field.key, value))
    if (r.ok) setValue('')
  }
  if (has && !editing)
    return (
      <div className="mt-1.5 flex items-center gap-2 text-[0.8125rem]">
        {field.secret ? (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <KeyRound className="size-3.5" /> Saved, encrypted
          </span>
        ) : (
          <span className="truncate font-mono text-[12px]">{c.fields[field.key]}</span>
        )}
        <button type="button" onClick={() => setEditing(true)} className="font-semibold text-bloom-deep hover:underline">
          Change
        </button>
      </div>
    )
  return (
    <form onSubmit={save} className="mt-2 flex flex-col gap-1.5">
      <div className="flex gap-2">
        <input
          aria-label={field.label}
          type={field.secret ? 'password' : 'text'}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={field.placeholder ?? (field.secret ? 'Paste it here' : '')}
          className="h-9 min-w-0 flex-1 rounded-[calc(var(--radius)*0.6)] border border-rule bg-paper px-3 font-mono text-[12.5px] outline-none placeholder:text-neutral focus-visible:border-bloom-deep"
        />
        <button type="submit" disabled={!value.trim() || busy === 'save'} className={primary}>
          {busy === 'save' ? <Loader2 className="size-3.5 animate-spin" /> : 'Save'}
        </button>
        {has && (
          <button type="button" onClick={() => setEditing(false)} className={quiet}>
            Keep
          </button>
        )}
      </div>
      {error && <p className="text-[0.8125rem] text-signal">{error}</p>}
    </form>
  )
}

function StepRow({ c, step, n, onAction, closed }: { c: Connection; step: Step; n: number; onAction: ReturnType<typeof useAction>; closed?: string }) {
  const done = stepDone(c, step)
  const field = step.kind === 'field' ? (c.way.auth === 'fields' ? c.way.fields.find((f) => f.key === step.field) : undefined) : undefined
  const { busy, run } = onAction
  const toggle = () => void window.mine.connections.tick(c.id, step.id, !done)

  return (
    <li className="flex gap-3">
      {step.kind === 'confirm' ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={step.label}
          onClick={toggle}
          className={cn(
            'mt-0.5 grid size-5.5 shrink-0 place-items-center rounded-full border text-[11px] font-semibold transition-colors',
            done ? 'border-bloom-deep bg-bloom-deep text-paper' : 'border-rule hover:border-bloom-deep',
          )}
        >
          {done ? <Check className="size-3" strokeWidth={3} /> : n}
        </button>
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 grid size-5.5 shrink-0 place-items-center rounded-full border font-mono text-[10.5px]',
            done ? 'border-bloom-deep bg-bloom-deep text-paper' : 'border-rule text-muted-foreground',
          )}
        >
          {done ? <Check className="size-3" strokeWidth={3} /> : n}
        </span>
      )}
      <div className="min-w-0 flex-1 pb-1">
        <p className={cn('text-[0.9375rem] leading-snug', done && step.kind !== 'field' && 'text-muted-foreground')}>
          <span className="sr-only">{done ? 'Done: ' : ''}</span>
          {step.label}
        </p>
        {step.detail && <p className="mt-0.5 font-serif text-[0.875rem] leading-snug text-muted-foreground">{step.detail}</p>}
        {step.kind === 'link' && step.url && (
          <a
            href={step.url}
            target="_blank"
            rel="noreferrer"
            onClick={() => !done && toggle()}
            className="mt-1.5 inline-flex items-center gap-1 text-[0.8125rem] font-semibold text-bloom-deep hover:underline"
          >
            Open {new URL(step.url).host}
            <ExternalLink className="size-3" />
          </a>
        )}
        {field && <FieldStep c={c} field={field} />}
        {step.kind === 'signin' && c.status !== 'connected' && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {c.status === 'connecting' ? (
              <>
                <span className="inline-flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Finish signing in in your browser
                </span>
                <button type="button" onClick={() => void window.mine.connections.cancelSignIn()} className={quiet}>
                  Cancel
                </button>
              </>
            ) : closed ? (
              <p className="text-[0.8125rem] leading-snug text-muted-foreground">{closed}</p>
            ) : (
              <button type="button" onClick={() => void run('signin', window.mine.connections.signIn(c.id))} disabled={busy === 'signin'} className={primary}>
                {step.label}
              </button>
            )}
          </div>
        )}
        {step.kind === 'test' && c.status !== 'connected' && (
          <button
            type="button"
            onClick={() => void run('test', window.mine.connections.test(c.id))}
            disabled={busy === 'test' || stepsLeft(c) > 1}
            className={cn(quiet, 'mt-2')}
          >
            {busy === 'test' ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Check it
          </button>
        )}
      </div>
    </li>
  )
}

// --- sources ---------------------------------------------------------------------------

function CallShown({ call }: { call: Exclude<SourceInfo['call'], CommandCall> }) {
  const text = isToolCall(call) ? `${call.tool}${call.args && Object.keys(call.args).length ? ` ${JSON.stringify(call.args)}` : ''}` : `GET ${call.path || '(the address)'}`
  return (
    <p className="mt-1.5 truncate font-mono text-[11px] text-muted-foreground" title={text}>
      {text}
    </p>
  )
}

function CommandShown({ call }: { call: CommandCall }) {
  return (
    <div className="mt-2">
      <pre className="scroll-soft max-h-32 overflow-auto rounded-lg bg-code-bg px-3 py-2 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-all text-code-fg select-text">
        {commandLine(call)}
      </pre>
      <details className="mt-1.5 text-[0.75rem] text-muted-foreground">
        <summary className="cursor-pointer break-words select-none">
          {call.command} with {call.args.length} {call.args.length === 1 ? 'argument' : 'arguments'}, in {call.cwd ?? 'your home folder'}, read as {call.format ?? 'json'}
        </summary>
        <ol className="mt-1 flex flex-col gap-0.5 pl-1">
          {call.args.map((a, i) => (
            <li key={i} className="flex gap-2">
              <span className="w-5 shrink-0 text-right font-mono text-[10.5px] text-neutral">{i + 1}</span>
              <code className="font-mono text-[11.5px] break-all text-ink">{a === '' ? '(empty)' : a}</code>
            </li>
          ))}
        </ol>
      </details>
    </div>
  )
}

function SourceRow({ s, c }: { s: SourceInfo; c: Connection }) {
  const { busy, error, run } = useAction()
  const where = WIDGET_FOR[s.into] ? `the ${WIDGET_FOR[s.into]} widget` : `the “${s.into}” collection`
  const local = isCommandCall(s.call)
  if (!s.approved)
    return (
      <div role="group" aria-label={`${s.title}, waiting for your OK`} className="min-w-0 rounded-lg border border-bloom-deep/40 bg-bloom-wash/40 p-3">
        <p className="text-[0.875rem] font-semibold">{s.title}</p>
        <p className="mt-0.5 font-serif text-[0.875rem] leading-snug">
          {s.by === 'agent' ? 'Your agent wants' : 'This wants'} to {local ? 'run a program on this computer' : `read ${c.name}`} every {s.every} minutes and show what it
          finds in {where}. {s.what}
        </p>
        {isCommandCall(s.call) ? <CommandShown call={s.call} /> : <CallShown call={s.call} />}
        {s.readOnly === false && <p className="mt-1.5 text-[0.8125rem] font-semibold text-signal">{c.name} says this tool can change things in your account.</p>}
        {s.readOnly === null && !local && <p className="mt-1.5 text-[0.8125rem] text-muted-foreground">{c.name} doesn’t say whether this only reads. Only approve it if you’re happy for it to run on its own.</p>}
        {local && (
          <p className="mt-1.5 text-[0.8125rem] leading-snug text-muted-foreground">
            It runs with the same access you have, on its own, every {s.every} minutes. Only approve it if you know what this command does.
          </p>
        )}
        <div className="mt-2.5 flex gap-2">
          <button type="button" onClick={() => void run('ok', window.mine.connections.approveSource(s.id))} className={primary}>
            <ShieldCheck className="size-3.5" /> Approve
          </button>
          <button type="button" onClick={() => void run('rm', window.mine.connections.removeSource(s.id))} className={quiet}>
            No thanks
          </button>
        </div>
        {error && <p className="mt-1.5 text-[0.8125rem] text-signal">{error}</p>}
      </div>
    )
  return (
    <div className="flex items-start gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-[0.875rem] font-semibold">{s.title}</p>
        <p className="mt-0.5 font-mono text-[10.5px] text-neutral uppercase">
          {WIDGET_FOR[s.into] ?? s.into} · every {s.every} min · {s.lastRun ? `synced ${ago(s.lastRun)}` : 'not synced yet'}
          {s.count != null && !s.lastError ? ` · ${s.count} ${s.count === 1 ? 'item' : 'items'}` : ''}
        </p>
        {(s.lastError || error) && <p className="mt-1 text-[0.8125rem] text-signal">{error ?? s.lastError}</p>}
      </div>
      <button
        type="button"
        aria-label={`Sync ${s.title} now`}
        onClick={() => void run('sync', window.mine.connections.sync(c.id))}
        className="grid size-7 place-items-center rounded-full text-neutral hover:bg-paper-2 hover:text-ink"
      >
        <RefreshCw className={cn('size-3.5', busy === 'sync' && 'animate-spin')} />
      </button>
      <button
        type="button"
        aria-label={`Stop syncing ${s.title}`}
        onClick={() => void run('rm', window.mine.connections.removeSource(s.id))}
        className="grid size-7 place-items-center rounded-full text-neutral hover:bg-paper-2 hover:text-ink"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

// --- one connection ---------------------------------------------------------------------

function Status({ c }: { c: Connection }) {
  const left = stepsLeft(c)
  if (c.status === 'connected')
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[10.5px] text-bloom-deep uppercase">
        <Check className="size-3" strokeWidth={3} /> Connected
      </span>
    )
  if (c.status === 'connecting') return <span className="font-mono text-[10.5px] text-muted-foreground uppercase">Signing in</span>
  if (c.status === 'broken') return <span className="font-mono text-[10.5px] text-signal uppercase">Needs you</span>
  return <span className="font-mono text-[10.5px] text-muted-foreground uppercase">{left === 1 ? '1 step to go' : `${left} steps to go`}</span>
}

export function ConnectionCard({ c, service, sources }: { c: Connection; service?: ServiceInfo; sources: SourceInfo[] }) {
  const action = useAction()
  const logos = useLogos()
  const [removing, setRemoving] = useState(false)
  const [open, setOpen] = useState(c.status !== 'connected')
  useEffect(() => {
    if (c.status !== 'connected') setOpen(true)
  }, [c.status])
  const mine = sources.filter((s) => s.connection === c.id)
  const offered = (c.wayIndex != null ? service?.sources?.[c.wayIndex] ?? [] : []).filter((d) => !mine.some((s) => s.title === d.title))
  const otherWays = (service?.ways ?? []).filter((w) => w.index !== c.wayIndex)
  // signing in isn't open until mine is registered with the service
  const wayNow = service?.ways.find((w) => w.index === c.wayIndex)
  const where = whereTo(c)
  const waiting = mine.filter((s) => !s.approved).length

  return (
    <article aria-label={`${c.name} connection`} className="min-w-0 rounded-xl border border-rule bg-surface">
      <header className="flex items-center gap-3 p-4 pb-3">
        <Mark name={c.name} colour={c.colour} logo={c.service ? logos[c.service] : undefined} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="truncate font-display text-[1.0625rem] font-semibold tracking-[-0.015em]">{c.name}</h3>
            <Status c={c} />
          </div>
          <p className="truncate text-[0.8125rem] text-muted-foreground">
            {c.status === 'connected' ? (c.account ?? 'Ready') : c.why ?? (c.way.auth === 'oauth' ? 'Sign in to connect it.' : 'Paste what it needs to connect.')}
          </p>
        </div>
        {c.status === 'connected' && (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={quiet}>
            {open ? 'Hide steps' : 'Steps'}
          </button>
        )}
        {removing ? (
          <button
            type="button"
            autoFocus
            onBlur={() => setRemoving(false)}
            onClick={() => void window.mine.connections.remove(c.id)}
            className="h-7 rounded-full bg-signal/10 px-2.5 text-[0.75rem] font-semibold text-signal hover:bg-signal/15"
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setRemoving(true)}
            aria-label={`Disconnect ${c.name}`}
            className="grid size-7 shrink-0 place-items-center rounded-full text-neutral hover:bg-paper-2 hover:text-ink"
          >
            <X className="size-3.5" />
          </button>
        )}
      </header>

      {open && (
        <div className="border-t border-rule/60 px-4 pt-3.5 pb-4">
          {c.status === 'connected' && c.why && <p className="mb-3 font-serif text-[0.9375rem] leading-snug text-muted-foreground">{c.why}</p>}
          <ol className="flex flex-col gap-3">
            {c.steps.map((s, i) => (
              <StepRow key={s.id} c={c} step={s} n={i + 1} onAction={action} closed={wayNow?.ready === false ? wayNow.why : undefined} />
            ))}
          </ol>
          {(action.error || c.error) && <p className="mt-3 text-[0.8125rem] leading-snug text-signal">{action.error ?? c.error}</p>}
          <p className="mt-3 flex items-start gap-1.5 text-[0.75rem] leading-snug text-muted-foreground">
            <ShieldCheck className="mt-px size-3.5 shrink-0" />
            {c.way.kind === 'local'
              ? 'Each sync runs a program on this computer, with your access. You see and approve the exact command first, and again if it ever changes.'
              : c.way.auth === 'oauth'
              ? `You sign in on ${c.name}’s own page. mine keeps the access it gives encrypted on this computer, and only uses it with ${where.join(', ')}.`
              : `What you paste is kept encrypted on this computer and only ever sent to ${where.join(', ')}. Agents never see it.`}
          </p>
          {otherWays.length > 0 && c.status !== 'connected' && (
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem]">
              <span className="text-muted-foreground">Or:</span>
              {otherWays.map((w) => (
                <button
                  key={w.index}
                  type="button"
                  disabled={!w.ready}
                  title={w.why}
                  onClick={() => void action.run('way', window.mine.connections.useWay(c.id, w.index))}
                  className="font-semibold text-bloom-deep hover:underline disabled:font-normal disabled:text-neutral disabled:no-underline"
                >
                  {w.label}
                  {!w.ready && ' (not open yet)'}
                </button>
              ))}
            </p>
          )}
        </div>
      )}

      {c.status === 'connected' && (mine.length > 0 || offered.length > 0) && (
        <div className="border-t border-rule/60 px-4 py-3">
          <h4 className="mb-1.5 font-mono text-[10px] text-neutral uppercase">{waiting ? 'Waiting for your OK' : 'Syncing'}</h4>
          <div className="flex flex-col gap-2">
            {mine.map((s) => (
              <SourceRow key={s.id} s={s} c={c} />
            ))}
            {offered.map((d) => (
              <div key={d.title} className="flex items-center gap-3 py-1">
                <div className="min-w-0 flex-1">
                  <p className="text-[0.875rem] font-semibold">{d.title}</p>
                  <p className="text-[0.8125rem] text-muted-foreground">
                    {d.what} {WIDGET_FOR[d.into] ? `Shows in the ${WIDGET_FOR[d.into]} widget.` : ''}
                  </p>
                </div>
                <button type="button" onClick={() => void action.run('add', window.mine.connections.addSource(c.id, d.title))} className={quiet}>
                  Sync it
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  )
}

/** Everything still to set up, then what's connected. */
export function SetupChecklist({ state, columns }: { state: ConnectionsState; columns?: boolean }) {
  const order = (c: Connection) => (c.status === 'connected' ? (state.sources.some((s) => s.connection === c.id && !s.approved) ? 1 : 2) : 0)
  const list = [...state.connections].sort((a, b) => order(a) - order(b) || a.createdAt - b.createdAt)
  return (
    <div className={cn('grid grid-cols-[minmax(0,1fr)] gap-3', columns && 'lg:grid-cols-[repeat(2,minmax(0,1fr))] lg:items-start')}>
      {list.map((c) => (
        <ConnectionCard key={c.id} c={c} service={state.services.find((s) => s.id === c.service)} sources={state.sources} />
      ))}
    </div>
  )
}

// --- the empty screen --------------------------------------------------------------------

const EXAMPLES = [
  'I’m a developer. We plan in Jira, review on GitHub and talk in Slack.',
  'I run a small studio: Figma, Notion and Google Calendar.',
  'Product manager. Linear for work, Notion for docs, Outlook for meetings.',
]

/**
 * An empty screen: tell mine about your day, and it works out what to connect.
 * The same page, with a way back, is "Your tools" for a screen that has widgets.
 */
export function ScreenStart({
  name,
  state,
  inputRef,
  onTell,
  onBrowse,
  onConnect,
  onBack,
}: {
  name: string
  state: ConnectionsState | null
  inputRef?: RefObject<HTMLTextAreaElement | null>
  onTell: (text: string) => void
  onBrowse: () => void
  onConnect: () => void
  /** On the tools page: back to the screen it came from. */
  onBack?: () => void
}) {
  const [text, setText] = useState('')
  const local = useRef<HTMLTextAreaElement>(null)
  const ref = inputRef ?? local
  const send = () => {
    if (!text.trim()) return
    onTell(text.trim())
    setText('')
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }
  const has = !!state?.connections.length
  const done = has && setupLeft(state).total === 0

  return (
    <div className="scroll-soft h-full overflow-y-auto">
      <div className={cn('mx-auto max-w-[44rem] px-6 pb-36', onBack ? 'pt-8' : 'pt-[clamp(2rem,9vh,6rem)]')}>
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="-ml-1 inline-flex items-center gap-1.5 rounded-full px-1 py-0.5 font-mono text-[10.5px] text-neutral uppercase transition-colors hover:text-ink"
          >
            <ArrowLeft className="size-3.5" /> Back to {name}
          </button>
        ) : (
          <p className="font-mono text-[10.5px] text-neutral uppercase">Setting up {name}</p>
        )}
        <h2 className="mt-3 font-display text-[clamp(2rem,1.5rem+1.8vw,2.75rem)] leading-[1.02] font-semibold tracking-[-0.04em]">
          {done ? 'Your tools are connected.' : has ? 'Here’s what to connect.' : 'Tell mine about your day.'}
        </h2>
        <p className="mt-3 max-w-[36rem] font-serif text-[1.0625rem] leading-snug text-muted-foreground">
          {done
            ? 'Their data keeps flowing into your widgets. Tell mine about anything else you use, or ask for a widget built around what’s here.'
            : has
              ? `Work through each one below. When a tool’s connected, mine fills ${onBack ? name : 'this screen'} with widgets that use your real data.`
              : 'What do you do, and which tools does your team use? mine works out what to connect, shows you exactly what to do for each one, then fills this screen with widgets that use your real data.'}
        </p>

        <div className="mt-6 rounded-xl border border-rule bg-surface p-2 focus-within:border-bloom-deep/60">
          <label htmlFor="screen-start" className="sr-only">
            What you do day to day, and the tools you use
          </label>
          <textarea
            id="screen-start"
            ref={ref}
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder={has ? 'Anything else you use? “We also track bugs in Sentry.”' : EXAMPLES[0]}
            className="block w-full resize-none bg-transparent px-2.5 py-2 text-[1rem] leading-snug outline-none placeholder:text-neutral"
          />
          <div className="flex items-center justify-between gap-3 px-1.5 pb-0.5">
            <span className="font-mono text-[10px] text-neutral">Enter to send · your agent reads this</span>
            <button type="button" onClick={send} disabled={!text.trim()} className={cn(primary, 'h-9 pr-3')}>
              Tell mine
              <ArrowUp className="size-3.5" />
            </button>
          </div>
        </div>

        {!has && (
          <div className="mt-3 flex flex-wrap gap-2" aria-label="Examples">
            {EXAMPLES.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => {
                  setText(e)
                  ref.current?.focus()
                }}
                className="rounded-full border border-rule px-3 py-1.5 text-left text-[0.8125rem] text-muted-foreground transition-colors hover:border-bloom-deep/50 hover:text-ink"
              >
                {e}
              </button>
            ))}
          </div>
        )}

        {has && state ? (
          <div className="mt-8">
            <SetupChecklist state={state} />
          </div>
        ) : (
          <ol className="mt-10 grid gap-5 border-t border-rule/70 pt-6 sm:grid-cols-3">
            {[
              ['Describe your day', 'The work you do and the tools you do it in. Plain words are fine.'],
              ['Connect your tools', 'A checklist for each one. Signing in is a click for most; some need a token you paste.'],
              ['Pick your widgets', 'mine’s own, or new ones your agent builds around your data. Then arrange them.'],
            ].map(([t, d], i) => (
              <li key={t}>
                <span className="font-mono text-[10.5px] text-bloom-deep">0{i + 1}</span>
                <p className="mt-1 font-semibold">{t}</p>
                <p className="mt-0.5 font-serif text-[0.9375rem] leading-snug text-muted-foreground">{d}</p>
              </li>
            ))}
          </ol>
        )}

        <p className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-[0.875rem]">
          <button type="button" onClick={onConnect} className="font-semibold text-bloom-deep hover:underline">
            Connect a tool yourself
          </button>
          <button type="button" onClick={onBrowse} className="font-semibold text-bloom-deep hover:underline">
            Browse widgets
          </button>
        </p>
      </div>
    </div>
  )
}

// --- the marketplace shelf --------------------------------------------------------------

const GROUPS: ServiceInfo['group'][] = ['Work', 'Code', 'Docs', 'Messages', 'Calendar', 'Design', 'Business', 'Automation']

export function ServiceShelf({ state, onAdded }: { state: ConnectionsState; onAdded?: (id: string) => void }) {
  const { error, run } = useAction()
  const logos = useLogos()
  const grid = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-3'
  return (
    <>
      {state.connections.length > 0 && (
        <section aria-labelledby="conn-yours" className="mt-10">
          <h2 id="conn-yours" className="mb-3 font-mono text-[10.5px] text-neutral uppercase">
            Your connections
          </h2>
          <SetupChecklist state={state} columns />
        </section>
      )}
      {error && <p className="mt-4 text-[0.875rem] text-signal">{error}</p>}
      {GROUPS.map((g) => {
        const list = state.services.filter((s) => s.group === g)
        if (!list.length) return null
        return (
          <section key={g} aria-labelledby={`conn-${g}`} className="mt-10">
            <h2 id={`conn-${g}`} className="mb-3 font-mono text-[10.5px] text-neutral uppercase">
              {g}
            </h2>
            <div className={grid}>
              {list.map((s) => {
                const c = state.connections.find((x) => x.service === s.id)
                const signIn = s.ways.find((w) => w.auth === 'oauth')
                return (
                  <article key={s.id} aria-label={s.name} className="flex flex-col rounded-xl border border-rule bg-surface p-4">
                    <div className="flex items-center gap-3">
                      <Mark name={s.name} colour={s.colour} logo={logos[s.id]} />
                      <div className="min-w-0">
                        <h3 className="truncate font-display text-[1rem] font-semibold tracking-[-0.015em]">{s.name}</h3>
                        <p className="truncate text-[0.8125rem] text-muted-foreground">{s.what}</p>
                      </div>
                    </div>
                    <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Ways to connect">
                      {s.ways.map((w) => (
                        <li
                          key={w.index}
                          title={w.why}
                          className={cn('rounded-full px-2 py-0.5 font-mono text-[10px]', w.ready ? 'bg-paper-2 text-ink' : 'bg-paper-2/60 text-neutral line-through decoration-neutral/60')}
                        >
                          {w.auth === 'oauth' ? (w.kind === 'mcp' ? 'Sign in · MCP' : 'Sign in') : w.kind === 'mcp' ? 'Token · MCP' : w.label.includes('address') || w.label.includes('link') ? 'Calendar link' : 'API token'}
                        </li>
                      ))}
                    </ul>
                    {signIn && !signIn.ready && <p className="mt-2 text-[0.75rem] leading-snug text-muted-foreground">{signIn.why}</p>}
                    <div className="mt-auto pt-3">
                      {c ? (
                        <span className={cn('inline-flex h-8 items-center gap-1.5 text-[0.8125rem] font-semibold', c.status === 'connected' ? 'text-bloom-deep' : 'text-muted-foreground')}>
                          {c.status === 'connected' ? <Check className="size-3.5" strokeWidth={2.5} /> : null}
                          {c.status === 'connected' ? 'Connected' : 'On your list'}
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={!s.ways.some((w) => w.ready)}
                          onClick={async () => {
                            const r = await run('add', window.mine.connections.add(s.id))
                            if (r.ok) onAdded?.(r.value as string)
                          }}
                          className={quiet}
                        >
                          Connect
                        </button>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        )
      })}
    </>
  )
}

/**
 * A slim note at the top of a screen that has widgets but tools still to
 * connect. It sits in the page, above the widgets, and moves nothing.
 */
export function SetupNotice({ state, onOpen, onLater }: { state: ConnectionsState; onOpen: () => void; onLater: () => void }) {
  const logos = useLogos()
  const left = setupLeft(state)
  if (!left.total) return null
  const todo = state.connections.filter((c) => c.status !== 'connected')
  const what = [
    left.connections ? `${left.connections} ${left.connections === 1 ? 'tool' : 'tools'} to connect` : '',
    left.sources ? `${left.sources} ${left.sources === 1 ? 'sync' : 'syncs'} waiting for your OK` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="px-5 pt-5">
      <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-rule bg-surface px-4 py-2.5">
        {todo.length > 0 && (
          <span className="flex -space-x-1.5" aria-hidden="true">
            {todo.slice(0, 4).map((c) => (
              <Mark key={c.id} name={c.name} colour={c.colour} logo={c.service ? logos[c.service] : undefined} className="size-7 ring-2 ring-surface" />
            ))}
          </span>
        )}
        <p className="min-w-0 flex-1 text-[0.875rem]">
          <span className="font-semibold">{what}.</span>{' '}
          <span className="text-muted-foreground">
            {todo.length ? `${todo.map((c) => c.name).join(', ')} ${todo.length === 1 ? 'isn’t' : 'aren’t'} feeding your widgets yet.` : 'Your widgets fill in once you OK them.'}
          </span>
        </p>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onLater} className="h-8 rounded-full px-3 text-[0.8125rem] font-semibold text-muted-foreground hover:bg-paper-2 hover:text-ink">
            Later
          </button>
          <button type="button" onClick={onOpen} className={primary}>
            Continue setup <ArrowRight className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
