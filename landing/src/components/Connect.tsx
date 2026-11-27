import { useState } from 'react'

type Status = 'connected' | 'waiting' | 'expired' | 'working'

type Service = { name: string; scope: string; status: Status }

const INITIAL: Service[] = [
  { name: 'Jira', scope: 'read and create issues', status: 'connected' },
  { name: 'GitHub', scope: 'repos, pull requests', status: 'connected' },
  { name: 'Slack', scope: 'post to #product', status: 'waiting' },
  { name: 'Figma', scope: 'read files and comments', status: 'waiting' },
  { name: 'Postgres', scope: 'read-only replica', status: 'waiting' },
  { name: 'AWS', scope: 'billing and logs', status: 'expired' },
]

const STATUS_TEXT: Record<Status, string> = {
  connected: 'connected',
  waiting: 'not signed in',
  expired: 'token expired',
  working: 'opening sign-in…',
}

export function Connect() {
  const [services, setServices] = useState(INITIAL)
  const done = services.filter((s) => s.status === 'connected').length

  function signIn(name: string) {
    setServices((list) => list.map((s) => (s.name === name ? { ...s, status: 'working' } : s)))
    window.setTimeout(() => {
      setServices((list) => list.map((s) => (s.name === name ? { ...s, status: 'connected' } : s)))
    }, 900)
  }

  return (
    <section className="section connect" id="connect" aria-labelledby="connect-title">
      <div className="split">
        <div className="split-copy">
          <p className="stage-label mono">Day 0</p>
          <h2 id="connect-title" className="h2">
            Six tools. One page of sign-ins.
          </h2>
          <p className="body">
            Mention a service once and mine puts it on your list. It already knows where each one signs in, so there
            are no keys to hunt for and no setup screens to click through.
          </p>
          <p className="body">
            You get a single link. Work down the page, sign in to each, and come back to the same page whenever a
            token runs out.
          </p>
        </div>

        <div className="checklist" role="group" aria-label="Sign-in checklist">
          <div className="checklist-head">
            <span className="mono">mine://connect</span>
            <span className="mono checklist-count">
              {done} of {services.length}
            </span>
          </div>
          <div className="checklist-bar" aria-hidden="true">
            <span style={{ transform: `scaleX(${done / services.length})` }} />
          </div>
          <ul>
            {services.map((s) => (
              <li key={s.name} className={`svc is-${s.status}`}>
                <span className="svc-mark" aria-hidden="true">
                  <svg viewBox="0 0 20 20">
                    <circle cx="10" cy="10" r="8" />
                    <path d="M6.2 10.4l2.5 2.4 5-5.4" />
                  </svg>
                </span>
                <span className="svc-name">{s.name}</span>
                <span className="svc-scope">{s.scope}</span>
                <span className="svc-status mono">{STATUS_TEXT[s.status]}</span>
                {s.status === 'connected' ? (
                  <span className="svc-action is-quiet mono" aria-hidden="true">
                    ✓
                  </span>
                ) : (
                  <button
                    type="button"
                    className="svc-action"
                    disabled={s.status === 'working'}
                    onClick={() => signIn(s.name)}
                  >
                    {s.status === 'expired' ? 'Sign in again' : 'Sign in'}
                    <span className="sr-only"> to {s.name}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="checklist-foot">
            {done === services.length ? 'All connected. mine can start working.' : 'Sign-ins happen in your browser. mine never sees your password.'}
          </p>
        </div>
      </div>
    </section>
  )
}
