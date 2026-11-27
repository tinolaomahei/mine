import { contrast, parseColor } from './color'

// mine's look is data. A theme is a set of named colour tokens for light and
// dark, plus fonts and corner radius. The app turns it into CSS variables at
// runtime, so an agent can restyle the whole app live by editing it.

/** Every themeable colour, the CSS variable it drives, and what it paints. */
export const TOKENS = {
  background: { css: 'paper', doc: 'Window background behind everything.' },
  surface: { css: 'surface', doc: 'Raised panels: harness cards, the text box, menus, popovers.' },
  subtle: { css: 'paper-2', doc: 'Quiet fills: tool chips, table headers, inline code, hover states.' },
  'subtle-strong': { css: 'paper-3', doc: 'Stronger quiet fill: disabled send button, download progress track.' },
  border: { css: 'rule', doc: 'Hairlines, borders and the idle growth rings around the mic.' },
  text: { css: 'ink', doc: 'Primary text and headings.' },
  'text-muted': { css: 'muted-ink', doc: 'Secondary paragraphs and descriptions.' },
  'text-subtle': { css: 'neutral', doc: 'Small labels, hints, placeholders, timestamps. Keep it readable.' },
  solid: { css: 'solid', doc: 'Strong fill: primary buttons, your message bubbles, the idle mic button.' },
  'solid-hover': { css: 'solid-hover', doc: 'Hover state of solid.' },
  'solid-border': { css: 'solid-rule', doc: 'Lines drawn on top of solid.' },
  'on-solid': { css: 'on-solid', doc: 'Text and icons on solid.' },
  'on-solid-muted': { css: 'on-solid-muted', doc: 'Secondary text on solid.' },
  accent: { css: 'bloom', doc: 'Brand accent as a fill: mic while listening, send button, badges, text selection.' },
  'on-accent': { css: 'on-bloom', doc: 'Text and icons on accent.' },
  'accent-strong': {
    css: 'bloom-deep',
    doc: 'Accent as text and lines: links, the logo dot, list bullets, listening rings, focused text box border.',
  },
  'accent-wash': { css: 'bloom-wash', doc: 'Faint accent tint: hover fills, the glow around the focused text box.' },
  danger: { css: 'signal', doc: 'Errors.' },
  focus: { css: 'focus', doc: 'Keyboard focus outline.' },
  'code-background': { css: 'code-bg', doc: 'Code block background in replies.' },
  'code-text': { css: 'code-fg', doc: 'Code block text.' },
} as const

export type TokenName = keyof typeof TOKENS
export const TOKEN_NAMES = Object.keys(TOKENS) as TokenName[]
export type Palette = Record<TokenName, string>

export type Fonts = {
  /** CSS font-family for big headings and the wordmark. Expressive faces belong here. */
  display: string
  /** CSS font-family for the interface: buttons, labels, menus, your message bubbles. */
  ui: string
  /** CSS font-family for reading text: agent replies, descriptions. */
  body: string
  /** CSS font-family for labels and code. */
  mono: string
  /** Google Fonts css2 family specs to load, e.g. "Inter:wght@400;600". */
  google: string[]
}

export type Theme = {
  name: string
  light: Palette
  dark: Palette
  fonts: Fonts
  /** Base corner radius, e.g. "0.875rem" or "6px". */
  radius: string
}

/** What gets stored: only what differs from the base theme needs to be there. */
export type ThemePatch = {
  name?: string
  light?: Partial<Palette>
  dark?: Partial<Palette>
  fonts?: Partial<Fonts>
  radius?: string
}

/** mine's own Bloom: blush paper, plum ink, bubblegum accent. */
export const BLOOM: Theme = {
  name: 'Bloom',
  light: {
    background: 'oklch(97% 0.014 350)',
    surface: 'oklch(99% 0.007 350)',
    subtle: 'oklch(94% 0.022 350)',
    'subtle-strong': 'oklch(90% 0.03 350)',
    border: 'oklch(86% 0.028 350)',
    text: 'oklch(22% 0.045 330)',
    'text-muted': 'oklch(38% 0.045 335)',
    'text-subtle': 'oklch(50% 0.04 340)',
    solid: 'oklch(23% 0.05 330)',
    'solid-hover': 'oklch(32% 0.06 330)',
    'solid-border': 'oklch(38% 0.05 332)',
    'on-solid': 'oklch(96% 0.014 350)',
    'on-solid-muted': 'oklch(80% 0.04 345)',
    accent: 'oklch(81% 0.14 352)',
    'on-accent': 'oklch(20% 0.045 330)',
    'accent-strong': 'oklch(52% 0.19 355)',
    'accent-wash': 'oklch(92% 0.05 352)',
    danger: 'oklch(55% 0.17 28)',
    focus: 'oklch(45% 0.15 260)',
    'code-background': 'oklch(23% 0.05 330)',
    'code-text': 'oklch(96% 0.014 350)',
  },
  dark: {
    background: 'oklch(17% 0.007 345)',
    surface: 'oklch(20.5% 0.008 345)',
    subtle: 'oklch(23.5% 0.009 345)',
    'subtle-strong': 'oklch(29% 0.011 345)',
    border: 'oklch(32% 0.01 345)',
    text: 'oklch(95% 0.008 350)',
    'text-muted': 'oklch(80% 0.01 345)',
    'text-subtle': 'oklch(68% 0.012 345)',
    solid: 'oklch(30% 0.012 345)',
    'solid-hover': 'oklch(36% 0.014 345)',
    'solid-border': 'oklch(42% 0.014 345)',
    'on-solid': 'oklch(96% 0.008 350)',
    'on-solid-muted': 'oklch(80% 0.012 345)',
    accent: 'oklch(80% 0.14 352)',
    'on-accent': 'oklch(20% 0.03 340)',
    'accent-strong': 'oklch(76% 0.15 355)',
    'accent-wash': 'oklch(27% 0.04 352)',
    danger: 'oklch(72% 0.15 28)',
    focus: 'oklch(74% 0.12 260)',
    'code-background': 'oklch(13% 0.005 345)',
    'code-text': 'oklch(94% 0.008 350)',
  },
  fonts: {
    display: "'Familjen Grotesk Variable', ui-sans-serif, system-ui, sans-serif",
    ui: "'Familjen Grotesk Variable', ui-sans-serif, system-ui, sans-serif",
    body: "'Newsreader Variable', ui-serif, Georgia, serif",
    mono: "'Martian Mono Variable', ui-monospace, monospace",
    google: [],
  },
  radius: '0.875rem',
}

/** Layer a patch over the base theme. */
export function resolveTheme(patch: ThemePatch | undefined, base: Theme = BLOOM): Theme {
  return {
    name: patch?.name ?? base.name,
    light: { ...base.light, ...patch?.light },
    dark: { ...base.dark, ...patch?.dark },
    fonts: { ...base.fonts, ...patch?.fonts, google: patch?.fonts?.google ?? base.fonts.google },
    radius: patch?.radius ?? base.radius,
  }
}

/** Merge a new patch onto an existing one (later wins, per token). */
export function mergePatch(a: ThemePatch, b: ThemePatch): ThemePatch {
  return {
    name: b.name ?? a.name,
    light: { ...a.light, ...b.light },
    dark: { ...a.dark, ...b.dark },
    fonts: { ...a.fonts, ...b.fonts },
    radius: b.radius ?? a.radius,
  }
}

const SAFE_FONT = /^[\w\s'",.\-()]+$/
const SAFE_GOOGLE = /^[A-Za-z0-9 +:;@,.]+$/
const SAFE_RADIUS = /^\d+(\.\d+)?(px|rem|em)$/

/** Every problem with a patch. Empty means it is safe to apply. */
export function validatePatch(patch: unknown): string[] {
  const errors: string[] = []
  if (!patch || typeof patch !== 'object') return ['Theme must be an object.']
  const p = patch as Record<string, unknown>
  for (const key of Object.keys(p)) {
    if (!['name', 'light', 'dark', 'fonts', 'radius'].includes(key)) errors.push(`Unknown field "${key}".`)
  }
  if (p.name !== undefined && (typeof p.name !== 'string' || p.name.length > 60)) errors.push('name must be a short string.')
  for (const mode of ['light', 'dark'] as const) {
    const pal = p[mode]
    if (pal === undefined) continue
    if (!pal || typeof pal !== 'object') {
      errors.push(`${mode} must be an object of token: colour.`)
      continue
    }
    for (const [token, value] of Object.entries(pal)) {
      if (!(token in TOKENS)) errors.push(`${mode}.${token} is not a token. Tokens: ${TOKEN_NAMES.join(', ')}.`)
      else if (typeof value !== 'string' || !parseColor(value))
        errors.push(`${mode}.${token} = ${JSON.stringify(value)} is not a colour. Use #hex, rgb(), hsl() or oklch().`)
    }
  }
  if (p.fonts !== undefined) {
    const f = p.fonts as Record<string, unknown>
    if (!f || typeof f !== 'object') errors.push('fonts must be an object.')
    else
      for (const [k, v] of Object.entries(f)) {
        if (k === 'google') {
          if (!Array.isArray(v) || v.some((s) => typeof s !== 'string' || !SAFE_GOOGLE.test(s)))
            errors.push('fonts.google must be a list of Google Fonts family specs like "Inter:wght@400;600".')
        } else if (!['display', 'ui', 'body', 'mono'].includes(k))
          errors.push(`fonts.${k} is not a font role (display, ui, body, mono).`)
        else if (typeof v !== 'string' || !SAFE_FONT.test(v)) errors.push(`fonts.${k} must be a CSS font-family list.`)
      }
  }
  if (p.radius !== undefined && (typeof p.radius !== 'string' || !SAFE_RADIUS.test(p.radius)))
    errors.push('radius must look like "0.75rem" or "8px".')
  return errors
}

/** The CSS the window applies. Values are validated before they get here. */
export function themeCss(t: Theme): string {
  const vars = (pal: Palette) => TOKEN_NAMES.map((n) => `  --${TOKENS[n].css}: ${pal[n]};`).join('\n')
  return `:root {
${vars(t.light)}
  --radius: ${t.radius};
  --brand-font-display: ${t.fonts.display};
  --brand-font-ui: ${t.fonts.ui};
  --brand-font-body: ${t.fonts.body};
  --brand-font-mono: ${t.fonts.mono};
}
@media (prefers-color-scheme: dark) {
  :root {
${vars(t.dark)}
  }
}
`
}

export function googleFontsUrl(specs: string[]) {
  if (!specs.length) return undefined
  return `https://fonts.googleapis.com/css2?${specs.map((s) => 'family=' + s.trim().replace(/ /g, '+')).join('&')}&display=swap`
}

/** Pairs that must read well, with the bar each has to clear. */
const PAIRS: [fg: TokenName, bg: TokenName, min: number, what: string][] = [
  ['text', 'background', 7, 'body text'],
  ['text', 'surface', 7, 'text on cards'],
  ['text-muted', 'background', 4.5, 'secondary text'],
  ['text-subtle', 'background', 4.5, 'small labels'],
  ['text-subtle', 'surface', 4.5, 'hints in the text box'],
  ['on-solid', 'solid', 4.5, 'buttons and your bubbles'],
  ['on-accent', 'accent', 4.5, 'send button and badges'],
  ['accent-strong', 'background', 4.5, 'links'],
  ['accent-strong', 'surface', 3, 'focused text box border'],
  ['danger', 'background', 4.5, 'errors'],
  ['focus', 'background', 3, 'focus outline'],
  ['code-text', 'code-background', 7, 'code blocks'],
  ['border', 'background', 1.3, 'borders visible at all'],
]

export type ContrastRow = { mode: 'light' | 'dark'; fg: TokenName; bg: TokenName; ratio: number; min: number; ok: boolean; what: string }

export function contrastReport(t: Theme): ContrastRow[] {
  const rows: ContrastRow[] = []
  for (const mode of ['light', 'dark'] as const) {
    for (const [fg, bg, min, what] of PAIRS) {
      const a = parseColor(t[mode][fg])
      const b = parseColor(t[mode][bg])
      if (!a || !b) continue
      const ratio = Math.round(contrast(a, b) * 100) / 100
      rows.push({ mode, fg, bg, ratio, min, ok: ratio >= min, what })
    }
  }
  return rows
}
