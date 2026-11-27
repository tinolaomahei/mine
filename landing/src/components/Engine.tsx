import { ringPath } from '../lib/rings'

const LAYERS = [
  { name: 'Agent', note: 'Claude Code, Codex, Gemini CLI, Pi, or whichever agent you already use. Tools, sessions and model calls stay its job.' },
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
            Runs on the agent you already use.
          </h2>
          <p className="body">
            mine doesn’t bring its own agent. It runs the one you already have, whether that’s Claude Code, Codex,
            Gemini CLI, Pi or another, and grows four rings around it. Switch agents whenever something better comes
            along. What mine has learned about you stays with mine, not with the agent.
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
