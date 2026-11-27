import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** The round arrow at the edge of each way that slides to the other one. */
export function WaySwitch({
  side,
  label,
  onClick,
  children,
}: {
  side: 'left' | 'right'
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group absolute top-1/2 flex -translate-y-1/2 flex-col items-center gap-1.5 rounded-full p-1',
        side === 'right' ? 'right-2' : 'left-2',
      )}
      aria-label={label === 'Type' ? 'Type instead' : 'Speak instead'}
    >
      <span className="grid size-11 place-items-center rounded-full border-[1.5px] border-rule bg-surface text-ink transition-[border-color,background-color,translate] duration-150 ease-out group-hover:border-ink group-hover:bg-bloom-wash group-active:translate-y-px [&_svg]:size-[18px]">
        {children}
      </span>
      <span className="font-mono text-[10px] tracking-wide text-neutral uppercase">{label}</span>
    </button>
  )
}
