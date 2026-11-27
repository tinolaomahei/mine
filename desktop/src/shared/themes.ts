import { resolveTheme, type Theme, type ThemePatch } from './theme'

// The theme marketplace: whole looks for mine. mine ships its own in
// resources/themes; the person's (saved from the current look, or by an agent)
// live in userData/themes. Each file is { name, description, theme }, where
// theme is a patch over Bloom. Themes are only colours, fonts and a radius,
// all validated, so applying one needs no approval.

export const THEME_ID = /^[a-z0-9][a-z0-9-]{0,47}$/

export type ThemeInfo = {
  /** "<name>.native" for mine's own, the file name for the person's. */
  id: string
  name: string
  description: string
  source: 'native' | 'yours'
  patch: ThemePatch
  /** Set when the file is broken; it can't be applied. */
  error?: string
}

/** A file-safe id from a name: "Inugo Blue" → "inugo-blue". */
export const themeSlug = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'theme'

/** Whether two themes look the same (names aside). */
export function sameLook(a: Theme, b: Theme) {
  const look = (t: Theme) => JSON.stringify([t.light, t.dark, t.fonts, t.radius])
  return look(a) === look(b)
}

export const themeOf = (t: ThemeInfo) => resolveTheme({ ...t.patch, name: t.name })
