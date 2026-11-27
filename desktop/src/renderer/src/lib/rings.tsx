// Growth rings: the visual language of mine. Each ring is a slightly
// irregular closed loop, like a tree ring, built from a few low-frequency
// sine waves so it reads hand-made rather than geometric.

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function ringPath(cx: number, cy: number, r: number, seed: number, wobble = 0.035, steps = 120) {
  const rand = mulberry32(seed)
  const waves = [2, 3, 5].map((freq) => ({ freq, phase: rand() * Math.PI * 2, amp: (0.4 + rand() * 0.6) / freq }))
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2
    const k = waves.reduce((acc, w) => acc + Math.sin(t * w.freq + w.phase) * w.amp, 0)
    const rr = r * (1 + k * wobble)
    const x = cx + Math.cos(t) * rr
    const y = cy + Math.sin(t) * rr
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
  }
  return d + 'Z'
}

type RingsProps = {
  cx: number
  cy: number
  from: number
  step: number
  count: number
  seed?: number
  wobble?: number
  className?: string
  ringClass?: (i: number) => string | undefined
}

export function Rings({ cx, cy, from, step, count, seed = 7, wobble = 0.035, className, ringClass }: RingsProps) {
  return (
    <g className={className}>
      {Array.from({ length: count }, (_, i) => (
        <path
          key={i}
          d={ringPath(cx, cy, from + i * step, seed + i * 13, wobble * (1 + i * 0.08))}
          className={ringClass?.(i)}
          style={{ ['--i' as string]: i }}
        />
      ))}
    </g>
  )
}
