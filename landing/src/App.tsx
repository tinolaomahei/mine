import { useState, type FormEvent } from 'react'
import { Hero } from './components/Hero'
import { Connect } from './components/Connect'
import { Intent } from './components/Intent'
import { Workflows } from './components/Workflows'
import { Growth } from './components/Growth'
import { Arrange } from './components/Arrange'
import { Team } from './components/Team'
import { Engine } from './components/Engine'

const REPO = 'https://github.com/tinolaomahei/mine'

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

function Access() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'error' | 'sent'>('idle')

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setState('error')
      return
    }
    // TODO: send to the real waitlist endpoint once it exists.
    setState('sent')
  }

  return (
    <section className="section access" id="access" aria-labelledby="access-title">
      <h2 id="access-title" className="h2">
        mine is early. Come and shape it.
      </h2>
      <p className="body">
        We’re building it with a small group of people who will use it every day. Leave an email and we’ll write
        when there’s a build to try.
      </p>
      {state === 'sent' ? (
        <p className="access-done" role="status">
          Thanks. We’ll write to <strong>{email}</strong> when there’s something to install.
        </p>
      ) : (
        <form className="access-form" onSubmit={submit} noValidate>
          <label htmlFor="email" className="sr-only">
            Email address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@work.com"
            value={email}
            aria-invalid={state === 'error'}
            aria-describedby={state === 'error' ? 'email-error' : undefined}
            onChange={(e) => {
              setEmail(e.target.value)
              if (state === 'error') setState('idle')
            }}
          />
          <button type="submit" className="btn btn-solid">
            Get early access
          </button>
          {state === 'error' && (
            <p id="email-error" className="access-error">
              That email looks incomplete. Check it and try again.
            </p>
          )}
        </form>
      )}
    </section>
  )
}

export default function App() {
  return (
    <>
      <a className="skip" href="#connect">
        Skip to content
      </a>
      <nav className="edge-nav" aria-label="Primary">
        <a href="#top" className="wordmark">
          mine
        </a>
        <div className="edge-links">
          <a href="#learns">How it learns</a>
          <a href="#engine">Under the hood</a>
          <a href={REPO} className="edge-github" aria-label="mine on GitHub">
            <GitHubMark />
            <span>GitHub</span>
          </a>
          <a href="#access" className="edge-cta">
            Early access
          </a>
        </div>
      </nav>

      <main>
        <Hero />
        <Connect />
        <Intent />
        <Workflows />
        <Arrange />
        <Growth />
        <Team />
        <Engine />
        <Access />
      </main>

      <footer className="footer">
        <p className="footer-mark" aria-hidden="true">
          mine
        </p>
        <div className="footer-row">
          <p>A desktop AI harness that learns how you work.</p>
          <p className="footer-links">
            <a href={REPO}>
              <GitHubMark />
              github.com/tinolaomahei/mine
            </a>
          </p>
          <p className="mono">© 2026 mine</p>
        </div>
      </footer>
    </>
  )
}
