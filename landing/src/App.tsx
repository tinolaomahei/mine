import { useState, type FormEvent } from 'react'
import { Hero } from './components/Hero'
import { Connect } from './components/Connect'
import { Intent } from './components/Intent'
import { Workflows } from './components/Workflows'
import { Growth } from './components/Growth'
import { Arrange } from './components/Arrange'
import { Team } from './components/Team'
import { Engine } from './components/Engine'

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
          <p className="mono">© 2026 mine</p>
        </div>
      </footer>
    </>
  )
}
