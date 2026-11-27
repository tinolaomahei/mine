import type { RefObject } from 'react'
import { ArrowRight, Mic, Square } from 'lucide-react'
import type { SpeechStatus } from '@shared/ipc'
import { Rings } from '@/lib/rings'
import type { Ears, MicLook } from '@/lib/useSpeech'
import { WaySwitch } from './WaySwitch'

const mb = (n: number) => `${Math.round(n / 1e6)} MB`

function handsFreeLabel(ears: Ears) {
  if (ears === 'hearing') return { main: 'Hearing you', sub: 'Pause when you’re done and it goes' }
  if (ears === 'writing') return { main: 'Writing down what you said', sub: 'On this computer, with Parakeet' }
  if (ears === 'paused') return { main: 'Paused', sub: 'Space or the mic to listen again' }
  return { main: 'Listening for your voice', sub: 'Just talk. Space or the mic pauses it.' }
}

function label(status: SpeechStatus | null, mic: MicLook, running: boolean, harness: string, ears: Ears) {
  if (ears !== 'off' && mic !== 'blocked') return handsFreeLabel(ears)
  if (mic === 'listening') return { main: 'Listening', sub: 'Tap to send · Esc to cancel' }
  if (mic === 'thinking') return { main: 'Writing down what you said', sub: 'On this computer, with Parakeet' }
  if (running) return { main: `${harness} is working`, sub: 'Tap to talk. Say “stop”, or say what’s next.' }
  if (!status) return { main: ' ', sub: ' ' }
  if (status.state === 'missing')
    return { main: 'Tap to set up your voice', sub: `Downloads Parakeet once (${mb(status.bytes)}). It runs on this computer.` }
  if (status.state === 'downloading')
    return {
      main: `Getting Parakeet · ${Math.floor((status.received / status.bytes) * 100)}%`,
      sub: `${mb(status.received)} of ${mb(status.bytes)}. Nothing you say leaves this computer.`,
    }
  if (status.state === 'error') return { main: 'Tap to try the download again', sub: status.message }
  return { main: 'Tap and say what you want', sub: 'Space works too' }
}

export function VoiceWay({
  voiceRef,
  status,
  mic,
  note,
  running,
  harness,
  compact,
  ears,
  handsFree,
  onHandsFree,
  onToggle,
  onStop,
  onSwitch,
}: {
  voiceRef: RefObject<HTMLDivElement | null>
  status: SpeechStatus | null
  mic: MicLook
  ears: Ears
  handsFree: boolean
  onHandsFree: (on: boolean) => void
  note: string | null
  running: boolean
  harness: string
  compact: boolean
  onToggle: () => void
  onStop: () => void
  onSwitch: () => void
}) {
  // while an agent works the mic stays a mic: you can still say "stop", or what's next
  const state = (mic === 'idle' || mic === 'ambient') && running && ears !== 'hearing' ? 'working' : mic
  const downloading = status?.state === 'downloading'
  const progress = downloading ? status.received / status.bytes : 0
  const text = label(status, mic, running, harness, ears)
  const hands = ears !== 'off'
  const C = 2 * Math.PI * 48

  return (
    <div className="relative flex items-center justify-center px-20">
      <div className="flex flex-col items-center">
        <div
          ref={voiceRef}
          className="voice"
          data-state={state}
          style={{ ['--voice-size' as string]: compact ? '8.75rem' : '15rem' }}
        >
          <svg viewBox="0 0 200 200" className="rings" aria-hidden="true">
            <Rings cx={100} cy={100} from={48} step={9.5} count={6} seed={11} wobble={0.05} />
          </svg>
          <button
            type="button"
            className="mic"
            onClick={onToggle}
            disabled={mic === 'thinking' || downloading}
            aria-label={hands ? (ears === 'paused' ? 'Listen again' : 'Pause listening') : mic === 'listening' ? 'Stop listening and send' : 'Start talking'}
            aria-pressed={hands ? ears !== 'paused' : mic === 'listening'}
          >
            <Mic strokeWidth={1.8} />
            {downloading && (
              <svg viewBox="0 0 100 100" className="progress-ring" aria-hidden="true">
                <circle cx="50" cy="50" r="48" className="track" />
                <circle cx="50" cy="50" r="48" className="bar" strokeDasharray={C} strokeDashoffset={C * (1 - progress)} />
              </svg>
            )}
          </button>
        </div>

        <div className="mt-1 flex min-h-[3.25rem] max-w-[26rem] flex-col items-center text-center" aria-live="polite">
          <p className="text-[1.0625rem] font-semibold tracking-[-0.01em]">{text.main}</p>
          <p className="mt-0.5 font-mono text-[11px] leading-5 text-neutral">{note ?? text.sub}</p>
          <button
            type="button"
            role="switch"
            aria-checked={handsFree}
            onClick={() => onHandsFree(!handsFree)}
            className="mt-2.5 flex h-7 items-center gap-2 rounded-full px-2.5 text-[0.8125rem] font-semibold text-muted-foreground transition-colors hover:bg-paper-2 hover:text-ink"
          >
            <span aria-hidden="true" className={`relative h-4 w-7 rounded-full transition-colors ${handsFree ? 'bg-bloom-deep' : 'bg-paper-3'}`}>
              <span className={`absolute top-0.5 size-3 rounded-full bg-paper transition-[left] ${handsFree ? 'left-3.5' : 'left-0.5'}`} />
            </span>
            Always listening
          </button>
          {running && (
            <button
              type="button"
              onClick={onStop}
              className="mt-2 flex h-8 items-center gap-1.5 rounded-full border border-rule px-3.5 text-sm font-semibold transition-colors hover:border-signal/50 hover:bg-signal/10 hover:text-signal"
            >
              <Square className="size-3 fill-current" />
              Stop everything
              <kbd className="ml-0.5 font-mono text-[10px] font-normal text-neutral">esc</kbd>
            </button>
          )}
        </div>
      </div>

      <WaySwitch side="right" label="Type" onClick={onSwitch}>
        <ArrowRight />
      </WaySwitch>
    </div>
  )
}
