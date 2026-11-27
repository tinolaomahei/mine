import { useState } from 'react'
import { ShieldQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAbilities } from '@/lib/abilities'

/**
 * Something an agent made, waiting for the person's OK. Nothing it contains
 * runs until they approve; any later change to it asks again.
 */
export function Approval({ item, name }: { item: 'command' | 'widget'; name: string }) {
  const { commands, widgets } = useAbilities()
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState(false)

  const pending = item === 'command' ? commands?.pending.find((p) => p.name === name) : undefined
  const widget = item === 'widget' ? widgets.find((w) => w.name === name) : undefined
  const live = item === 'command' ? commands?.commands.find((c) => c.name === name) : widget?.approved ? widget : undefined
  const waiting = item === 'command' ? !!pending : !!widget && !widget.approved && !widget.error

  if (!waiting)
    return (
      <p className="flex items-center gap-2 font-mono text-[10.5px] text-neutral uppercase">
        <span className="h-px flex-1 bg-rule" />
        {live ? `${item} “${'title' in live ? live.title : name}” approved` : `${item} ${name} removed`}
        <span className="h-px flex-1 bg-rule" />
      </p>
    )

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label={`Approve the ${item} ${name}`} className="rounded-xl border-[1.5px] border-rule bg-surface px-4 py-3.5">
      <p className="flex items-center gap-1.5 font-mono text-[10.5px] text-neutral uppercase">
        <ShieldQuestion className="size-3.5 text-bloom-deep" aria-hidden="true" /> Needs your OK
      </p>
      <p className="mt-1.5 text-[1.0625rem] font-semibold">
        {item === 'command' ? 'A new command: ' : 'A new widget: '}
        <span className="font-mono text-[0.9375rem] font-medium">{widget?.title && widget.title !== name ? widget.title : name}</span>
      </p>
      <p className="mt-1 font-serif text-[1rem] leading-snug text-muted-foreground">
        {item === 'command'
          ? 'It runs code on this computer, with your access to files and programs. Approve it only if you asked for it.'
          : widget?.data.length
            ? `It runs in a sandbox with no internet. It can read and change your ${widget.data.join(', ')} data.`
            : 'It runs in a sandbox with no internet and no access to your data.'}
        {widget?.description ? ` ${widget.description}` : ''}
      </p>

      {reading && pending && (
        <pre className="scroll-soft mt-3 max-h-72 overflow-auto rounded-lg bg-code-bg px-3.5 py-3 font-mono text-[11.5px] leading-relaxed text-code-fg select-text">
          {pending.source}
        </pre>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          disabled={busy}
          className="h-8 rounded-full px-4"
          onClick={() => act(() => (item === 'command' ? window.mine.commands.approve(name) : window.mine.widgets.approve(name)))}
        >
          Approve
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 rounded-full px-3 text-muted-foreground"
          onClick={() => (item === 'command' ? setReading((r) => !r) : void window.mine.widgets.reveal(name))}
        >
          {item === 'command' ? (reading ? 'Hide the code' : 'Read the code') : 'Open its folder'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          className="h-8 rounded-full px-3 text-neutral"
          onClick={() => act(() => (item === 'command' ? window.mine.commands.remove(name) : window.mine.widgets.remove(name)))}
        >
          Remove
        </Button>
      </div>
    </section>
  )
}
