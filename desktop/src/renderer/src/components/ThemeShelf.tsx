import { useEffect, useState, type CSSProperties } from 'react'
import { Check, Mic, Plus, X } from 'lucide-react'
import { googleFontsUrl, TOKEN_NAMES, TOKENS, type Palette, type Theme } from '@shared/theme'
import { sameLook, themeOf, type ThemeInfo } from '@shared/themes'

// Themes in the marketplace. Each card is a small live mock of mine drawn in
// that theme (light and dark side by side) by setting its variables on the
// card, so what you see is exactly what you'd get.

/** The CSS variables a theme sets, for one mode, scoped to an element. */
function vars(t: Theme, pal: Palette): CSSProperties {
  const v: Record<string, string> = {}
  for (const n of TOKEN_NAMES) v[`--${TOKENS[n].css}`] = pal[n]
  v['--radius'] = t.radius
  v['--brand-font-display'] = t.fonts.display
  v['--brand-font-ui'] = t.fonts.ui
  v['--brand-font-body'] = t.fonts.body
  v['--brand-font-mono'] = t.fonts.mono
  return v as CSSProperties
}

/** Load a theme's Google fonts once, so its preview shows the real faces. */
function useFonts(t: Theme) {
  const url = googleFontsUrl(t.fonts.google)
  useEffect(() => {
    if (!url || document.querySelector(`link[data-preview-font="${CSS.escape(url)}"]`)) return
    const l = document.createElement('link')
    l.rel = 'stylesheet'
    l.href = url
    l.dataset.previewFont = url
    document.head.appendChild(l)
  }, [url])
}

const family = (stack: string) => stack.split(',')[0].replace(/['"]/g, '').replace(/ Variable$/, '').trim()

function Mock({ t, mode }: { t: Theme; mode: 'light' | 'dark' }) {
  return (
    <div style={vars(t, t[mode])} className="flex min-w-0 flex-1 flex-col gap-2 bg-paper p-3 font-sans text-ink" aria-hidden="true">
      <div className="flex items-center gap-1.5">
        <span className="font-display text-[13px] leading-none font-semibold">
          m<span className="text-bloom-deep">.</span>
        </span>
        <span className="ml-1 h-3.5 w-10 rounded-full border border-rule bg-surface" />
        <span className="ml-auto font-mono text-[7.5px] text-neutral uppercase">{mode}</span>
      </div>
      <p className="font-display text-[15px] leading-tight font-semibold tracking-[-0.02em]">Start with nothing.</p>
      <p className="self-end rounded-[calc(var(--radius)*0.7)] rounded-br-sm bg-solid px-2 py-1 text-[9px] leading-snug text-on-solid">Make it calmer</p>
      <div className="font-serif text-[9.5px] leading-snug">
        <p>Softer paper, quieter accent.</p>
        <p className="text-[var(--muted-ink)]">Light and dark both pass.</p>
      </div>
      <div className="mt-auto flex items-center gap-1.5">
        <span className="rounded-full bg-paper-2 px-1.5 py-0.5 font-mono text-[7.5px] text-neutral">set_theme</span>
        <span className="ml-auto grid size-5 place-items-center rounded-full bg-solid text-bloom">
          <Mic className="size-2.5" strokeWidth={2.2} />
        </span>
        <span className="rounded-full bg-bloom px-2 py-0.5 text-[8.5px] font-semibold text-on-bloom">Send</span>
      </div>
    </div>
  )
}

function ThemeCard({ info, current, onApply, onRemove }: { info: ThemeInfo; current: boolean; onApply: () => void; onRemove?: () => void }) {
  const t = themeOf(info)
  useFonts(t)
  const [confirm, setConfirm] = useState(false)
  const swatches = (['background', 'surface', 'solid', 'accent', 'accent-strong', 'text'] as const).map((k) => t.light[k])

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-rule bg-surface" aria-label={`${info.name} theme`}>
      <div className="flex h-[11.5rem] border-b border-rule/60">
        <Mock t={t} mode="light" />
        <Mock t={t} mode="dark" />
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="truncate font-display text-[1.125rem] font-semibold tracking-[-0.02em]">{info.name}</h3>
          <span className="shrink-0 font-mono text-[10px] text-neutral uppercase">{info.source === 'native' ? 'mine' : 'yours'}</span>
        </div>
        {info.error ? (
          <p className="mt-1 font-mono text-[11px] text-signal">Broken: {info.error}</p>
        ) : (
          <p className="mt-1 line-clamp-2 text-[0.875rem] leading-snug text-muted-foreground">{info.description || 'No description.'}</p>
        )}
        <div className="mt-3 flex items-center gap-1" aria-hidden="true">
          {swatches.map((c, i) => (
            <span key={i} className="size-3.5 rounded-full border border-rule" style={{ background: c }} />
          ))}
          <span className="ml-2 truncate font-mono text-[10px] text-neutral">
            {[...new Set([family(t.fonts.ui), family(t.fonts.body)])].join(' · ')}
          </span>
        </div>
        <div className="mt-auto flex items-center gap-2 pt-4">
          {current ? (
            <span className="flex h-8 items-center gap-1.5 rounded-full bg-bloom-wash px-3 text-[0.8125rem] font-semibold">
              <Check className="size-3.5 text-bloom-deep" strokeWidth={2.5} />
              In use
            </span>
          ) : (
            <button
              type="button"
              disabled={!!info.error}
              onClick={onApply}
              className="h-8 rounded-full bg-solid px-3.5 text-[0.8125rem] font-semibold text-on-solid transition-colors hover:bg-solid-hover disabled:bg-paper-3 disabled:text-neutral"
            >
              Apply
            </button>
          )}
          {onRemove &&
            (confirm ? (
              <button
                type="button"
                autoFocus
                onBlur={() => setConfirm(false)}
                onClick={onRemove}
                className="ml-auto h-7 rounded-full bg-signal/10 px-2.5 text-[0.75rem] font-semibold text-signal hover:bg-signal/15"
              >
                Remove
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirm(true)}
                aria-label={`Remove ${info.name} from your themes`}
                className="ml-auto grid size-7 place-items-center rounded-full text-neutral hover:bg-paper-2 hover:text-ink"
              >
                <X className="size-3.5" />
              </button>
            ))}
        </div>
      </div>
    </article>
  )
}

export function ThemeShelf({
  themes,
  current,
  filter,
  onApply,
  onSaveCurrent,
  onRemove,
}: {
  themes: ThemeInfo[]
  /** The look on screen now. */
  current: Theme | null
  filter: 'all' | 'native' | 'yours'
  /** mine's theme toast offers the undo. */
  onApply: (t: ThemeInfo) => void
  onSaveCurrent: () => void
  onRemove: (t: ThemeInfo) => void
}) {
  const inUse = (i: ThemeInfo) => !!current && !i.error && sameLook(themeOf(i), current)
  const unsaved = current && !themes.some(inUse)
  const native = themes.filter((t) => t.source === 'native')
  const yours = themes.filter((t) => t.source === 'yours')
  const grid = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-4'
  const card = (t: ThemeInfo) => (
    <ThemeCard
      key={t.id}
      info={t}
      current={inUse(t)}
      onApply={() => onApply(t)}
      onRemove={t.source === 'yours' ? () => onRemove(t) : undefined}
    />
  )

  return (
    <>
      {filter !== 'yours' && (
        <section aria-labelledby="themes-native" className="mt-10">
          <h2 id="themes-native" className="mb-3 font-mono text-[10.5px] text-neutral uppercase">
            Made by mine
          </h2>
          <div className={grid}>{native.map(card)}</div>
        </section>
      )}
      {filter !== 'native' && (
        <section aria-labelledby="themes-yours" className="mt-10">
          <h2 id="themes-yours" className="mb-3 font-mono text-[10.5px] text-neutral uppercase">
            Made for you
          </h2>
          <div className={grid}>
            {yours.map(card)}
            {unsaved && (
              <button
                type="button"
                onClick={onSaveCurrent}
                className="flex min-h-[19rem] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-rule px-6 text-center transition-colors hover:border-bloom-deep/50 hover:bg-paper-2/60"
              >
                <Plus className="size-5 text-bloom-deep" />
                <span className="font-semibold">Keep the look you’re using{current?.name && current.name !== 'Bloom' ? ` (${current.name})` : ''}</span>
                <span className="max-w-[18rem] font-serif text-[0.9375rem] text-muted-foreground">
                  It isn’t saved as a theme yet. Save it here to come back to it any time.
                </span>
              </button>
            )}
          </div>
          {!yours.length && !unsaved && (
            <p className="rounded-xl border border-dashed border-rule px-6 py-10 text-center font-serif text-[1.0625rem] text-muted-foreground">
              Nothing of yours yet. Ask mine for one, like “make me a theme from our brand colours”.
            </p>
          )}
        </section>
      )}
    </>
  )
}
