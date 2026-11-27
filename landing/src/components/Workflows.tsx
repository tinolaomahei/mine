import { useState } from 'react'

const RUNS = ['Mon 3 Nov', 'Mon 10 Nov', 'Mon 17 Nov']
const STEPS = ['Query last week’s bugs', 'Group by area', 'Write the summary', 'Post to #product']

type Choice = 'ask' | 'saved' | 'later'

export function Workflows() {
  const [choice, setChoice] = useState<Choice>('ask')

  return (
    <section className="section workflows" id="learns" aria-labelledby="wf-title">
      <div className="wf-head">
        <p className="stage-label mono">Week 3</p>
        <h2 id="wf-title" className="h2">
          Do it twice. It offers to keep it.
        </h2>
        <p className="body">
          mine watches for the jobs you repeat. When the same steps turn up again, it asks whether to save them. A
          saved workflow runs from one sentence, on a schedule, or when something changes upstream.
        </p>
      </div>

      <div className="wf-figure">
        <div className="matrix" role="table" aria-label="The same four steps, three Mondays running">
          <div className="matrix-row matrix-headrow" role="row">
            <span role="columnheader" className="matrix-corner"><span className="sr-only">Step</span></span>
            {RUNS.map((run) => (
              <span key={run} role="columnheader" className="matrix-date mono">
                {run}
              </span>
            ))}
          </div>
          {STEPS.map((step, s) => (
            <div key={step} className="matrix-row" role="row" style={{ ['--s' as string]: s }}>
              <span role="rowheader" className="matrix-step">
                {step}
              </span>
              {RUNS.map((run) => (
                <span key={run} role="cell" className="matrix-cell">
                  <span className="dot" aria-hidden="true" />
                  <span className="sr-only">done</span>
                </span>
              ))}
            </div>
          ))}
        </div>

        <div className={`offer is-${choice}`} aria-live="polite">
          {choice === 'ask' && (
            <>
              <p className="offer-text">
                You’ve done this three Mondays in a row. Save it as <strong>Monday bug summary</strong>?
              </p>
              <div className="offer-actions">
                <button type="button" className="btn btn-solid" onClick={() => setChoice('saved')}>
                  Save workflow
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setChoice('later')}>
                  Not now
                </button>
              </div>
            </>
          )}
          {choice === 'saved' && (
            <>
              <p className="offer-text">
                <strong>Monday bug summary</strong> saved. Runs Mondays at 9:00, or say “do the bug summary”.
              </p>
              <div className="offer-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setChoice('ask')}>
                  Undo
                </button>
              </div>
            </>
          )}
          {choice === 'later' && (
            <>
              <p className="offer-text">Fine. mine won’t ask about this one again for a month.</p>
              <div className="offer-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setChoice('ask')}>
                  Undo
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
