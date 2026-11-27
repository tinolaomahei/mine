import { forwardRef, useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { ArrowUp, Maximize2, Mic, Minus, Square, X } from 'lucide-react'
import type { Turn } from '@/lib/useConversation'
import type { MicState } from '@/lib/useSpeech'
import { cn } from '@/lib/utils'

// The conversation when a screen is showing: either a small window in the
// bottom-right corner (still fully usable) or just a button there. The button
// peeks at what's happening: what mine just did, or the agent's reply as it
// comes in.

export type DockState = 'window' | 'button'

const plain = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[`*_#>|]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

function tail(text: string, n = 180) {
  const t = plain(text)
  return t.length <= n ? t : '…' + t.slice(t.length - n).replace(/^\S*\s/, '')
}

/** What the button shows next to itself, if anything. */
function peekOf(turns: Turn[], harness: string): { key: string; text: string; who: string } | null {
  const last = turns.at(-1)
  if (!last) return null
  if (last.kind === 'agent') {
    const working = last.state === 'running'
    const tool = [...last.tools].reverse().find((t) => t.status === 'running')
    const text = last.text ? tail(last.text) : working ? (tool ? `Working: ${tool.name}` : 'Working on it…') : (last.error ?? '')
    return text ? { key: `${last.id}.${last.state}`, text, who: harness } : null
  }
  if (last.kind === 'action')
    return {
      key: `${last.id}.${last.state}`,
      text: last.error ? `${last.text}: ${last.error}` : last.text,
      who: 'mine',
    }
  if (last.kind === 'user') return { key: last.id, text: last.text, who: 'you' }
  return null
}

export const DockComposer = forwardRef<
  HTMLTextAreaElement,
  {
    draft: string
    setDraft: (s: string) => void
    running: boolean
    harness: string
    mic: MicState
    note: string | null
    voiceRef: RefObject<HTMLDivElement | null>
    onSend: () => void
    onStop: () => void
    onMic: () => void
  }
>(function DockComposer({ draft, setDraft, running, harness, mic, note, voiceRef, onSend, onStop, onMic }, ref) {
  const empty = !draft.trim()
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      onSend()
    }
  }
  return (
    <div className="shrink-0 border-t border-rule/70 p-2.5">
      <p className="truncate px-1.5 pb-1.5 font-mono text-[10.5px] text-neutral" aria-live="polite">
        {note ??
          (mic === 'listening'
            ? 'Listening. Tap the mic to send.'
            : mic === 'thinking'
              ? 'Writing down what you said'
              : running
                ? `${harness} is working · esc stops`
                : `To ${harness} · space talks`)}
      </p>
      <div className="composer flex items-end gap-1.5 !rounded-[1.375rem] p-1.5">
        <div ref={voiceRef} className="dock-mic" data-state={mic}>
          <button
            type="button"
            onClick={onMic}
            disabled={mic === 'thinking'}
            aria-label={mic === 'listening' ? 'Stop listening and send' : 'Start talking'}
            aria-pressed={mic === 'listening'}
            className="grid size-9 place-items-center rounded-full"
          >
            <Mic className="size-4" strokeWidth={1.9} />
          </button>
        </div>
        <label htmlFor="dock-prompt" className="sr-only">
          Tell mine what you want
        </label>
        <textarea
          id="dock-prompt"
          ref={ref}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder={running ? 'What’s next' : 'Tell mine what you want'}
          className="max-h-32 min-h-9 flex-1 resize-none self-center bg-transparent px-1 py-[7px] font-serif text-[1rem] leading-[1.4] outline-none select-text [field-sizing:content] placeholder:text-neutral"
        />
        {running && empty ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop the agent"
            title="Stop (Esc)"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-solid text-on-solid hover:bg-solid-hover"
          >
            <Square className="size-3" fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={empty}
            aria-label={running ? 'Queue as next message' : 'Send'}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-bloom text-on-bloom transition-colors hover:bg-bloom-deep hover:text-on-solid disabled:bg-paper-3 disabled:text-neutral"
          >
            <ArrowUp className="size-4" strokeWidth={2.2} />
          </button>
        )}
      </div>
    </div>
  )
})

export function ChatDock({
  state,
  onState,
  onFull,
  turns,
  title,
  harness,
  running,
  mic,
  flash,
  voiceRef,
  conversation,
  composer,
}: {
  state: DockState
  onState: (s: DockState) => void
  onFull: () => void
  turns: Turn[]
  title: string
  harness: string
  running: boolean
  mic: MicState
  flash: string | null
  voiceRef: RefObject<HTMLDivElement | null>
  /** The conversation itself, for the window. */
  conversation: ReactNode
  composer: ReactNode
}) {
  const peek = peekOf(turns, harness)
  const [shown, setShown] = useState<string | null>(null)
  const [unread, setUnread] = useState(false)
  const seen = useRef(peek?.key)

  // something new while it's a button: show it for a moment, and mark it unread
  useEffect(() => {
    if (state !== 'button') {
      seen.current = peek?.key
      setUnread(false)
      setShown(null)
      return
    }
    if (!peek || peek.key === seen.current) return
    seen.current = peek.key
    setShown(peek.key)
    if (peek.who !== 'you') setUnread(true)
  }, [peek?.key, state])
  useEffect(() => {
    if (!shown || running) return
    const t = setTimeout(() => setShown(null), 7000)
    return () => clearTimeout(t)
  }, [shown, running])

  if (state === 'button') {
    const bubble = flash ?? (shown && peek ? peek.text : null)
    const listening = mic === 'listening'
    return (
      <div className="fixed right-5 bottom-5 z-40 flex items-end gap-3">
        {bubble && (
          <div className="dock-peek flex max-w-[min(22rem,calc(100vw-7rem))] items-start gap-1 rounded-2xl rounded-br-md border border-rule bg-surface py-2 pr-1.5 pl-3.5 shadow-[0_12px_32px_-14px_rgb(0_0_0/0.3)]">
            <button type="button" onClick={() => onState('window')} className="min-w-0 py-0.5 text-left">
              {!flash && peek && <span className="block font-mono text-[10px] text-neutral uppercase">{peek.who}</span>}
              <span className="line-clamp-3 text-[0.875rem] leading-snug">{bubble}</span>
            </button>
            {!flash && (
              <button
                type="button"
                onClick={() => setShown(null)}
                aria-label="Hide this"
                className="grid size-6 shrink-0 place-items-center rounded-full text-neutral hover:bg-paper-2 hover:text-ink"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        )}
        <div
          ref={voiceRef}
          className="dock-orb"
          data-state={listening ? 'listening' : running ? 'working' : 'idle'}
          style={{ viewTransitionName: 'mine-chat' }}
        >
          <button
            type="button"
            onClick={() => onState('window')}
            aria-label={`Open the conversation${unread ? ', something new' : ''} (Ctrl+J)`}
            title="Conversation (Ctrl+J)"
            className="relative grid size-14 place-items-center rounded-full bg-solid text-bloom transition-[background-color,transform] duration-150 hover:bg-solid-hover active:scale-95"
          >
            <svg viewBox="0 0 32 32" className="size-7" aria-hidden="true">
              <circle cx="16" cy="16" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <circle cx="16" cy="16" r="5" fill="currentColor" />
            </svg>
            {unread && <span className="absolute top-0.5 right-0.5 size-3 rounded-full border-2 border-paper bg-bloom-deep" aria-hidden="true" />}
          </button>
        </div>
      </div>
    )
  }

  return (
    <section
      aria-label="Conversation"
      className="dock-window fixed right-4 bottom-4 z-40 flex flex-col overflow-hidden rounded-2xl border border-rule bg-paper shadow-[0_24px_60px_-24px_rgb(0_0_0/0.35)]"
      style={{
        width: 'min(27rem, calc(100vw - 2rem))',
        height: 'min(40rem, calc(100vh - var(--titlebar) - 2rem))',
        viewTransitionName: 'mine-chat',
      }}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-rule/70 pr-1.5 pl-4">
        <span className={cn('size-1.5 shrink-0 rounded-full bg-bloom-deep', running && 'animate-pulse')} aria-hidden="true" />
        <p className="min-w-0 flex-1 truncate text-[0.875rem] font-semibold">{title}</p>
        <button
          type="button"
          onClick={onFull}
          aria-label="Make the conversation full screen"
          title="Full screen"
          className="grid size-8 place-items-center rounded-full text-neutral hover:bg-paper-2 hover:text-ink"
        >
          <Maximize2 className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onState('button')}
          aria-label="Minimise the conversation (Ctrl+J)"
          title="Minimise (Ctrl+J)"
          className="grid size-8 place-items-center rounded-full text-neutral hover:bg-paper-2 hover:text-ink"
        >
          <Minus className="size-4" />
        </button>
      </header>
      {turns.length ? (
        conversation
      ) : (
        <div className="grid flex-1 place-items-center px-8 text-center">
          <p className="font-serif text-[1.0625rem] text-muted-foreground">
            Say what you want, or type it. {harness} is here while you work on your screen.
          </p>
        </div>
      )}
      {composer}
    </section>
  )
}
