import { useEffect, useRef, useState } from 'react'
import { ArrowUp, File, Folder, FolderOpen, Maximize2 } from 'lucide-react'
import type { CommandView as View, FileEntry } from '@shared/commands'
import { useAbilities } from '@/lib/abilities'
import { cn } from '@/lib/utils'
import { bytes, date, FileBody, FileHeader, iconButton, parentOf, useFile } from './FilePreview'
import { Markdown } from './Markdown'
import { WidgetFrame } from './WidgetFrame'

// Views commands and agents show inside the conversation. They sit in the
// thread like anything else: quiet frame, theme colours, no chrome.

const frame = 'overflow-hidden rounded-xl border border-rule bg-surface'

/** One file's contents, with a way into the full-screen explorer. */
function FilePane({ path, onBack }: { path: string; onBack?: () => void }) {
  const { openExplorer } = useAbilities()
  const f = useFile(path)
  return (
    <>
      <FileHeader path={path} f={f} onBack={onBack} onExpand={() => openExplorer(parentOf(path), path)} />
      <FileBody path={path} f={f} />
    </>
  )
}

/** A small file explorer. Folders open in place; files open in a preview, with a way back. */
function FilesView({ view, onChange }: { view: Extract<View, { type: 'files' }>; onChange?: (v: View) => void }) {
  const { run, openExplorer } = useAbilities()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [opened, setOpened] = useState<string | null>(null)
  // back from a preview lands on the row you came from
  const listRef = useRef<HTMLUListElement>(null)
  const scrollTop = useRef(0)

  useEffect(() => {
    if (!opened && listRef.current) listRef.current.scrollTop = scrollTop.current
  }, [opened])

  const go = async (path: string) => {
    if (!view.open || !onChange) return
    setBusy(path)
    setError(null)
    const r = await run(view.open.command, { [view.open.param]: path })
    setBusy(null)
    if (r.error) setError(r.error)
    else if (r.view) {
      scrollTop.current = 0
      onChange(r.view)
    }
  }

  const canNavigate = !!view.open && !!onChange
  const row = 'grid w-full grid-cols-[1rem_minmax(0,1fr)_4.5rem_4.5rem] items-center gap-3 px-3.5 py-1.5 text-left'

  if (opened)
    return (
      <div className={frame}>
        <FilePane path={opened} onBack={() => setOpened(null)} />
      </div>
    )

  return (
    <div className={frame}>
      <div className="flex items-center gap-1 border-b border-rule/70 py-1.5 pr-1.5 pl-3.5">
        <p className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-muted-foreground [direction:rtl]" title={view.path}>
          <bdi>{view.path}</bdi>
        </p>
        {view.parent && canNavigate && (
          <button type="button" onClick={() => go(view.parent!)} aria-label="Up a folder" title="Up a folder" className={iconButton}>
            <ArrowUp className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => void window.mine.commands.reveal(view.path)}
          aria-label="Show in the file manager"
          title="Show in the file manager"
          className={iconButton}
        >
          <FolderOpen className="size-3.5" />
        </button>
        <button type="button" onClick={() => openExplorer(view.path)} aria-label="Full screen" title="Full screen" className={iconButton}>
          <Maximize2 className="size-3.5" />
        </button>
      </div>
      {view.entries.length === 0 ? (
        <p className="px-3.5 py-4 text-sm text-muted-foreground">This folder is empty.</p>
      ) : (
        <ul
          ref={listRef}
          onScroll={(e) => (scrollTop.current = e.currentTarget.scrollTop)}
          className="scroll-soft max-h-[22rem] overflow-y-auto py-1"
          aria-label={`Contents of ${view.path}`}
        >
          {view.entries.map((e: FileEntry) => {
            const dir = e.kind === 'dir'
            const Icon = dir ? Folder : File
            return (
              <li key={e.path}>
                <button
                  type="button"
                  className={cn(row, 'hover:bg-paper-2 focus-visible:bg-paper-2 focus-visible:outline-none')}
                  onClick={() => (dir ? (canNavigate ? go(e.path) : void window.mine.commands.reveal(e.path)) : setOpened(e.path))}
                  title={dir ? `Open ${e.name}` : `Show what’s in ${e.name}`}
                >
                  <Icon className={cn('size-3.5', dir ? 'fill-bloom-wash text-bloom-deep' : 'text-neutral')} aria-hidden="true" />
                  <span className={cn('truncate text-[0.875rem]', dir && 'font-medium', e.name.startsWith('.') && 'text-neutral')}>
                    {e.name}
                    {busy === e.path && <span className="ml-2 font-mono text-[10px] text-neutral">opening…</span>}
                  </span>
                  <span className="text-right font-mono text-[10.5px] text-neutral">{dir ? '' : bytes(e.size)}</span>
                  <span className="text-right font-mono text-[10.5px] text-neutral">{date(e.modified)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {(view.more || error) && (
        <p className={cn('border-t border-rule/70 px-3.5 py-2 font-mono text-[10.5px]', error ? 'text-signal' : 'text-neutral')}>
          {error ?? `${view.more} more not shown`}
        </p>
      )}
    </div>
  )
}

function TableView({ view }: { view: Extract<View, { type: 'table' }> }) {
  return (
    <div className={frame}>
      <div className="scroll-soft max-h-[26rem] overflow-auto">
        <table className="w-full border-collapse text-[0.875rem]">
          {view.caption && <caption className="px-3.5 pt-2.5 text-left font-mono text-[10.5px] text-neutral uppercase">{view.caption}</caption>}
          <thead>
            <tr>
              {view.columns.map((c, i) => (
                <th key={i} className="border-b border-rule px-3.5 py-2 text-left font-mono text-[10.5px] font-normal text-neutral uppercase">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r, i) => (
              <tr key={i} className="border-b border-rule/50 last:border-0">
                {r.map((cell, j) => (
                  <td key={j} className={cn('px-3.5 py-1.5 align-top', typeof cell === 'number' && 'text-right tabular-nums')}>
                    {cell ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ListView({ view }: { view: Extract<View, { type: 'list' }> }) {
  return (
    <dl className={cn(frame, 'divide-y divide-rule/60')}>
      {view.items.map((it, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 px-3.5 py-2">
          <dt className="truncate text-[0.9375rem]">{it.label}</dt>
          {it.value != null && <dd className="truncate text-right font-mono text-[11px] text-muted-foreground">{it.value}</dd>}
        </div>
      ))}
    </dl>
  )
}

/** The page's own @font-face rules and theme, so static HTML matches mine. */
function pageStyles() {
  let fonts = ''
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) if (rule instanceof CSSFontFaceRule) fonts += rule.cssText + '\n'
    } catch {
      /* cross-origin sheet */
    }
  }
  const theme = document.getElementById('mine-theme')?.textContent ?? ''
  return `${fonts}${theme}
:root { color-scheme: light dark; --font-display: var(--brand-font-display); --font-ui: var(--brand-font-ui); --font-body: var(--brand-font-body); --font-mono: var(--brand-font-mono); }
html, body { margin: 0; background: transparent; }
body { color: var(--ink); font: 15px/1.45 var(--font-ui); padding: 12px 14px; }`
}

/** Static HTML: no scripts (the sandbox blocks them), sized to fit. */
function HtmlView({ view }: { view: Extract<View, { type: 'html' }> }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [h, setH] = useState(view.height ?? 120)
  const fit = () => {
    const doc = ref.current?.contentDocument
    if (doc && !view.height) setH(Math.min(640, Math.max(40, doc.documentElement.scrollHeight)))
  }
  return (
    <div className={frame}>
      <iframe
        ref={ref}
        title="View"
        sandbox="allow-same-origin"
        srcDoc={`<!doctype html><meta charset="utf-8"><style>${pageStyles()}</style>${view.html}`}
        onLoad={fit}
        style={{ height: h }}
        className="block w-full border-0"
      />
    </div>
  )
}

export function CommandView({ view, onChange }: { view: View; onChange?: (v: View) => void }) {
  switch (view.type) {
    case 'files':
      return <FilesView view={view} onChange={onChange} />
    case 'file':
      return (
        <div className={frame}>
          <FilePane path={view.path} />
        </div>
      )
    case 'table':
      return <TableView view={view} />
    case 'list':
      return <ListView view={view} />
    case 'markdown':
      return (
        <div className="prose-agent">
          <Markdown text={view.text} />
        </div>
      )
    case 'html':
      return <HtmlView view={view} />
    case 'widget':
      return <WidgetFrame id={view.name} props={view.props} />
  }
}
