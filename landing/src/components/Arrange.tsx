import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

// A live 6 × 4 canvas of movable panels. Four ways to change it:
// say it (scripted phrases), point (drag), type (arrow keys), or name a goal.

const COLS = 6
const ROWS = 4

type Rect = { x: number; y: number; w: number; h: number }
type TileId = 'brief' | 'prs' | 'chart' | 'slack' | 'cal' | 'fix' | 'plan' | 'inbox'
type Layout = Partial<Record<TileId, Rect>>

const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h })

const START: Layout = {
  brief: r(0, 0, 2, 2),
  prs: r(2, 0, 2, 2),
  chart: r(4, 0, 2, 2),
  slack: r(0, 2, 3, 2),
  cal: r(3, 2, 3, 2),
}

const SAYINGS: { phrase: string; layout: Layout }[] = [
  {
    phrase: 'Pull requests first, chart beside them.',
    layout: { prs: r(0, 0, 3, 2), chart: r(3, 0, 3, 2), brief: r(0, 2, 2, 2), slack: r(2, 2, 2, 2), cal: r(4, 2, 2, 2) },
  },
  {
    phrase: 'Hide Slack, give today more room.',
    layout: { brief: r(0, 0, 2, 2), prs: r(2, 0, 2, 2), chart: r(4, 0, 2, 2), cal: r(0, 2, 6, 2) },
  },
  {
    phrase: 'Just the brief, and make it big.',
    layout: { brief: r(0, 0, 4, 4), cal: r(4, 0, 2, 4) },
  },
]

const GOALS: { goal: string; layout: Layout }[] = [
  {
    goal: 'Ship the export fix by Friday',
    layout: { fix: r(0, 0, 3, 4), prs: r(3, 0, 3, 2), slack: r(3, 2, 2, 2), cal: r(5, 2, 1, 2) },
  },
  {
    goal: 'Plan next quarter',
    layout: { plan: r(0, 0, 4, 3), chart: r(4, 0, 2, 2), brief: r(4, 2, 2, 2), cal: r(0, 3, 4, 1) },
  },
  {
    goal: 'Get through my inbox',
    layout: { inbox: r(0, 0, 4, 4), cal: r(4, 0, 2, 2), slack: r(4, 2, 2, 2) },
  },
]

const NAMES: Record<TileId, string> = {
  brief: 'Morning brief',
  prs: 'Pull requests',
  chart: 'Bugs this week',
  slack: '#product',
  cal: 'Today',
  fix: 'Export fix',
  plan: 'Next quarter',
  inbox: 'Inbox',
}

function Art({ id }: { id: TileId }): ReactNode {
  switch (id) {
    case 'brief':
      return (
        <svg viewBox="0 0 100 60" className="t-art" preserveAspectRatio="xMinYMin meet" aria-hidden="true">
          {[78, 92, 64, 84, 50].map((w, i) => (
            <rect key={i} x="0" y={i * 12} width={w} height="4" rx="2" className="t-soft" />
          ))}
        </svg>
      )
    case 'prs':
      return (
        <svg viewBox="0 0 100 60" className="t-art" preserveAspectRatio="xMinYMin meet" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <circle cx="5" cy={8 + i * 20} r="4" className={i === 0 ? 't-accent' : 't-line'} />
              <rect x="16" y={6 + i * 20} width={[70, 56, 62][i]} height="4" rx="2" className="t-soft" />
            </g>
          ))}
        </svg>
      )
    case 'chart':
      return (
        <svg viewBox="0 0 100 60" className="t-art" preserveAspectRatio="xMinYMin meet" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => {
            const h = [22, 34, 28, 46, 38, 30, 18][i]
            return <rect key={i} x={i * 14} y={58 - h} width="9" height={h} rx="2" className={i === 3 ? 't-accent' : 't-soft'} />
          })}
        </svg>
      )
    case 'slack':
      return (
        <svg viewBox="0 0 100 60" className="t-art" preserveAspectRatio="xMinYMin meet" aria-hidden="true">
          <rect x="0" y="2" width="58" height="13" rx="6" className="t-soft" />
          <rect x="30" y="22" width="70" height="13" rx="6" className="t-accent" />
          <rect x="0" y="42" width="44" height="13" rx="6" className="t-soft" />
        </svg>
      )
    case 'cal':
      return (
        <svg viewBox="0 0 100 60" className="t-art" preserveAspectRatio="xMinYMin meet" aria-hidden="true">
          <rect x="0" y="0" width="100" height="14" rx="3" className="t-soft" />
          <rect x="0" y="20" width="100" height="22" rx="3" className="t-accent" />
          <rect x="0" y="48" width="100" height="10" rx="3" className="t-soft" />
        </svg>
      )
    case 'fix':
      return (
        <svg viewBox="0 0 100 60" className="t-art" preserveAspectRatio="xMinYMin meet" aria-hidden="true">
          {['Reproduce', 'Patch', 'Review', 'Release'].map((_, i) => (
            <g key={i}>
              <circle cx="5" cy={6 + i * 15} r="4" className={i < 2 ? 't-accent' : 't-line'} />
              <rect x="16" y={4 + i * 15} width={[50, 38, 44, 54][i]} height="4" rx="2" className="t-soft" />
            </g>
          ))}
        </svg>
      )
    case 'plan':
      return (
        <svg viewBox="0 0 100 60" className="t-art" preserveAspectRatio="xMinYMin meet" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <rect key={i} x={i * 34} y="0" width="30" height="60" rx="4" className="t-line" />
          ))}
          <rect x="3" y="4" width="24" height="12" rx="3" className="t-accent" />
          <rect x="37" y="4" width="24" height="12" rx="3" className="t-soft" />
          <rect x="37" y="20" width="24" height="12" rx="3" className="t-soft" />
          <rect x="71" y="4" width="24" height="12" rx="3" className="t-soft" />
        </svg>
      )
    case 'inbox':
      return (
        <svg viewBox="0 0 100 60" className="t-art" preserveAspectRatio="xMinYMin meet" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i}>
              <rect x="0" y={i * 12} width="10" height="7" rx="2" className={i < 2 ? 't-line' : 't-accent'} />
              <rect x="16" y={i * 12 + 1.5} width={[60, 72, 50, 66, 44][i]} height="4" rx="2" className={i < 2 ? 't-faint' : 't-soft'} />
            </g>
          ))}
        </svg>
      )
  }
}

type Mode = 'say' | 'point' | 'type'

function MicGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="glyph">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v4" />
    </svg>
  )
}
function PointerGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="glyph">
      <path d="M6 3l12 7.5-5.2 1.3L10 17z" />
    </svg>
  )
}
function KeyGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="glyph">
      <rect x="3" y="6" width="18" height="12" rx="3" />
      <path d="M7 14h10M7 10h1M11 10h1M15 10h2" />
    </svg>
  )
}

export function Arrange() {
  const [layout, setLayout] = useState<Layout>(START)
  const [mode, setMode] = useState<Mode>('say')
  const [status, setStatus] = useState('Drag a panel, use the keyboard, or pick something to say.')
  const [hearing, setHearing] = useState<string | null>(null)
  const [activeGoal, setActiveGoal] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ id: TileId; dx: number; dy: number } | null>(null)
  const canvas = useRef<HTMLDivElement | null>(null)
  const start = useRef({ px: 0, py: 0 })
  const sayTimer = useRef<number | undefined>(undefined)

  const ids = Object.keys(layout) as TileId[]

  function place(id: TileId, next: Rect) {
    const clamped = {
      w: Math.max(1, Math.min(COLS, next.w)),
      h: Math.max(1, Math.min(ROWS, next.h)),
      x: 0,
      y: 0,
    }
    clamped.x = Math.max(0, Math.min(COLS - clamped.w, next.x))
    clamped.y = Math.max(0, Math.min(ROWS - clamped.h, next.y))
    setLayout((l) => {
      const prev = l[id]!
      const out: Layout = { ...l, [id]: clamped }
      // If the panel lands on another one's corner, they trade places.
      const other = (Object.keys(l) as TileId[]).find((k) => k !== id && l[k]!.x === clamped.x && l[k]!.y === clamped.y)
      if (other) {
        const o = l[other]!
        out[other] = {
          ...o,
          x: Math.max(0, Math.min(COLS - o.w, prev.x)),
          y: Math.max(0, Math.min(ROWS - o.h, prev.y)),
        }
      }
      return out
    })
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>, id: TileId) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { px: e.clientX, py: e.clientY }
    setDrag({ id, dx: 0, dy: 0 })
    setMode('point')
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!drag) return
    setDrag({ ...drag, dx: e.clientX - start.current.px, dy: e.clientY - start.current.py })
  }

  function onPointerUp() {
    if (!drag || !canvas.current) return
    const box = canvas.current.getBoundingClientRect()
    const rect = layout[drag.id]!
    const nx = rect.x + Math.round(drag.dx / (box.width / COLS))
    const ny = rect.y + Math.round(drag.dy / (box.height / ROWS))
    setDrag(null)
    if (nx !== rect.x || ny !== rect.y) {
      place(drag.id, { ...rect, x: nx, y: ny })
      setStatus(`Moved ${NAMES[drag.id]}.`)
      setActiveGoal(null)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>, id: TileId) {
    const rect = layout[id]!
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    const d = step[e.key]
    if (!d) return
    e.preventDefault()
    setMode('type')
    setActiveGoal(null)
    if (e.shiftKey) {
      place(id, { ...rect, w: rect.w + d[0], h: rect.h + d[1] })
      setStatus(`Resized ${NAMES[id]}.`)
    } else {
      place(id, { ...rect, x: rect.x + d[0], y: rect.y + d[1] })
      setStatus(`Moved ${NAMES[id]}.`)
    }
  }

  function say(i: number) {
    window.clearTimeout(sayTimer.current)
    setHearing(SAYINGS[i].phrase)
    setActiveGoal(null)
    sayTimer.current = window.setTimeout(() => {
      setLayout(SAYINGS[i].layout)
      setStatus(`Heard: “${SAYINGS[i].phrase}”`)
      setHearing(null)
    }, 700)
  }

  function goal(i: number) {
    setLayout(GOALS[i].layout)
    setActiveGoal(GOALS[i].goal)
    setStatus(`Laid out for: ${GOALS[i].goal}.`)
  }

  function reset() {
    setLayout(START)
    setActiveGoal(null)
    setStatus('Back to where you started.')
  }

  return (
    <section className="section arrange" id="arrange" aria-labelledby="arrange-title">
      <div className="arrange-grid">
        <div className="arrange-copy">
          <h2 id="arrange-title" className="h2">
            Nothing on screen is fixed.
          </h2>
          <p className="body">
            Every panel in mine is a piece you can move. Drag it, nudge it from the keyboard, or say where it should
            go. Or skip the arranging: tell mine what you’re trying to get done, and it lays the screen out for that.
          </p>
          <p className="body">If the panel you want doesn’t exist yet, describe it. mine will make it.</p>

          <ol className="flow" aria-label="Ways to change the screen">
            <li>
              <MicGlyph />
              <span>Say it</span>
            </li>
            <li>
              <PointerGlyph />
              <span>Point at it</span>
            </li>
            <li>
              <KeyGlyph />
              <span>Type it</span>
            </li>
            <li className="flow-goal">
              <span className="goal-mark" aria-hidden="true" />
              <span>Or just name the goal</span>
            </li>
          </ol>
        </div>

        <div className="arrange-demo">
          <div className="modes" role="radiogroup" aria-label="Input">
            {(
              [
                ['say', 'Say', <MicGlyph key="m" />],
                ['point', 'Point', <PointerGlyph key="p" />],
                ['type', 'Type', <KeyGlyph key="k" />],
              ] as const
            ).map(([m, label, icon]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                className="mode"
                onClick={() => setMode(m)}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>

          <div className="mode-panel">
            {mode === 'say' && (
              <div className="sayings">
                {SAYINGS.map((s, i) => (
                  <button key={s.phrase} type="button" className="saying" onClick={() => say(i)} disabled={hearing !== null}>
                    “{s.phrase}”
                  </button>
                ))}
              </div>
            )}
            {mode === 'point' && <p className="mode-hint">Drag any panel. It snaps to the grid and swaps places with whatever it lands on.</p>}
            {mode === 'type' && (
              <p className="mode-hint">
                Tab to a panel. <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> move it, add <kbd>Shift</kbd> to resize.
              </p>
            )}
          </div>

          <div
            ref={canvas}
            className={`canvas ${hearing ? 'is-hearing' : ''}`}
            role="application"
            aria-label="Arrangeable workspace preview"
            aria-roledescription="workspace"
          >
            {ids.map((id) => {
              const t = layout[id]!
              const dragging = drag?.id === id
              return (
                <div
                  key={id}
                  className={`tile ${dragging ? 'is-dragging' : ''} ${id === 'fix' || id === 'plan' || id === 'inbox' ? 'is-goal' : ''}`}
                  style={{
                    ['--x' as string]: t.x,
                    ['--y' as string]: t.y,
                    ['--w' as string]: t.w,
                    ['--h' as string]: t.h,
                    ['--dx' as string]: `${dragging ? drag.dx : 0}px`,
                    ['--dy' as string]: `${dragging ? drag.dy : 0}px`,
                  }}
                  tabIndex={0}
                  aria-label={`${NAMES[id]}, column ${t.x + 1}, row ${t.y + 1}, ${t.w} by ${t.h}`}
                  onPointerDown={(e) => onPointerDown(e, id)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={() => setDrag(null)}
                  onKeyDown={(e) => onKeyDown(e, id)}
                >
                  <div className="tile-card">
                    <span className="tile-name mono">{NAMES[id]}</span>
                    <Art id={id} />
                  </div>
                </div>
              )
            })}
            {hearing && (
              <p className="hearing" aria-hidden="true">
                <span className="hearing-dot" /> {hearing}
              </p>
            )}
          </div>

          <p className="arrange-status" aria-live="polite">
            {status}
          </p>

          <div className="goals">
            <p className="goals-label">
              <span className="goal-mark" aria-hidden="true" /> Goal
            </p>
            <div className="goal-list">
              {GOALS.map((g, i) => (
                <button
                  key={g.goal}
                  type="button"
                  className="goal"
                  aria-pressed={activeGoal === g.goal}
                  onClick={() => goal(i)}
                >
                  {g.goal}
                </button>
              ))}
              <button type="button" className="goal goal-reset" onClick={reset}>
                Reset
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
