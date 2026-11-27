import { forwardRef, type KeyboardEvent } from 'react'
import { ArrowUp, Mic, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { WaySwitch } from './WaySwitch'

export const TypeWay = forwardRef<
  HTMLTextAreaElement,
  {
    draft: string
    setDraft: (s: string) => void
    running: boolean
    harness: string
    onSend: () => void
    onStop: () => void
    onSwitch: () => void
  }
>(function TypeWay({ draft, setDraft, running, harness, onSend, onStop, onSwitch }, ref) {
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      // while the agent works, Enter queues this as the next message
      onSend()
    }
  }
  const empty = draft.trim().length === 0

  return (
    <div className="relative flex min-h-full items-center px-20">
      <WaySwitch side="left" label="Speak" onClick={onSwitch}>
        <Mic />
      </WaySwitch>

      <div className="composer mx-auto w-full max-w-[40rem]">
        <label htmlFor="prompt" className="sr-only">
          Tell mine what you want
        </label>
        <Textarea
          id="prompt"
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder={running ? 'Type what’s next. It goes when this finishes.' : 'Tell mine what you want'}
          rows={1}
          className="max-h-56 min-h-[3.75rem] resize-none border-0 bg-transparent px-5 pt-4 pb-1 font-serif text-[1.125rem] leading-[1.5] shadow-none placeholder:text-neutral focus-visible:ring-0 md:text-[1.125rem] dark:bg-transparent"
        />
        <div className="flex items-center justify-between gap-3 pr-2.5 pb-2.5 pl-5">
          <p className="truncate font-mono text-[10.5px] text-neutral">
            {running ? (
              <>
                <kbd className="font-mono">esc</kbd> stop <span aria-hidden="true">·</span> <kbd className="font-mono">↵</kbd> queue next
              </>
            ) : (
              <>
                <kbd className="font-mono">↵</kbd> send <span aria-hidden="true">·</span> <kbd className="font-mono">⇧↵</kbd> new line{' '}
                <span aria-hidden="true">·</span> to {harness}
              </>
            )}
          </p>
          {running && empty ? (
            <Button
              type="button"
              size="icon"
              onClick={onStop}
              aria-label="Stop the agent"
              title="Stop (Esc)"
              className="size-10 shrink-0 rounded-full"
            >
              <Square fill="currentColor" className="size-3.5" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              onClick={onSend}
              disabled={empty}
              aria-label={running ? 'Queue as next message' : 'Send'}
              className="size-10 shrink-0 rounded-full bg-bloom text-on-bloom hover:bg-bloom-deep hover:text-on-solid disabled:bg-paper-3 disabled:text-neutral disabled:opacity-100"
            >
              <ArrowUp className="size-[18px]" strokeWidth={2.2} />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
})
