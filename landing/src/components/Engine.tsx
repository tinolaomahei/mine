import { ringPath } from '../lib/rings'

const LAYERS = [
  { name: 'Pi core', note: 'The small, open agent loop mine is forked from. Tools, sessions, model calls.' },
  { name: 'Intent', note: 'A fast first read of every request, so work starts early.' },
  { name: 'Connections', note: 'Every service you use, with its sign-in already known.' },
  { name: 'Memory', note: 'Who you are, what you work on, how you like things done.' },
  { name: 'Workflows', note: 'The repeatable jobs you chose to keep.' },
]

export function Engine() {
  const cx = 180
  const cy = 180
  return (
    <section className="section engine" id="engine" aria-labelledby="engine-title">
      <div className="engine-grid">
        <figure className="engine-figure" aria-hidden="true">
          <svg viewBox="0 0 360 360">
            {LAYERS.map((_, i) => {
              const r = 34 + i * 34
              return (
                <path
                  key={i}
                  d={ringPath(cx, cy, r, 40 + i * 9, 0.03)}
                  className={i === 0 ? 'e-core' : i === LAYERS.length - 1 ? 'e-ring e-outer' : 'e-ring'}
                />
              )
            })}
            {LAYERS.map((l, i) => (
              <text key={l.name} x={cx} y={i === 0 ? cy + 4 : cy - (34 + i * 34) + 15} className={i === 0 ? 'e-label e-label-core' : 'e-label'}>
                {l.name.toLowerCase()}
              </text>
            ))}
          </svg>
        </figure>

        <div className="engine-copy">
          <h2 id="engine-title" className="h2">
            Built on Pi. Runs on whichever model you like.
          </h2>
          <p className="body">
            mine is a fork of Pi, a deliberately small agent harness. We kept the core and grew four rings around it.
            Point it at Claude, at OpenAI, or at a model running on your own machine, and switch when something better
            comes along. What mine has learned about you stays with mine, not with the model.
          </p>
          <dl className="layers">
            {LAYERS.map((l) => (
              <div key={l.name}>
                <dt>{l.name}</dt>
                <dd>{l.note}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  )
}
