import { useEffect, useState } from 'react'
import { Check, ExternalLink, Loader2, Zap } from 'lucide-react'
import {
  DECISION_PROVIDERS,
  decisionProvider,
  type DecisionProviderId,
  type DecisionsStatus,
  type DecisionsTest,
} from '@shared/decisions'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Onboarding step two (and Settings, Instant commands): pick a decisions provider and add its key. */
export function DecisionsSetup({ harness, onDone, onBack }: { harness: string; onDone: () => void; onBack?: () => void }) {
  const [status, setStatus] = useState<DecisionsStatus | null>(null)
  const [provider, setProvider] = useState<DecisionProviderId>('typesafe')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [key, setKey] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<DecisionsTest | null>(null)

  useEffect(() => {
    void window.mine.decisions.status().then((s) => {
      setStatus(s)
      const cur = s.settings
      if (cur && cur.provider !== 'off') {
        setProvider(cur.provider)
        setModel(cur.model ?? '')
        setBaseUrl(cur.baseUrl ?? '')
        if (cur.baseUrl || cur.model) setAdvanced(true)
      }
    })
  }, [])

  const p = decisionProvider(provider)
  const saved = status?.keys[provider] ?? false

  const choose = (id: DecisionProviderId) => {
    setProvider(id)
    setModel('')
    setBaseUrl('')
    setKey('')
    setResult(null)
  }

  const test = async () => {
    setBusy(true)
    setResult(null)
    const r = await window.mine.decisions.save({ provider, model, baseUrl }, key || undefined)
    setBusy(false)
    setResult(r)
    if (r.ok) {
      setKey('')
      setStatus(await window.mine.decisions.status())
    }
  }

  const skip = async () => {
    await window.mine.decisions.save({ provider: 'off' })
    onDone()
  }

  return (
    <div className="scroll-soft flex min-h-0 flex-1 overflow-y-auto">
      <section className="m-auto w-full max-w-[38rem] px-6 py-10" aria-labelledby="decisions-title">
        <p className="flex items-center gap-1.5 font-mono text-[11px] text-neutral uppercase">
          <Zap className="size-3" /> Make it instant
        </p>
        <h1 id="decisions-title" className="mt-3 font-display text-[2.5rem] leading-[1.02] font-semibold tracking-[-0.035em] text-balance">
          Add a decisions model for things mine can just do.
        </h1>
        <p className="mt-4 max-w-[33rem] font-serif text-[1.125rem] leading-[1.5] text-muted-foreground">
          Before anything goes to {harness}, a small System One model checks whether it’s one of mine’s own commands, like
          “switch to dark mode” or “undo that”. Those happen in a fraction of a second. Everything else goes to {harness} as
          usual.
        </p>

        <div role="radiogroup" aria-label="Decisions provider" className="mt-8 grid gap-2.5">
          {DECISION_PROVIDERS.map((d) => {
            const on = d.id === provider
            return (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => choose(d.id)}
                className={cn(
                  'grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-4 rounded-xl border-[1.5px] bg-surface px-4 py-3.5 text-left transition-[border-color,box-shadow] duration-150 ease-out hover:border-neutral',
                  on ? 'border-ink shadow-[0_0_0_3px_var(--bloom-wash)]' : 'border-rule',
                )}
              >
                <span
                  className={cn(
                    'mt-1 grid size-5 place-items-center rounded-full border-[1.5px]',
                    on ? 'border-ink bg-ink text-paper' : 'border-neutral',
                  )}
                  aria-hidden="true"
                >
                  {on && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[1.125rem] font-semibold">{d.name}</span>
                    <span className="text-sm text-neutral">{d.vendor}</span>
                  </span>
                  <span className="mt-0.5 block font-serif text-[1rem] leading-snug text-muted-foreground">{d.blurb}</span>
                  <span className="mt-1.5 block truncate font-mono text-[10.5px] text-neutral">{d.defaultModel}</span>
                </span>
                {status?.keys[d.id] && (
                  <span className="rounded-full bg-paper-2 px-2 py-0.5 font-mono text-[10px] text-muted-foreground uppercase">key saved</span>
                )}
              </button>
            )
          })}
        </div>

        <div className="mt-6">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="decisions-key" className="text-sm font-semibold">
              {p.keyLabel}
            </label>
            <a
              href={p.keyUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 font-mono text-[10.5px] text-bloom-deep underline-offset-2 hover:underline"
            >
              Get a key <ExternalLink className="size-3" />
            </a>
          </div>
          <input
            id="decisions-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => {
              setKey(e.target.value)
              setResult(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && !busy && void test()}
            placeholder={saved ? 'A key is saved. Leave empty to keep it.' : 'Paste your key'}
            className="mt-1.5 h-11 w-full rounded-xl border-[1.5px] border-rule bg-surface px-3.5 font-mono text-[13px] outline-none select-text placeholder:font-sans placeholder:text-[0.9375rem] placeholder:text-neutral focus:border-bloom-deep focus:shadow-[0_0_0_4px_var(--bloom-wash)]"
          />
          <p className="mt-1.5 font-mono text-[10.5px] leading-5 text-neutral">
            {status?.canEncrypt === false
              ? 'This computer can’t encrypt stored keys, so mine keeps it for this session only.'
              : 'Encrypted with your system keychain. It never leaves this computer except to call the provider.'}
          </p>

          <button
            type="button"
            onClick={() => setAdvanced((a) => !a)}
            className="mt-3 font-mono text-[10.5px] text-neutral underline-offset-2 hover:text-ink hover:underline"
            aria-expanded={advanced}
          >
            {advanced ? 'Hide' : 'Model and endpoint'}
          </button>
          {advanced && (
            <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="font-mono text-[10.5px] text-neutral uppercase">Model</span>
                <input
                  list="decision-models"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={p.defaultModel}
                  spellCheck={false}
                  className="h-10 rounded-lg border-[1.5px] border-rule bg-surface px-3 font-mono text-[12px] outline-none select-text focus:border-bloom-deep"
                />
                <datalist id="decision-models">
                  {p.models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-mono text-[10.5px] text-neutral uppercase">Endpoint</span>
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={p.baseUrl}
                  spellCheck={false}
                  className="h-10 rounded-lg border-[1.5px] border-rule bg-surface px-3 font-mono text-[12px] outline-none select-text focus:border-bloom-deep"
                />
              </label>
            </div>
          )}
        </div>

        <div aria-live="polite" className="mt-5 min-h-[1.5rem]">
          {result?.ok && (
            <p className="rounded-xl bg-bloom-wash px-4 py-3 text-[0.9375rem]">
              <span className="font-semibold">Connected in {result.ms} ms.</span>{' '}
              <span className="text-muted-foreground">
                {result.model} heard {result.heard}.
              </span>
            </p>
          )}
          {result && !result.ok && (
            <p className="rounded-xl border border-signal/30 bg-signal/5 px-4 py-3 font-mono text-[12px] whitespace-pre-wrap text-signal">
              {result.error}
            </p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {result?.ok ? (
            <Button size="lg" className="h-11 rounded-full px-6 text-[0.9375rem]" onClick={onDone}>
              Done
            </Button>
          ) : (
            <Button size="lg" className="h-11 rounded-full px-6 text-[0.9375rem]" onClick={test} disabled={busy || (!key && !saved)}>
              {busy && <Loader2 className="animate-spin" />}
              {busy ? 'Testing' : 'Test and save'}
            </Button>
          )}
          <Button variant="ghost" size="lg" className="h-11 rounded-full px-4" onClick={onBack ?? skip}>
            {onBack ? 'Back' : 'Skip for now'}
          </Button>
          {onBack && status?.settings?.provider !== 'off' && status?.settings && (
            <Button variant="ghost" size="lg" className="h-11 rounded-full px-4 text-neutral" onClick={skip}>
              Turn off
            </Button>
          )}
        </div>
      </section>
    </div>
  )
}
