import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { Dialog } from 'radix-ui'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  ExternalLink,
  File,
  Folder,
  FolderOpen,
  Minimize2,
  RotateCw,
  X,
} from 'lucide-react'
import type { FileEntry, FileListing, FilePreview } from '@shared/commands'
import { languageName, languageOf } from '@/lib/highlight'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { CodeEditor, type EditorHandle } from './CodeEditor'
import { baseName, bytes, date, FileBody, iconButton } from './FilePreview'
import { Markdown } from './Markdown'

// The full-screen explorer: a folder tree on the left and open files in tabs
// on the right, editable, like a code editor. Back and forward walk the
// folders you've been in; up goes to the parent. Arrow keys move through the
// tree; Ctrl+S saves; Ctrl+W closes a tab; Ctrl+Tab switches tabs.

type Row = { entry: FileEntry; depth: number }

type Tab = {
  path: string
  file: FilePreview | null
  dirty: boolean
  /** Markdown shows rendered (preview) or as text to edit. */
  mode: 'preview' | 'edit'
  /** What the preview shows: the editor's text when it was last switched to preview. */
  previewText?: string
  status?: { kind: 'saved' | 'error' | 'conflict'; text: string }
}

export type ExplorerHandle = {
  save: () => Promise<boolean>
  closeTab: () => void
  setMarkdownMode: (mode: 'preview' | 'edit') => boolean
}

const MARKDOWN = /\.(md|markdown|mdx)$/i
const WIDTH_KEY = 'mine.explorer.width'
const readWidth = () => {
  try {
    return Number(localStorage.getItem(WIDTH_KEY)) || 288
  } catch {
    return 288
  }
}

function segments(path: string) {
  // C:\Users\me\x → C:\, C:\Users, C:\Users\me, C:\Users\me\x
  const sep = path.includes('\\') ? '\\' : '/'
  const parts = path.split(/[\\/]/).filter(Boolean)
  const out: { name: string; path: string }[] = []
  let acc = ''
  parts.forEach((p, i) => {
    acc = i === 0 ? (path.startsWith('/') ? `/${p}` : `${p}${sep}`) : `${acc.replace(/[\\/]$/, '')}${sep}${p}`
    out.push({ name: p, path: acc })
  })
  return out
}

const parentName = (p: string) => p.split(/[\\/]/).filter(Boolean).slice(-2, -1)[0] ?? ''

export const Explorer = forwardRef<ExplorerHandle, { root: string; file?: string; onClose: () => void }>(function Explorer(
  { root, file, onClose },
  ref,
) {
  const [history, setHistory] = useState({ stack: [root], at: 0 })
  const cwd = history.stack[history.at]
  const [listings, setListings] = useState(new Map<string, FileListing>())
  const [expanded, setExpanded] = useState(new Set<string>())
  const [focus, setFocus] = useState<string | undefined>(file)
  const [width, setWidth] = useState(readWidth)
  const tree = useRef<HTMLDivElement>(null)

  // ---- tabs ----------------------------------------------------------------------

  const [tabs, setTabs] = useState<Tab[]>([])
  const [active, setActive] = useState<string | undefined>()
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const editors = useRef(new Map<string, EditorHandle>())
  // when the file was last read or saved, to spot changes made elsewhere
  const stamps = useRef(new Map<string, number>())
  const [ask, setAsk] = useState<null | { kind: 'tab'; path: string } | { kind: 'close' }>(null)

  const patch = (path: string, fn: (t: Tab) => Tab) => setTabs((ts) => ts.map((t) => (t.path === path ? fn(t) : t)))
  const tab = tabs.find((t) => t.path === active)

  const openFile = useCallback(async (path: string) => {
    setActive(path)
    setAsk(null)
    if (tabsRef.current.some((t) => t.path === path)) return
    setTabs((ts) => [...ts, { path, file: null, dirty: false, mode: MARKDOWN.test(path) ? 'preview' : 'edit' }])
    const f = await window.mine.files.read(path)
    if (f.kind !== 'error') stamps.current.set(path, f.modified)
    patch(path, (t) => ({ ...t, file: f }))
  }, [])

  useEffect(() => {
    if (file) void openFile(file)
  }, [file, openFile])

  /** Coming back to a tab with no edits: pick up changes made on disk (by an agent, say). */
  const refresh = useCallback(async (path: string) => {
    const t = tabsRef.current.find((x) => x.path === path)
    const h = editors.current.get(path)
    if (!t || t.dirty || !h || t.file?.kind !== 'text') return
    const f = await window.mine.files.read(path)
    if (f.kind !== 'text' || f.modified === stamps.current.get(path)) return
    stamps.current.set(path, f.modified)
    h.view.dispatch({ changes: { from: 0, to: h.view.state.doc.length, insert: f.text } })
    h.saved = h.view.state.doc
    patch(path, (x) => ({ ...x, file: f, dirty: false, previewText: f.text }))
  }, [])

  const activate = (path: string) => {
    setActive(path)
    void refresh(path)
    requestAnimationFrame(() => editors.current.get(path)?.view.requestMeasure())
  }

  const save = useCallback(async (path: string | undefined, force = false) => {
    const t = tabsRef.current.find((x) => x.path === path)
    const h = path ? editors.current.get(path) : undefined
    if (!t || !h || t.file?.kind !== 'text' || t.file.truncated) return false
    let text = h.view.state.doc.toString()
    // keep the file's own line endings and byte-order mark
    if (t.file.text.includes('\r\n')) text = text.replace(/\r?\n/g, '\r\n')
    if (t.file.bom) text = '\uFEFF' + text
    const r = await window.mine.files.write(t.path, text, stamps.current.get(t.path), force)
    if (!r.ok) {
      patch(t.path, (x) => ({ ...x, status: { kind: r.conflict ? 'conflict' : 'error', text: r.error } }))
      return false
    }
    stamps.current.set(t.path, r.modified)
    h.saved = h.view.state.doc
    const size = new Blob([text]).size
    patch(t.path, (x) => ({
      ...x,
      dirty: false,
      file: x.file?.kind === 'text' ? { ...x.file, size, modified: r.modified } : x.file,
      status: { kind: 'saved', text: 'Saved' },
    }))
    setTimeout(() => patch(t.path, (x) => (x.status?.kind === 'saved' ? { ...x, status: undefined } : x)), 1600)
    return true
  }, [])

  const reloadFromDisk = async (path: string) => {
    const h = editors.current.get(path)
    const f = await window.mine.files.read(path)
    if (f.kind !== 'text' || !h) return
    stamps.current.set(path, f.modified)
    h.view.dispatch({ changes: { from: 0, to: h.view.state.doc.length, insert: f.text } })
    h.saved = h.view.state.doc
    patch(path, (x) => ({ ...x, file: f, dirty: false, status: undefined, previewText: f.text }))
  }

  const drop = (path: string) => {
    editors.current.delete(path)
    stamps.current.delete(path)
    const i = tabsRef.current.findIndex((t) => t.path === path)
    const rest = tabsRef.current.filter((t) => t.path !== path)
    setTabs(rest)
    if (active === path) setActive(rest[Math.min(i, rest.length - 1)]?.path)
    setAsk(null)
  }
  const closeTab = (path: string | undefined) => {
    const t = tabsRef.current.find((x) => x.path === path)
    if (!t) return
    if (t.dirty) setAsk({ kind: 'tab', path: t.path })
    else drop(t.path)
  }
  const requestClose = () => {
    if (tabsRef.current.some((t) => t.dirty)) setAsk({ kind: 'close' })
    else onClose()
  }

  const setMode = (path: string, mode: 'preview' | 'edit') => {
    const h = editors.current.get(path)
    patch(path, (t) => ({ ...t, mode, previewText: h ? h.view.state.doc.toString() : t.previewText }))
    if (mode === 'edit') requestAnimationFrame(() => (h?.view.requestMeasure(), h?.view.focus()))
  }

  useImperativeHandle(ref, () => ({
    save: () => save(active),
    closeTab: () => closeTab(active),
    setMarkdownMode: (mode) => {
      if (!active || !MARKDOWN.test(active)) return false
      setMode(active, mode)
      return true
    },
  }))

  // unsaved edits: the window asks before closing (main shows the dialog)
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (tabsRef.current.some((t) => t.dirty)) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])

  // ---- the tree ------------------------------------------------------------------

  const load = useCallback(
    async (path: string, force = false) => {
      if (!force && listings.has(path)) return
      const l = await window.mine.files.list(path)
      setListings((m) => new Map(m).set(path, l))
    },
    [listings],
  )

  useEffect(() => {
    void load(cwd)
  }, [cwd, load])

  const go = (path: string) => {
    if (path === cwd) return
    setHistory((h) => ({ stack: [...h.stack.slice(0, h.at + 1), path], at: h.at + 1 }))
    setFocus(undefined)
  }
  const back = () => setHistory((h) => (h.at > 0 ? { ...h, at: h.at - 1 } : h))
  const forward = () => setHistory((h) => (h.at < h.stack.length - 1 ? { ...h, at: h.at + 1 } : h))
  const listing = listings.get(cwd)
  const up = () => listing?.parent && go(listing.parent)

  const toggle = (dir: string, open?: boolean) => {
    setExpanded((s) => {
      const next = new Set(s)
      const want = open ?? !next.has(dir)
      if (want) next.add(dir)
      else next.delete(dir)
      return next
    })
    if (open !== false) void load(dir)
  }

  const refreshTree = () => {
    const paths = [cwd, ...expanded]
    setListings(new Map())
    for (const p of paths) void window.mine.files.list(p).then((l) => setListings((m) => new Map(m).set(p, l)))
  }

  const rows = useMemo(() => {
    const out: Row[] = []
    const walk = (path: string, depth: number) => {
      for (const entry of listings.get(path)?.entries ?? []) {
        out.push({ entry, depth })
        if (entry.kind === 'dir' && expanded.has(entry.path)) walk(entry.path, depth + 1)
      }
    }
    walk(cwd, 0)
    return out
  }, [listings, expanded, cwd])

  const pick = (r: Row) => {
    setFocus(r.entry.path)
    if (r.entry.kind === 'dir') toggle(r.entry.path)
    else void openFile(r.entry.path)
  }

  const focusRow = (path: string) => {
    setFocus(path)
    requestAnimationFrame(() => tree.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)?.focus())
  }

  const onTreeKey = (e: ReactKeyboardEvent) => {
    if (e.altKey && e.key === 'ArrowLeft') return e.preventDefault(), back()
    if (e.altKey && e.key === 'ArrowRight') return e.preventDefault(), forward()
    if ((e.altKey && e.key === 'ArrowUp') || e.key === 'Backspace') return e.preventDefault(), up()
    const i = rows.findIndex((r) => r.entry.path === focus)
    const r = rows[i]
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (rows[i + 1] ?? (!r && rows[0])) focusRow((rows[i + 1] ?? rows[0]).entry.path)
        break
      case 'ArrowUp':
        e.preventDefault()
        if (i > 0) focusRow(rows[i - 1].entry.path)
        break
      case 'ArrowRight':
        if (!r || r.entry.kind !== 'dir') break
        e.preventDefault()
        if (!expanded.has(r.entry.path)) toggle(r.entry.path, true)
        else if (rows[i + 1]?.depth > r.depth) focusRow(rows[i + 1].entry.path)
        break
      case 'ArrowLeft': {
        if (!r) break
        e.preventDefault()
        if (r.entry.kind === 'dir' && expanded.has(r.entry.path)) toggle(r.entry.path, false)
        else
          for (let j = i - 1; j >= 0; j--)
            if (rows[j].depth < r.depth) {
              focusRow(rows[j].entry.path)
              break
            }
        break
      }
      case 'Enter':
      case ' ':
        if (!r) break
        e.preventDefault()
        if (e.key === 'Enter' && r.entry.kind === 'dir' && (e.ctrlKey || e.metaKey)) go(r.entry.path)
        else pick(r)
        break
    }
  }

  // Ctrl+S anywhere in the explorer (the editor handles its own first);
  // Ctrl+Tab / Ctrl+Shift+Tab move between tabs
  const onKey = (e: ReactKeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !e.defaultPrevented) {
      e.preventDefault()
      void save(active)
      return
    }
    if (e.ctrlKey && e.key === 'Tab' && tabs.length > 1) {
      e.preventDefault()
      const i = tabs.findIndex((t) => t.path === active)
      const next = tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length]
      activate(next.path)
    }
  }

  const startResize = (e: React.PointerEvent) => {
    const startX = e.clientX
    const start = width
    const move = (ev: PointerEvent) => setWidth(Math.min(640, Math.max(180, start + ev.clientX - startX)))
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      setWidth((w) => {
        try {
          localStorage.setItem(WIDTH_KEY, String(w))
        } catch {
          /* fine */
        }
        return w
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
  }

  const crumbs = segments(cwd)
  const names = tabs.map((t) => baseName(t.path))
  const dirty = tabs.filter((t) => t.dirty)

  return (
    <Dialog.Root open onOpenChange={(o) => !o && requestClose()}>
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined}
          onKeyDown={onKey}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            tree.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus() ?? tree.current?.focus()
          }}
          // Esc inside the editor belongs to the editor (search, selections), not to closing
          onEscapeKeyDown={(e) => {
            if ((e.target as HTMLElement | null)?.closest('.cm-editor')) e.preventDefault()
          }}
          className="animate-in fade-in fixed inset-x-0 top-[var(--titlebar)] bottom-0 z-40 flex flex-col bg-paper duration-150 outline-none"
        >
          <Dialog.Title className="sr-only">Files in {baseName(cwd)}</Dialog.Title>

          <div className="flex h-11 shrink-0 items-center gap-1 border-b border-rule/70 px-2">
            <button type="button" onClick={back} disabled={history.at === 0} aria-label="Back" title="Back (Alt+←)" className={cn(iconButton, 'disabled:opacity-35')}>
              <ArrowLeft className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={forward}
              disabled={history.at >= history.stack.length - 1}
              aria-label="Forward"
              title="Forward (Alt+→)"
              className={cn(iconButton, 'disabled:opacity-35')}
            >
              <ArrowRight className="size-3.5" />
            </button>
            <button type="button" onClick={up} disabled={!listing?.parent} aria-label="Up a folder" title="Up a folder (Alt+↑)" className={cn(iconButton, 'disabled:opacity-35')}>
              <ArrowUp className="size-3.5" />
            </button>
            <nav aria-label="Folder path" className="ml-1.5 flex min-w-0 flex-1 items-center overflow-hidden font-mono text-[11.5px]">
              {crumbs.map((c, i) => (
                <span key={c.path} className={cn('flex min-w-0 items-center', i < crumbs.length - 2 && 'shrink-[3]')}>
                  {i > 0 && <ChevronRight className="mx-0.5 size-3 shrink-0 text-neutral" aria-hidden="true" />}
                  <button
                    type="button"
                    onClick={() => go(c.path)}
                    title={c.path}
                    aria-current={i === crumbs.length - 1 ? 'location' : undefined}
                    className={cn('truncate rounded-md px-1 py-0.5 hover:bg-paper-2', i === crumbs.length - 1 ? 'font-medium text-ink' : 'text-muted-foreground')}
                  >
                    {c.name}
                  </button>
                </span>
              ))}
            </nav>
            <button type="button" onClick={refreshTree} aria-label="Refresh" title="Refresh" className={iconButton}>
              <RotateCw className="size-3.5" />
            </button>
            <button type="button" onClick={() => void window.mine.commands.reveal(cwd)} aria-label="Show in the file manager" title="Show in the file manager" className={iconButton}>
              <FolderOpen className="size-3.5" />
            </button>
            <Dialog.Close className="ml-1 flex h-8 items-center gap-1.5 rounded-full border border-rule px-3 text-sm font-medium hover:bg-paper-2" title="Close (Esc)">
              <Minimize2 className="size-3.5" />
              Close
            </Dialog.Close>
          </div>

          <div className="flex min-h-0 flex-1">
            {/* the tree */}
            <div
              ref={tree}
              role="tree"
              aria-label={`Files in ${baseName(cwd)}`}
              onKeyDown={onTreeKey}
              style={{ width }}
              className="scroll-soft shrink-0 overflow-y-auto border-r border-rule/70 bg-surface/60 py-1 outline-none"
            >
              {listing?.error ? (
                <p className="px-3.5 py-3 font-mono text-[11px] text-signal">{listing.error}</p>
              ) : listing && rows.length === 0 ? (
                <p className="px-3.5 py-3 text-sm text-muted-foreground">This folder is empty.</p>
              ) : (
                rows.map((r, i) => {
                  const dir = r.entry.kind === 'dir'
                  const open = dir && expanded.has(r.entry.path)
                  const isSel = r.entry.path === active
                  const t = !dir ? tabs.find((x) => x.path === r.entry.path) : undefined
                  const tabbable = focus ? r.entry.path === focus : i === 0
                  return (
                    <button
                      key={r.entry.path}
                      type="button"
                      role="treeitem"
                      aria-expanded={dir ? open : undefined}
                      aria-selected={isSel}
                      aria-level={r.depth + 1}
                      data-path={r.entry.path}
                      tabIndex={tabbable ? 0 : -1}
                      onClick={() => pick(r)}
                      onDoubleClick={() => dir && go(r.entry.path)}
                      onFocus={() => setFocus(r.entry.path)}
                      title={dir ? `${r.entry.name} (double-click to open as the top folder)` : r.entry.name}
                      style={{ paddingLeft: 8 + r.depth * 14 }}
                      className={cn(
                        'flex h-[26px] w-full items-center gap-1.5 pr-3 text-left text-[0.8125rem] outline-none',
                        'focus-visible:ring-1 focus-visible:ring-focus focus-visible:ring-inset',
                        isSel ? 'bg-bloom-wash text-ink' : 'hover:bg-paper-2',
                      )}
                    >
                      <ChevronRight className={cn('size-3 shrink-0 text-neutral transition-transform duration-100', !dir && 'invisible', open && 'rotate-90')} aria-hidden="true" />
                      {dir ? (
                        <Folder className="size-3.5 shrink-0 fill-bloom-wash text-bloom-deep" aria-hidden="true" />
                      ) : (
                        <File className="size-3.5 shrink-0 text-neutral" aria-hidden="true" />
                      )}
                      <span className={cn('min-w-0 flex-1 truncate', r.entry.name.startsWith('.') && 'text-neutral', isSel && 'font-medium')}>{r.entry.name}</span>
                      {t?.dirty && <span className="size-1.5 shrink-0 rounded-full bg-bloom-deep" aria-label="unsaved" />}
                    </button>
                  )
                })
              )}
              {!!listing?.more && <p className="px-3.5 py-2 font-mono text-[10.5px] text-neutral">{listing.more} more not shown</p>}
            </div>

            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize the file list"
              onPointerDown={startResize}
              className="-ml-[3px] w-[5px] shrink-0 cursor-col-resize hover:bg-bloom/40"
            />

            {/* open files */}
            <section aria-label="Open files" className="flex min-w-0 flex-1 flex-col">
              {tabs.length > 0 && (
                <div role="tablist" aria-label="Open files" className="scroll-soft flex h-9 shrink-0 overflow-x-auto border-b border-rule/70 bg-paper-2/50">
                  {tabs.map((t, i) => {
                    const on = t.path === active
                    const dup = names.filter((n) => n === names[i]).length > 1
                    return (
                      <div
                        key={t.path}
                        role="tab"
                        aria-selected={on}
                        tabIndex={on ? 0 : -1}
                        title={t.path}
                        onClick={() => activate(t.path)}
                        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && activate(t.path)}
                        onMouseDown={(e) => {
                          if (e.button === 1) {
                            e.preventDefault()
                            closeTab(t.path)
                          }
                        }}
                        className={cn(
                          'group/tab flex shrink-0 cursor-default items-center gap-1.5 border-r border-rule/60 pr-1 pl-3 text-[0.8125rem] outline-none select-none focus-visible:ring-1 focus-visible:ring-focus focus-visible:ring-inset',
                          on ? 'bg-paper text-ink shadow-[inset_0_2px_0_var(--bloom-deep)]' : 'text-muted-foreground hover:bg-paper-2',
                        )}
                      >
                        <span className={cn('max-w-[14rem] truncate', on && 'font-medium')}>{names[i]}</span>
                        {dup && <span className="max-w-[8rem] truncate font-mono text-[10px] text-neutral">{parentName(t.path)}</span>}
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={(e) => {
                            e.stopPropagation()
                            closeTab(t.path)
                          }}
                          aria-label={`Close ${names[i]}${t.dirty ? ' (unsaved)' : ''}`}
                          title="Close (Ctrl+W)"
                          className="grid size-6 place-items-center rounded-md text-neutral hover:bg-paper-3 hover:text-ink"
                        >
                          {t.dirty ? (
                            <>
                              <span className="size-2 rounded-full bg-bloom-deep group-hover/tab:hidden" aria-hidden="true" />
                              <X className="hidden size-3.5 group-hover/tab:block" />
                            </>
                          ) : (
                            <X className={cn('size-3.5', !on && 'opacity-0 group-hover/tab:opacity-100')} />
                          )}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {ask && (
                <div role="alertdialog" aria-label="Unsaved changes" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-rule/70 bg-bloom-wash/60 px-4 py-2">
                  <p className="mr-auto text-[0.875rem]">
                    {ask.kind === 'tab' ? (
                      <>
                        <span className="font-semibold">{baseName(ask.path)}</span> has unsaved changes.
                      </>
                    ) : (
                      <>
                        <span className="font-semibold">
                          {dirty.length} {dirty.length === 1 ? 'file has' : 'files have'}
                        </span>{' '}
                        unsaved changes: {dirty.map((t) => baseName(t.path)).join(', ')}
                      </>
                    )}
                  </p>
                  <Button
                    size="sm"
                    className="h-7 rounded-full px-3"
                    autoFocus
                    onClick={async () => {
                      if (ask.kind === 'tab') {
                        if (await save(ask.path)) drop(ask.path)
                      } else {
                        let all = true
                        for (const t of dirty) all = (await save(t.path)) && all
                        if (all) onClose()
                      }
                    }}
                  >
                    {ask.kind === 'tab' || dirty.length === 1 ? 'Save' : 'Save all'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-full px-3"
                    onClick={() => (ask.kind === 'tab' ? drop(ask.path) : onClose())}
                  >
                    Don’t save
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 rounded-full px-3 text-neutral" onClick={() => setAsk(null)}>
                    Cancel
                  </Button>
                </div>
              )}

              {tab && <FileBar tab={tab} onSave={() => void save(tab.path)} onMode={(m) => setMode(tab.path, m)} onReload={() => void reloadFromDisk(tab.path)} onOverwrite={() => void save(tab.path, true)} />}

              {/* every text tab keeps its editor alive; only the active one shows */}
              {tabs.map((t) =>
                t.file?.kind === 'text' ? (
                  <CodeEditor
                    key={t.path}
                    path={t.path}
                    initial={t.file.text}
                    readOnly={t.file.truncated}
                    hidden={t.path !== active || (MARKDOWN.test(t.path) && t.mode === 'preview')}
                    onDirty={(d) => {
                      if (tabsRef.current.find((x) => x.path === t.path)?.dirty !== d)
                        patch(t.path, (x) => ({ ...x, dirty: d, status: x.status?.kind === 'saved' ? undefined : x.status }))
                    }}
                    onSave={() => void save(t.path)}
                    onReady={(h) => editors.current.set(t.path, h)}
                  />
                ) : null,
              )}

              {tab?.file?.kind === 'text' && MARKDOWN.test(tab.path) && tab.mode === 'preview' && (
                <div className="scroll-soft prose-agent min-h-0 flex-1 overflow-y-auto px-8 py-6">
                  <div className="mx-auto max-w-[46rem]">
                    <Markdown text={tab.previewText ?? tab.file.text} />
                  </div>
                </div>
              )}

              {tab && tab.file && tab.file.kind !== 'text' && (
                <FileBody
                  path={tab.path}
                  fill
                  f={{ file: tab.file, lines: [], lang: undefined, html: null, md: false, source: false, setSource: () => {} }}
                />
              )}
              {tab && !tab.file && <div className="flex-1" aria-busy="true" />}

              {!tab && (
                <div className="m-auto max-w-lg px-6 text-center">
                  <p className="font-display text-[1.5rem] font-semibold tracking-[-0.02em]">{baseName(cwd)}</p>
                  <p className="mt-1.5 font-serif text-[1rem] text-muted-foreground">Pick a file on the left to open it.</p>
                  <ul className="mt-4 font-mono text-[10.5px] leading-5 text-neutral">
                    <li>↑ ↓ move · → open folder · ← close it · Enter opens a file</li>
                    <li>Ctrl+S save · Ctrl+W close tab · Ctrl+Tab next tab</li>
                    <li>Alt+← Alt+→ back and forward · Alt+↑ up · Esc close</li>
                  </ul>
                </div>
              )}
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
})

/** The strip above a file: what it is, and what you can do with it. */
function FileBar({
  tab,
  onSave,
  onMode,
  onReload,
  onOverwrite,
}: {
  tab: Tab
  onSave: () => void
  onMode: (m: 'preview' | 'edit') => void
  onReload: () => void
  onOverwrite: () => void
}) {
  const f = tab.file
  const md = MARKDOWN.test(tab.path) && f?.kind === 'text'
  const meta =
    f && f.kind !== 'error'
      ? [languageName(languageOf(tab.path)) ?? (md ? 'Markdown' : undefined), bytes(f.size), date(f.modified)].filter(Boolean).join(' · ')
      : ''
  const status = tab.status
  return (
    <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-rule/70 pr-2 pl-4">
      <p className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-neutral" title={tab.path}>
        {meta}
        {f?.kind === 'text' && f.truncated && <span className="ml-2 text-signal">over 256 KB, so read-only here</span>}
      </p>

      {status && (
        <span
          role="status"
          className={cn('flex items-center gap-2 font-mono text-[10.5px]', status.kind === 'saved' ? 'text-muted-foreground' : 'text-signal')}
        >
          {status.text}
          {status.kind === 'conflict' && (
            <>
              <button type="button" onClick={onReload} className="rounded-full px-2 py-0.5 font-sans text-[0.75rem] font-semibold text-ink hover:bg-paper-2">
                Load theirs
              </button>
              <button type="button" onClick={onOverwrite} className="rounded-full px-2 py-0.5 font-sans text-[0.75rem] font-semibold text-ink hover:bg-paper-2">
                Keep mine
              </button>
            </>
          )}
        </span>
      )}

      {md && (
        <div role="radiogroup" aria-label="Markdown view" className="flex rounded-full bg-paper-2 p-0.5">
          {(['preview', 'edit'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={tab.mode === m}
              onClick={() => onMode(m)}
              className={cn(
                'h-6 rounded-full px-2.5 text-[0.75rem] font-medium transition-colors',
                tab.mode === m ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)]' : 'text-muted-foreground hover:text-ink',
              )}
            >
              {m === 'preview' ? 'Preview' : 'Edit'}
            </button>
          ))}
        </div>
      )}

      {f?.kind === 'text' && !f.truncated && (
        <Button
          size="sm"
          onClick={onSave}
          disabled={!tab.dirty}
          className="h-7 rounded-full px-3 text-[0.8125rem] disabled:bg-transparent disabled:text-neutral disabled:opacity-100"
          title="Save (Ctrl+S)"
        >
          {tab.dirty ? 'Save' : 'Saved'}
        </Button>
      )}
      <button type="button" onClick={() => void window.mine.files.open(tab.path)} aria-label="Open in its app" title="Open in its app" className={iconButton}>
        <ExternalLink className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={() => void window.mine.commands.reveal(tab.path)}
        aria-label="Show in the file manager"
        title="Show in the file manager"
        className={iconButton}
      >
        <FolderOpen className="size-3.5" />
      </button>
    </div>
  )
}
