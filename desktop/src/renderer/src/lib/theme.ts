import { googleFontsUrl, themeCss, type Theme } from '@shared/theme'

// Writes the live theme into the page as CSS variables. Called on start and
// every time theme.json changes, so restyling never needs a rebuild.

function el<T extends HTMLElement>(id: string, make: () => T): T {
  let node = document.getElementById(id) as T | null
  if (!node) {
    node = make()
    node.id = id
    document.head.appendChild(node)
  }
  return node
}

export function applyTheme(theme: Theme) {
  el('mine-theme', () => document.createElement('style')).textContent = themeCss(theme)

  const url = googleFontsUrl(theme.fonts.google)
  const link = el('mine-fonts', () => {
    const l = document.createElement('link')
    l.rel = 'stylesheet'
    return l
  })
  if (url) {
    if (link.href !== url) link.href = url
  } else link.removeAttribute('href')
}
