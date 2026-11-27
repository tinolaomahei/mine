import { useState } from 'react'
import { Rings } from '../lib/rings'

// Everyone's screen is different above ground; underneath, the team shares
// one root system. Public sessions send context down the roots; cloud builds
// root into the shared sandboxes, local builds root into the person's machine.

type PersonId = 'ana' | 'rui' | 'mele' | 'you'
type Where = 'local' | 'cloud'
type Box = [number, number, number, number] // x, y, w, h in 0..1 of the card

const PEOPLE: { id: PersonId; name: string; role: string; ui: Box[]; accent: number }[] = [
  {
    id: 'ana',
    name: 'Ana',
    role: 'design',
    ui: [[0.06, 0.1, 0.6, 0.8], [0.72, 0.1, 0.22, 0.24], [0.72, 0.4, 0.22, 0.24], [0.72, 0.7, 0.22, 0.2]],
    accent: 0,
  },
  {
    id: 'rui',
    name: 'Rui',
    role: 'backend',
    ui: [[0.06, 0.1, 0.88, 0.14], [0.06, 0.32, 0.88, 0.1], [0.06, 0.48, 0.7, 0.1], [0.06, 0.64, 0.88, 0.26]],
    accent: 3,
  },
  {
    id: 'mele',
    name: 'Mele',
    role: 'product',
    ui: [[0.06, 0.1, 0.27, 0.8], [0.37, 0.1, 0.27, 0.55], [0.68, 0.1, 0.26, 0.35], [0.37, 0.72, 0.27, 0.18]],
    accent: 1,
  },
  {
    id: 'you',
    name: 'You',
    role: 'whatever you do',
    ui: [[0.06, 0.1, 0.42, 0.38], [0.52, 0.1, 0.42, 0.38], [0.06, 0.56, 0.88, 0.34]],
    accent: 2,
  },
]

const SESSIONS: Record<PersonId, { title: string; agents: number }> = {
  ana: { title: 'Onboarding flow, second pass', agents: 1 },
  rui: { title: 'Move billing jobs to the new queue', agents: 3 },
  mele: { title: 'Q1 planning notes', agents: 1 },
  you: { title: 'Export timeout fix', agents: 2 },
}

const WHERE: Record<PersonId, Where> = { ana: 'local', rui: 'cloud', mele: 'local', you: 'cloud' }

type Pt = [number, number]
type Geo = {
  w: number
  h: number
  cards: [number, number, number, number][]
  labelGap: number
  rootStart: number
  hubs: { memory: Pt; context: Pt; sessions: Pt; sandboxes: Pt }
  local: Pt[]
  font: number
  hubR: number
}

const WIDE: Geo = {
  w: 1200,
  h: 560,
  cards: [
    [40, 12, 230, 140],
    [343, 12, 230, 140],
    [646, 12, 230, 140],
    [930, 12, 230, 140],
  ],
  labelGap: 26,
  rootStart: 196,
  hubs: { memory: [230, 430], context: [600, 486], sessions: [970, 430], sandboxes: [600, 330] },
  local: [
    [155, 296],
    [458, 296],
    [761, 296],
    [1045, 296],
  ],
  font: 15,
  hubR: 12,
}

const TALL: Geo = {
  w: 400,
  h: 760,
  cards: [
    [16, 10, 176, 112],
    [208, 10, 176, 112],
    [16, 190, 176, 112],
    [208, 190, 176, 112],
  ],
  labelGap: 22,
  rootStart: 340,
  hubs: { memory: [86, 590], context: [200, 700], sessions: [314, 590], sandboxes: [200, 470] },
  local: [
    [60, 420],
    [340, 420],
    [60, 420],
    [340, 420],
  ],
  font: 13,
  hubR: 10,
}

function root(from: Pt, to: Pt) {
  const [x1, y1] = from
  const [x2, y2] = to
  const my = (y1 + y2) / 2
  return `M${x1} ${y1} C${x1} ${my + 20}, ${x2} ${my - 30}, ${x2} ${y2}`
}

function Figure({
  geo,
  isPublic,
  where,
  className,
}: {
  geo: Geo
  isPublic: Record<PersonId, boolean>
  where: Record<PersonId, Where>
  className: string
}) {
  const { hubs } = geo
  const hubList: { key: keyof Geo['hubs']; label: string }[] = [
    { key: 'sandboxes', label: 'sandboxes' },
    { key: 'memory', label: 'team memory' },
    { key: 'context', label: 'shared context' },
    { key: 'sessions', label: 'public sessions' },
  ]

  return (
    <svg viewBox={`0 0 ${geo.w} ${geo.h}`} className={`team-svg ${className}`} aria-hidden="true">
      {/* ground */}
      <line
        x1="0"
        x2={geo.w}
        y1={geo.rootStart + 14}
        y2={geo.rootStart + 14}
        className="ground"
      />

      {/* links between hubs */}
      <path d={root(hubs.memory, hubs.context)} className="link" />
      <path d={root(hubs.sessions, hubs.context)} className="link" />
      <path d={`M${hubs.sandboxes[0]} ${hubs.sandboxes[1]} L${hubs.context[0]} ${hubs.context[1]}`} className="link" />
      <path d={root(hubs.memory, hubs.sandboxes)} className="link" />
      <path d={root(hubs.sessions, hubs.sandboxes)} className="link" />

      {PEOPLE.map((p, i) => {
        const [x, y, w, h] = geo.cards[i]
        const cx = x + w / 2
        // on the tall layout, roots for the top row run down the outside edges
        const start: Pt = geo === TALL ? [i % 2 === 0 ? x + 24 + (i < 2 ? 0 : 24) : x + w - 24 - (i < 2 ? 0 : 24), geo.rootStart] : [cx, geo.rootStart]
        const pub = isPublic[p.id]
        const cloud = where[p.id] === 'cloud'
        const local = geo.local[i]
        return (
          <g key={p.id} className={`person ${pub ? 'is-public' : ''}`}>
            {/* roots */}
            <path d={root(start, hubs.memory)} className="root" />
            <path d={root(start, hubs.context)} className={`root ${pub ? 'is-live' : ''}`} />
            {pub && <path d={root(start, hubs.context)} pathLength={100} className="pulse" style={{ animationDelay: `${i * -0.7}s` }} />}
            {pub && <path d={root(start, hubs.sessions)} className="root is-live" />}
            {pub && <path d={root(start, hubs.sessions)} pathLength={100} className="pulse" style={{ animationDelay: `${i * -0.5 - 0.3}s` }} />}
            {cloud ? (
              <path d={root(start, hubs.sandboxes)} className="root is-build" />
            ) : (
              <>
                <path d={root(start, local)} className="root is-build" />
                <rect
                  x={local[0] - 22}
                  y={local[1] - 2}
                  width="44"
                  height="22"
                  rx="5"
                  className="local-node"
                />
                <text x={local[0]} y={local[1] + 13} className="node-text" style={{ fontSize: geo.font - 4 }}>
                  local
                </text>
              </>
            )}

            {/* the person's own screen */}
            <rect x={x} y={y} width={w} height={h} rx="12" className="card" />
            {p.ui.map(([bx, by, bw, bh], k) => (
              <rect
                key={k}
                x={x + bx * w}
                y={y + by * h}
                width={bw * w}
                height={bh * h}
                rx="5"
                className={k === p.accent ? 'ui ui-accent' : 'ui'}
              />
            ))}
            <text x={x + 2} y={y + h + geo.labelGap} className="who" style={{ fontSize: geo.font }}>
              {p.name}
              <tspan className="role" dx="8" style={{ fontSize: geo.font - 3 }}>
                {cloud ? 'builds in the cloud' : 'builds locally'}
              </tspan>
            </text>
          </g>
        )
      })}

      {hubList.map(({ key, label }, i) => {
        const [hx, hy] = hubs[key]
        return (
          <g key={key} className="hub">
            <Rings cx={hx} cy={hy} from={geo.hubR} step={geo.hubR * 0.55} count={3} seed={50 + i * 7} className="hub-rings" />
            <circle cx={hx} cy={hy} r={geo.hubR * 0.7} className="hub-core" />
            <text x={hx} y={hy + geo.hubR * 2.6 + geo.font} className="hub-text" style={{ fontSize: geo.font - 2 }}>
              {label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export function Team() {
  const [isPublic, setPublic] = useState<Record<PersonId, boolean>>({ ana: true, rui: true, mele: false, you: false })
  const [mine, setMine] = useState<Where>('cloud')
  const where = { ...WHERE, you: mine }
  const publicCount = Object.values(isPublic).filter(Boolean).length

  return (
    <section className="section team on-ink" id="team" aria-labelledby="team-title">
      <div className="team-head">
        <h2 id="team-title" className="h2">
          Everyone gets their own mine. The team shares the roots.
        </h2>
        <div>
          <p className="body">
            In a team, each person still shapes their own screen. Underneath, mine shares what matters: one memory of
            how the team works, one index of context, and sandboxes with agents ready to build.
          </p>
          <p className="body">
            Make an agent session public and every agent on the team can draw on it. The decisions, the code and the
            dead ends all feed shared context, so the next agent starts informed instead of from zero.
          </p>
        </div>
      </div>

      <figure className="team-figure">
        <Figure geo={WIDE} isPublic={isPublic} where={where} className="is-wide" />
        <Figure geo={TALL} isPublic={isPublic} where={where} className="is-tall" />
        <figcaption className="sr-only">
          Four people, each with a different screen, connected underneath to shared team memory, shared context,
          public sessions and sandboxes.
        </figcaption>
      </figure>

      <div className="team-controls">
        <div className="sessions">
          <div className="control-head">
            <h3 className="h3">Agent sessions</h3>
            <p className="mono control-meta">{publicCount} of 4 public, feeding team context</p>
          </div>
          <ul>
            {PEOPLE.map((p) => (
              <li key={p.id} className="session">
                <span className="session-who">{p.name}</span>
                <span className="session-title">{SESSIONS[p.id].title}</span>
                <span className="session-agents mono">
                  {SESSIONS[p.id].agents} {SESSIONS[p.id].agents === 1 ? 'agent' : 'agents'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isPublic[p.id]}
                  className="switch"
                  onClick={() => setPublic((s) => ({ ...s, [p.id]: !s[p.id] }))}
                >
                  <span className="switch-track" aria-hidden="true">
                    <span className="switch-thumb" />
                  </span>
                  <span className="switch-label">{isPublic[p.id] ? 'Public' : 'Private'}</span>
                  <span className="sr-only"> session for {p.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="where">
          <div className="control-head">
            <h3 className="h3">Where your builds run</h3>
            <p className="mono control-meta">your call, per build</p>
          </div>
          <div className="where-options" role="radiogroup" aria-label="Where your builds run">
            {(
              [
                ['local', 'On this machine', 'Your files, your hardware. Nothing leaves unless you share it.'],
                ['cloud', 'In a team sandbox', 'An isolated environment with mine agents ready to go. Close the laptop and it keeps building.'],
              ] as const
            ).map(([value, title, text]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mine === value}
                className="where-option"
                onClick={() => setMine(value)}
              >
                <span className="where-dot" aria-hidden="true" />
                <span className="where-title">{title}</span>
                <span className="where-text">{text}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <dl className="roots-legend">
        <div>
          <dt>Team memory</dt>
          <dd>How the team names things, ships things and decides things. Learned once, used by everyone’s agents.</dd>
        </div>
        <div>
          <dt>Shared context</dt>
          <dd>Docs, tickets, code and past sessions, indexed for retrieval so an agent pulls the right piece when it needs it.</dd>
        </div>
        <div>
          <dt>Sandboxes</dt>
          <dd>Isolated environments with mine agents already in place. Start a build with no setup and throw it away after.</dd>
        </div>
        <div>
          <dt>Public sessions</dt>
          <dd>Agent sessions anyone on the team can open, follow, and reuse as context for their own work.</dd>
        </div>
      </dl>
    </section>
  )
}
