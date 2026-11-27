import { useState } from 'react'
import { Check, RefreshCw } from 'lucide-react'
import type { HarnessId, HarnessInfo } from '@shared/ipc'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// The educated guess: if a vendor's own harness is installed, the person most
// likely signed in to it on purpose. Pi is the fallback.
const PREFERENCE: HarnessId[] = ['claude', 'codex', 'gemini', 'cursor', 'opencode', 'goose', 'pi']

export function guessHarness(list: HarnessInfo[]): HarnessInfo | undefined {
  return PREFERENCE.map((id) => list.find((h) => h.id === id && h.found)).find(Boolean)
}

export function HarnessPicker({
  harnesses,
  onPick,
  onRescan,
}: {
  harnesses: HarnessInfo[]
  onPick: (id: HarnessId) => void
  onRescan: () => Promise<void>
}) {
  const found = harnesses.filter((h) => h.found)
  const missing = harnesses.filter((h) => !h.found)
  const guess = guessHarness(harnesses)
  const [choice, setChoice] = useState<HarnessId | undefined>(guess?.id)
  const [scanning, setScanning] = useState(false)
  const chosen = found.find((h) => h.id === choice)

  const rescan = async () => {
    setScanning(true)
    await onRescan()
    setScanning(false)
  }

  return (
    <div className="scroll-soft flex min-h-0 flex-1 overflow-y-auto">
      <section className="m-auto w-full max-w-[38rem] px-6 py-10" aria-labelledby="pick-title">
        <p className="font-mono text-[11px] text-neutral uppercase">Bring your own harness</p>
        <h1 id="pick-title" className="mt-3 font-display text-[2.5rem] leading-[1.02] font-semibold tracking-[-0.035em] text-balance">
          {found.length === 0
            ? 'No agent harness on this computer yet.'
            : found.length === 1
              ? `Found ${found[0].name} on this computer.`
              : `Found ${found.length} agent harnesses on this computer.`}
        </h1>
        <p className="mt-4 max-w-[32rem] font-serif text-[1.125rem] leading-[1.5] text-muted-foreground">
          {found.length === 0
            ? 'mine drives the agent you already use. Install one, then search again.'
            : 'mine hands what you say to the agent you already use, signed in the way you already are. Pick one. You can switch any time in Settings.'}
        </p>

        {found.length > 0 && (
          <div role="radiogroup" aria-label="Harness" className="mt-8 grid gap-2.5">
            {found.map((h) => {
              const on = h.id === choice
              return (
                <button
                  key={h.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setChoice(h.id)}
                  onDoubleClick={() => onPick(h.id)}
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
                      <span className="text-[1.125rem] font-semibold">{h.name}</span>
                      <span className="text-sm text-neutral">{h.vendor}</span>
                    </span>
                    <span className="mt-0.5 block font-serif text-[1rem] leading-snug text-muted-foreground">{h.blurb}</span>
                    <span className="mt-1.5 block truncate font-mono text-[10.5px] text-neutral">{h.path}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1.5">
                    {h.id === guess?.id && (
                      <span className="rounded-full bg-bloom px-2 py-0.5 font-mono text-[10px] text-on-bloom uppercase">suggested</span>
                    )}
                    {h.version && <span className="font-mono text-[10.5px] text-neutral">v{h.version}</span>}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {chosen && (
            <Button size="lg" className="h-11 rounded-full px-6 text-[0.9375rem]" onClick={() => onPick(chosen.id)}>
              Use {chosen.name}
            </Button>
          )}
          <Button variant="ghost" size="lg" className="h-11 rounded-full px-4" onClick={rescan} disabled={scanning}>
            <RefreshCw className={cn(scanning && 'animate-spin')} />
            Search again
          </Button>
        </div>

        {missing.length > 0 && (
          <p className="mt-8 border-t border-rule pt-4 font-mono text-[10.5px] leading-5 text-neutral">
            Also works with {missing.map((h) => h.name).join(', ')}. None of those are installed.
          </p>
        )}
      </section>
    </div>
  )
}
