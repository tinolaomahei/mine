import { useEffect, useMemo, useRef, useState } from 'react'
import { Rings } from '../lib/rings'
import { prefersReducedMotion } from '../lib/useInView'
import { DownloadButton } from './Download'

const SCRIPT =
  'I run product at a small fintech. Most of my day is in Jira, GitHub and Slack, with Figma for design and Postgres on AWS. Every Monday I pull last week’s bugs into a summary for the team.'

const SERVICES = ['Jira', 'GitHub', 'Slack', 'Figma', 'Postgres', 'AWS']

type Phase = 'idle' | 'listening' | 'done'

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="mic-icon">
      <rect x="8.5" y="3" width="7" height="12" rx="3.5" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" fill="none" />
    </svg>
  )
}

export function Hero() {
  const words = useMemo(() => SCRIPT.split(' '), [])
  const [phase, setPhase] = useState<Phase>('idle')
  const [count, setCount] = useState(0)
  const timer = useRef<number | undefined>(undefined)

  const heard = words.slice(0, count)
  const detected = SERVICES.filter((s) => heard.some((w) => w.replace(/[^A-Za-z]/g, '') === s))

  useEffect(() => () => window.clearInterval(timer.current), [])

  function start() {
    window.clearInterval(timer.current)
    if (prefersReducedMotion()) {
      setCount(words.length)
      setPhase('done')
      return
    }
    setCount(0)
    setPhase('listening')
    let n = 0
    timer.current = window.setInterval(() => {
      n += 1
      setCount(n)
      if (n >= words.length) {
        window.clearInterval(timer.current)
        window.setTimeout(() => setPhase('done'), 450)
      }
    }, 115)
  }

  function stop() {
    window.clearInterval(timer.current)
    setCount(words.length)
    setPhase('done')
  }

  const label = phase === 'listening' ? 'Stop' : phase === 'done' ? 'Say it again' : 'Talk to mine'

  return (
    <header className="hero" id="top">
      <div className="hero-copy">
        <h1 className="hero-title">
          Start with
          <br />
          <span className="hero-nothing">nothing.</span>
        </h1>
        <p className="hero-lede">
          mine is a desktop AI harness that begins as one button. Tell it what you do and which tools you use. It
          learns the rest a task at a time, and grows into a workspace that only fits you.
        </p>
        <div className="hero-actions">
          <DownloadButton />
          <a href="#download" className="hero-more">
            Other platforms
          </a>
        </div>
        <p className="hero-hint">
          <span className="mono">Try it</span> Press the button and listen in on a first conversation.
        </p>
      </div>

      <div className={`stage is-${phase}`}>
        <svg className="stage-rings" viewBox="0 0 400 400" aria-hidden="true">
          <Rings
            cx={200}
            cy={200}
            from={78}
            step={19}
            count={7}
            seed={11}
            wobble={0.04}
            ringClass={(i) => (i < detected.length ? 'ring is-learned' : 'ring')}
          />
        </svg>

        <button
          type="button"
          className="mic"
          aria-pressed={phase === 'listening'}
          onClick={phase === 'listening' ? stop : start}
        >
          <MicIcon />
          <span className="sr-only">{label}</span>
        </button>
        <span className="mic-label mono" aria-hidden="true">
          {phase === 'listening' ? (
            <>
              <i className="rec-dot" /> listening
            </>
          ) : (
            label.toLowerCase()
          )}
        </span>

        <div className="transcript" aria-live="polite">
          {phase === 'idle' ? (
            <p className="transcript-empty">Nothing here yet. That’s the point.</p>
          ) : (
            <p>
              {heard.map((w, i) => {
                const bare = w.replace(/[^A-Za-z]/g, '')
                const isService = SERVICES.includes(bare)
                return (
                  <span key={i} className={isService ? 'word is-service' : 'word'}>
                    {w}{' '}
                  </span>
                )
              })}
              {phase === 'listening' && <span className="caret" aria-hidden="true" />}
            </p>
          )}
        </div>

        <dl className={`heard ${phase === 'done' ? 'is-shown' : ''}`}>
          <div>
            <dt className="mono">role</dt>
            <dd>Product lead, fintech</dd>
          </div>
          <div>
            <dt className="mono">tools</dt>
            <dd>
              {detected.length} to connect
              <a href="#connect" className="inline-link">
                see list
              </a>
            </dd>
          </div>
          <div>
            <dt className="mono">repeats</dt>
            <dd>Monday bug summary</dd>
          </div>
        </dl>
      </div>
    </header>
  )
}
