// Just enough colour science to validate what an agent proposes: parse the CSS
// colour forms we accept, convert to sRGB, and measure WCAG contrast.

export type RGB = { r: number; g: number; b: number } // gamma-encoded sRGB, 0..1

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

function num(s: string, scale: number) {
  const t = s.trim()
  if (t.endsWith('%')) return (parseFloat(t) / 100) * scale
  return parseFloat(t)
}

function hue(s: string) {
  const t = s.trim().toLowerCase()
  if (t.endsWith('turn')) return parseFloat(t) * 360
  if (t.endsWith('rad')) return (parseFloat(t) * 180) / Math.PI
  return parseFloat(t)
}

function args(body: string) {
  // drop any alpha after "/" and split on commas or spaces
  return body.split('/')[0].trim().split(/[\s,]+/).filter(Boolean)
}

function oklchToRgb(L: number, C: number, H: number): RGB {
  const a = C * Math.cos((H * Math.PI) / 180)
  const b = C * Math.sin((H * Math.PI) / 180)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  const enc = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055)
  return { r: clamp01(enc(lin[0])), g: clamp01(enc(lin[1])), b: clamp01(enc(lin[2])) }
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return { r: clamp01(f(0)), g: clamp01(f(8)), b: clamp01(f(4)) }
}

/** Parse #hex, rgb(), hsl() or oklch(). Returns undefined for anything else. */
export function parseColor(input: string): RGB | undefined {
  const s = input.trim().toLowerCase()
  let m = s.match(/^#([0-9a-f]{3,8})$/)
  if (m) {
    let h = m[1]
    if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join('')
    if (h.length !== 6 && h.length !== 8) return undefined
    return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 }
  }
  m = s.match(/^rgba?\((.+)\)$/)
  if (m) {
    const [r, g, b] = args(m[1])
    if (b === undefined) return undefined
    const v = [r, g, b].map((x) => (x.endsWith('%') ? num(x, 1) : parseFloat(x) / 255))
    return v.some(Number.isNaN) ? undefined : { r: clamp01(v[0]), g: clamp01(v[1]), b: clamp01(v[2]) }
  }
  m = s.match(/^hsla?\((.+)\)$/)
  if (m) {
    const [h, sat, l] = args(m[1])
    if (l === undefined) return undefined
    const v = [hue(h), num(sat, 1), num(l, 1)]
    return v.some(Number.isNaN) ? undefined : hslToRgb(((v[0] % 360) + 360) % 360, clamp01(v[1]), clamp01(v[2]))
  }
  m = s.match(/^oklch\((.+)\)$/)
  if (m) {
    const [l, c, h] = args(m[1])
    if (h === undefined) return undefined
    const L = num(l, 1)
    const C = c.endsWith('%') ? num(c, 0.4) : parseFloat(c)
    const H = h === 'none' ? 0 : hue(h)
    return [L, C, H].some(Number.isNaN) ? undefined : oklchToRgb(L, C, H)
  }
  return undefined
}

export function toHex({ r, g, b }: RGB) {
  return '#' + [r, g, b].map((x) => Math.round(clamp01(x) * 255).toString(16).padStart(2, '0')).join('')
}

function luminance({ r, g, b }: RGB) {
  const lin = (x: number) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function contrast(a: RGB, b: RGB) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
