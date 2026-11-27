import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ExternalLink, FileText, FolderOpen, Maximize2 } from 'lucide-react'
import type { FilePreview } from '@shared/commands'
import { highlight, languageName, languageOf } from '@/lib/highlight'
import { cn } from '@/lib/utils'
import { Markdown } from './Markdown'

// One file's contents, shared by the file view in the conversation and the
// full-screen explorer.

export const iconButton = 'grid size-7 shrink-0 place-items-center rounded-full text-neutral hover:bg-paper-2 hover:text-ink'
export const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p
export const parentOf = (p: string) => p.replace(/[\\/][^\\/]+[\\/]?$/, '') || p
const MARKDOWN = new Set(['.md', '.markdown', '.mdx'])

export function bytes(n?: number) {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  const u = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`
}

export function date(t?: number) {
  if (!t) return ''
  const d = new Date(t)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Load a file and work out how to show it. */
export function useFile(path: string | undefined) {
  const [file, setFile] = useState<FilePreview | null>(null)
  const [source, setSource] = useState(false)

  useEffect(() => {
    let live = true
    setFile(null)
    setSource(false)
    if (path) void window.mine.files.read(path).then((f) => live && setFile(f))
    return () => {
      live = false
    }
  }, [path])

  const text = file?.kind === 'text' ? file.text : ''
  const lang = path ? languageOf(path) : undefined
  const md = file?.kind === 'text' && MARKDOWN.has(file.ext)
  const lines = useMemo(() => {
    if (!text) return [] as string[]
    const l = text.split('\n')
    if (l.length > 1 && l[l.length - 1] === '') l.pop()
    return l
  }, [text])
  const html = useMemo(() => (text ? highlight(lines.join('\n'), lang) : null), [text, lines, lang])
  return { file, lines, lang, html, md, source, setSource }
}

type Loaded = ReturnType<typeof useFile>

export function FileHeader({
  path,
  f,
  onBack,
  onExpand,
}: {
  path: string
  f: Loaded
  onBack?: () => void
  /** Open it in the full-screen explorer. */
  onExpand?: () => void
}) {
  const { file, lines, lang, md, source, setSource } = f
  const meta =
    file && file.kind !== 'error'
      ? [
          languageName(lang),
          bytes(file.size),
          file.kind === 'text' ? `${lines.length.toLocaleString()} ${lines.length === 1 ? 'line' : 'lines'}` : '',
          date(file.modified),
        ]
          .filter(Boolean)
          .join(' · ')
      : ''
  return (
    <div className="flex items-center gap-1 border-b border-rule/70 py-1.5 pr-1.5 pl-1.5">
      {onBack ? (
        <button type="button" onClick={onBack} aria-label="Back to the folder" title="Back to the folder" className={iconButton}>
          <ArrowLeft className="size-3.5" />
        </button>
      ) : (
        <FileText className="mx-1.5 size-3.5 shrink-0 text-neutral" aria-hidden="true" />
      )}
      <p className="min-w-0 flex-1 truncate pl-0.5" title={path}>
        <span className="text-[0.875rem] font-semibold">{baseName(path)}</span>
        {meta && <span className="ml-2 font-mono text-[10.5px] text-neutral">{meta}</span>}
      </p>
      {md && (
        <button
          type="button"
          onClick={() => setSource((s) => !s)}
          className="h-7 shrink-0 rounded-full px-2.5 font-mono text-[10.5px] text-neutral hover:bg-paper-2 hover:text-ink"
        >
          {source ? 'Rendered' : 'Source'}
        </button>
      )}
      <button type="button" onClick={() => void window.mine.files.open(path)} aria-label="Open in its app" title="Open in its app" className={iconButton}>
        <ExternalLink className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={() => void window.mine.commands.reveal(path)}
        aria-label="Show in the file manager"
        title="Show in the file manager"
        className={iconButton}
      >
        <FolderOpen className="size-3.5" />
      </button>
      {onExpand && (
        <button type="button" onClick={onExpand} aria-label="Full screen" title="Full screen" className={iconButton}>
          <Maximize2 className="size-3.5" />
        </button>
      )}
    </div>
  )
}

/** The contents. `fill` lets it take all the height it's given (the explorer). */
export function FileBody({ path, f, fill }: { path: string; f: Loaded; fill?: boolean }) {
  const { file, lines, html, md, source } = f
  const box = fill ? 'min-h-0 flex-1' : 'max-h-[26rem]'
  if (!file) return <div className={fill ? 'flex-1' : 'h-24'} aria-busy="true" />
  if (file.kind === 'error') return <p className="px-3.5 py-4 font-mono text-[11.5px] text-signal">{file.message}</p>
  if (file.kind === 'binary')
    return (
      <p className="px-3.5 py-4 text-[0.9375rem] text-muted-foreground">
        mine can’t show this kind of file.{' '}
        <button type="button" onClick={() => void window.mine.files.open(path)} className="font-medium text-ink underline underline-offset-2">
          Open it in its app
        </button>
      </p>
    )
  if (file.kind === 'image')
    return (
      <div className={cn('grid place-items-center overflow-auto bg-paper-2 p-4', fill && 'min-h-0 flex-1')}>
        <img src={file.src} alt={baseName(path)} className={cn('max-w-full rounded-md object-contain', fill ? 'max-h-full' : 'max-h-[24rem]')} />
      </div>
    )
  return (
    <>
      {md && !source ? (
        <div className={cn('scroll-soft prose-agent overflow-y-auto px-5 py-4', box)}>
          <Markdown text={file.text} />
        </div>
      ) : (
        <div className={cn('scroll-soft overflow-auto bg-paper-2/60', box)}>
          <div className="flex min-w-max font-mono text-[12px] leading-[1.65]">
            <pre aria-hidden="true" className="sticky left-0 shrink-0 bg-paper-2 py-2.5 pr-3 pl-3.5 text-right text-neutral select-none">
              {lines.map((_, i) => i + 1).join('\n')}
            </pre>
            {html != null ? (
              <pre className="code-hl py-2.5 pr-6 pl-3 select-text [tab-size:2]" dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <pre className="py-2.5 pr-6 pl-3 text-ink select-text [tab-size:2]">{lines.join('\n')}</pre>
            )}
          </div>
        </div>
      )}
      {file.truncated && (
        <p className="border-t border-rule/70 px-3.5 py-2 font-mono text-[10.5px] text-neutral">Showing the first 256 KB. Open it to see the rest.</p>
      )}
    </>
  )
}
