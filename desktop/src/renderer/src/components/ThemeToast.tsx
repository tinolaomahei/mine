import { useEffect, useRef, useState } from 'react'
import { Undo2, X } from 'lucide-react'
import type { ThemeState } from '@shared/ipc'
import { applyTheme } from '@/lib/theme'

type Toast = { key: number; text: string; canUndo: boolean; error?: boolean }

/** Applies live theme changes and offers a one-tap undo for each. */
export function ThemeToast() {
  const [toast, setToast] = useState<Toast | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(
    () =>
      window.mine.theme.onChange((s: ThemeState) => {
        if (s.error) {
          setToast({ key: Date.now(), text: `Theme not applied: ${s.error}`, canUndo: s.canUndo, error: true })
        } else {
          applyTheme(s.theme)
          setToast({ key: Date.now(), text: `Theme updated: ${s.theme.name}`, canUndo: s.canUndo })
        }
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setToast(null), s.error ? 12000 : 7000)
      }),
    [],
  )

  if (!toast) return null
  return (
    <div
      key={toast.key}
      role="status"
      className="animate-in fade-in slide-in-from-top-2 fixed top-[calc(var(--titlebar)+12px)] right-4 z-50 flex max-w-[min(26rem,calc(100vw-2rem))] items-center gap-1 rounded-full border border-rule bg-surface py-1 pr-1 pl-4 shadow-[0_10px_30px_-12px_rgb(0_0_0/0.35)] duration-300"
    >
      <span className={toast.error ? 'size-1.5 shrink-0 rounded-full bg-signal' : 'size-1.5 shrink-0 rounded-full bg-bloom-deep'} />
      <p className="ml-1.5 truncate text-sm font-medium">{toast.text}</p>
      {toast.canUndo && (
        <button
          type="button"
          onClick={() => void window.mine.theme.undo()}
          className="ml-2 flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold hover:bg-bloom-wash"
        >
          <Undo2 className="size-3.5" />
          Undo
        </button>
      )}
      <button
        type="button"
        onClick={() => setToast(null)}
        aria-label="Dismiss"
        className="grid size-8 shrink-0 place-items-center rounded-full text-neutral hover:bg-paper-2 hover:text-ink"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
