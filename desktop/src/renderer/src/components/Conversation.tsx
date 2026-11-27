import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CommandView as View } from '@shared/commands'
import { undoOf, type ToolCall, type Turn } from '@/lib/useConversation'
import { Approval } from './Approval'
import { CommandView } from './CommandView'
import { Markdown } from './Markdown'
import { Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ToolChip } from './ToolChip'

// The harness loading its own tool definitions: not the person's concern.
const HIDDEN = new Set(['ToolSearch'])
const SHOW = 8

function Tools({ tools, onStop }: { tools: ToolCall[]; onStop?: (id: string) => void }) {
  const [all, setAll] = useState(false)
  const list = tools.filter((t) => !HIDDEN.has(t.name))
  if (!list.length) return null
  // long runs collapse their earlier steps; running ones always stay visible
  const hidden = all ? [] : list.slice(0, Math.max(0, list.length - SHOW)).filter((t) => t.status !== 'running')
  const shown = list.filter((t) => !hidden.includes(t))
  return (
    <ul className="mb-3 flex flex-wrap gap-1.5" aria-label="Tools used">
      {hidden.length > 0 && (
        <li>
          <button
            type="button"
            onClick={() => setAll(true)}
            className="h-7 rounded-full px-2.5 font-mono text-[10.5px] text-neutral hover:bg-paper-2 hover:text-ink"
          >
            +{hidden.length} earlier
          </button>
        </li>
      )}
      {shown.map((t) => (
        <ToolChip key={t.id} tool={t} onStop={onStop} />
      ))}
    </ul>
  )
}

export function Conversation({
  turns,
  harness,
  onStopTool,
  onUndo,
  onHand,
  onSetView,
  compact,
}: {
  /** Tighter, for the small window over a screen. */
  compact?: boolean
  turns: Turn[]
  harness: string
  onStopTool?: (id: string) => void
  onUndo?: (id: string) => void
  onHand?: (id: string) => void
  /** A view changed itself, e.g. a file list opening a subfolder. */
  onSetView?: (turnId: string, view: View) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLOListElement>(null)
  // Follow the bottom until the reader scrolls up; scrolling back down picks it up again.
  const following = useRef(true)
  const toBottom = () => {
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
  }

  // Anything that makes the thread taller (streaming text, a file list, a widget
  // sizing itself) keeps it at the bottom while following.
  useEffect(() => {
    const ro = new ResizeObserver(() => following.current && toBottom())
    if (list.current) ro.observe(list.current)
    return () => ro.disconnect()
  }, [])

  // Whatever the person just said always brings the thread to the bottom.
  const lastSaid = [...turns].reverse().find((t) => t.kind === 'user')?.id
  useLayoutEffect(() => {
    following.current = true
    toBottom()
  }, [lastSaid])
  useLayoutEffect(() => {
    if (following.current) toBottom()
  }, [turns])

  return (
    <div
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget
        following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
      }}
      className="scroll-soft min-h-0 flex-1 overflow-y-auto"
    >
      <ol
        ref={list}
        className={cn('flex flex-col', compact ? 'gap-6 px-4 pt-4 pb-4' : 'mx-auto max-w-[42rem] gap-8 px-6 pt-8 pb-6')}
        aria-label="Conversation"
      >
        {turns.map((t) => {
          if (t.kind === 'note')
            return (
              <li key={t.id} className="flex items-center gap-3 font-mono text-[10.5px] text-neutral uppercase">
                <span className="h-px flex-1 bg-rule" />
                {t.text}
                <span className="h-px flex-1 bg-rule" />
              </li>
            )
          if (t.kind === 'approval')
            return (
              <li key={t.id}>
                <Approval item={t.item} name={t.name} />
              </li>
            )
          if (t.kind === 'view')
            return (
              <li key={t.id}>
                <CommandView view={t.view} onChange={(v) => onSetView?.(t.id, v)} />
              </li>
            )
          if (t.kind === 'action')
            return (
              <li key={t.id}>
                <p className="mb-2 flex items-center gap-2 font-mono text-[10.5px] text-neutral uppercase">
                  <Zap className="size-3 text-bloom-deep" aria-hidden="true" />
                  mine <span aria-hidden="true">·</span> <span className="normal-case">{t.meta}</span>
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <p className={cn('text-[1.0625rem] font-semibold', t.state !== 'done' && 'text-neutral line-through decoration-1')}>
                    {t.text}
                  </p>
                  {t.state === 'done' && (
                    <span className="flex items-center gap-1">
                      {undoOf(t) && (
                        <button
                          type="button"
                          onClick={() => onUndo?.(t.id)}
                          className="h-7 rounded-full px-2.5 text-sm font-medium text-muted-foreground hover:bg-paper-2 hover:text-ink"
                        >
                          Undo
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onHand?.(t.id)}
                        className="h-7 rounded-full px-2.5 text-sm font-medium text-muted-foreground hover:bg-paper-2 hover:text-ink"
                      >
                        Ask {harness} instead
                      </button>
                    </span>
                  )}
                  {t.state === 'undone' && <span className="font-mono text-[10.5px] text-neutral uppercase">undone</span>}
                  {t.state === 'handed' && <span className="font-mono text-[10.5px] text-neutral uppercase">sent to {harness}</span>}
                </div>
                {t.error && (
                  <p className="mt-2 rounded-lg border border-signal/30 bg-signal/5 px-3 py-2 font-mono text-[11.5px] whitespace-pre-wrap text-signal">
                    {t.error}
                  </p>
                )}
                {t.view && t.state !== 'handed' && (
                  <div className="mt-3">
                    <CommandView view={t.view} onChange={(v) => onSetView?.(t.id, v)} />
                  </div>
                )}
              </li>
            )
          if (t.kind === 'user')
            return (
              <li key={t.id} className="self-end max-w-[85%]">
                <p className="mb-1.5 text-right font-mono text-[10.5px] text-neutral uppercase">
                  you {t.via === 'voice' ? 'said' : 'typed'}
                </p>
                <p className="said rounded-[1.25rem] rounded-br-md bg-solid px-4 py-2.5 text-[1.0625rem] leading-snug text-on-solid">
                  {t.text}
                </p>
              </li>
            )
          return (
            <li key={t.id}>
              <p className="mb-2 flex items-center gap-2 font-mono text-[10.5px] text-neutral uppercase">
                <span className="size-1.5 rounded-full bg-bloom-deep" aria-hidden="true" />
                {t.harness}
              </p>
              <Tools tools={t.tools} onStop={t.state === 'running' ? onStopTool : undefined} />
              {(t.text || t.state === 'running') && (
                <div className="prose-agent">
                  {t.text && <Markdown text={t.text} />}
                  {t.state === 'running' && <span className="caret" aria-label="Working" />}
                </div>
              )}
              {t.state === 'error' &&
                (t.error === 'Stopped.' ? (
                  // the person stopped it: not a failure
                  <p className="mt-2 flex items-center gap-1.5 font-mono text-[10.5px] text-neutral uppercase">
                    <span className="size-1.5 rounded-[2px] bg-neutral" aria-hidden="true" />
                    Stopped
                  </p>
                ) : (
                  <p className="mt-2 rounded-lg border border-signal/30 bg-signal/5 px-3 py-2 font-mono text-[11.5px] whitespace-pre-wrap text-signal">
                    {t.error}
                  </p>
                ))}
              {t.views?.map((v, i) => (
                <div key={i} className="mt-3">
                  <CommandView view={v} />
                </div>
              ))}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
