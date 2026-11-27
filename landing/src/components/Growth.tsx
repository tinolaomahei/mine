import type { ReactNode } from 'react'
import { Rings } from '../lib/rings'
import { useInView } from '../lib/useInView'

function Frame({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 240 180" className="g-svg" aria-hidden="true">
      <rect x="1" y="1" width="238" height="178" rx="14" className="g-frame" />
      {children}
    </svg>
  )
}

function Mic({ x, y, r = 7 }: { x: number; y: number; r?: number }) {
  return <circle cx={x} cy={y} r={r} className="g-ink" />
}

function Lines({ x, y, widths, gap = 9 }: { x: number; y: number; widths: number[]; gap?: number }) {
  return (
    <>
      {widths.map((w, i) => (
        <rect key={i} x={x} y={y + i * gap} width={w} height="3" rx="1.5" className="g-soft" />
      ))}
    </>
  )
}

const PANELS = [
  {
    when: 'Day 1',
    title: 'A button.',
    text: 'You talk, it listens. There is nothing else on screen.',
    art: (
      <Frame>
        <Rings cx={120} cy={90} from={16} step={11} count={3} seed={3} className="g-rings" />
        <Mic x={120} y={90} r={9} />
      </Frame>
    ),
  },
  {
    when: 'Week 1',
    title: 'Your tools, listed.',
    text: 'Everything you mentioned, waiting for a sign-in.',
    art: (
      <Frame>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <g key={i}>
            <circle cx={36} cy={34 + i * 18} r={5} className={i < 4 ? 'g-accent-fill' : 'g-line'} />
            <rect x={50} y={32 + i * 18} width={[70, 54, 62, 48, 76, 40][i]} height="4" rx="2" className="g-soft" />
            <rect x={168} y={30 + i * 18} width={38} height="8" rx="4" className={i < 4 ? 'g-soft' : 'g-line'} />
          </g>
        ))}
        <Mic x={120} y={162} r={6} />
      </Frame>
    ),
  },
  {
    when: 'Month 1',
    title: 'Habits, saved.',
    text: 'Three workflows and a short morning brief.',
    art: (
      <Frame>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <rect key={i} x={16} y={20 + i * 20} width={12} height={12} rx={3} className="g-soft" />
        ))}
        <Lines x={44} y={24} widths={[96, 110, 88, 104, 60]} />
        {[0, 1, 2].map((i) => (
          <rect key={i} x={164} y={20 + i * 24} width={60} height={16} rx={8} className={i === 0 ? 'g-accent-fill' : 'g-line'} />
        ))}
        <rect x={44} y={86} width={180} height={52} rx={8} className="g-line" />
        <polyline points="54,126 80,112 104,118 132,100 160,106 188,94 214,98" className="g-stroke" />
        <Mic x={120} y={162} r={6} />
      </Frame>
    ),
  },
  {
    when: 'Month 6',
    title: 'Yours.',
    text: 'A workspace shaped by how you actually work.',
    art: (
      <Frame>
        <rect x={14} y={16} width={64} height={70} rx={8} className="g-accent-fill" />
        <Lines x={22} y={28} widths={[40, 46, 30]} gap={8} />
        <rect x={86} y={16} width={140} height={70} rx={8} className="g-line" />
        <polyline points="94,72 114,58 134,64 154,40 174,48 194,30 216,36" className="g-stroke" />
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={14 + i * 54} y={96} width={48} height={16} rx={8} className={i === 1 ? 'g-ink-fill' : 'g-soft'} />
        ))}
        <rect x={14} y={120} width={102} height={44} rx={8} className="g-line" />
        <Lines x={22} y={130} widths={[70, 82, 50]} gap={9} />
        <rect x={124} y={120} width={70} height={44} rx={8} className="g-line" />
        <Lines x={132} y={130} widths={[44, 52, 30]} gap={9} />
        <Rings cx={212} cy={142} from={9} step={4} count={4} seed={21} className="g-rings" />
        <Mic x={212} y={142} r={5} />
      </Frame>
    ),
  },
]

export function Growth() {
  const [ref, inView] = useInView<HTMLOListElement>(0.2)
  return (
    <section className="section growth" id="grows" aria-labelledby="growth-title">
      <div className="growth-head">
        <h2 id="growth-title" className="h2">
          The interface grows to fit you.
        </h2>
        <p className="body">
          mine doesn’t ship with a dashboard you have to learn. It adds screens when you need them, and only the ones
          you need. Two people using it for six months end up with two different apps.
        </p>
      </div>
      <ol ref={ref} className={`growth-row ${inView ? 'is-in' : ''}`}>
        {PANELS.map((p, i) => (
          <li key={p.when} className="growth-panel" style={{ ['--p' as string]: i }}>
            {p.art}
            <p className="growth-when mono">{p.when}</p>
            <h3 className="h3">{p.title}</h3>
            <p className="growth-text">{p.text}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
