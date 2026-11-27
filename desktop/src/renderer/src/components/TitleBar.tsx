import type { ReactNode } from 'react'
import { Minimize2, Monitor, Moon, Settings as Cog, ShieldCheck, SquarePen, Sun } from 'lucide-react'
import type { ThemePref } from '@shared/ipc'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const THEMES: Record<ThemePref, { next: ThemePref; label: string; Icon: typeof Sun }> = {
  system: { next: 'light', label: 'Theme follows your system', Icon: Monitor },
  light: { next: 'dark', label: 'Light theme', Icon: Sun },
  dark: { next: 'system', label: 'Dark theme', Icon: Moon },
}

export function TitleBar({
  canReset,
  theme,
  onTheme,
  onSettings,
  settingsOpen,
  updateWaiting,
  onReset,
  history,
  screens,
  setup,
  onMinimise,
  onStopAllowAll,
}: {
  canReset: boolean
  theme: ThemePref
  onTheme: (t: ThemePref) => void
  /** Opens settings; missing before mine is set up. */
  onSettings?: () => void
  settingsOpen?: boolean
  /** A new version is ready to install or download. */
  updateWaiting?: boolean
  onReset: () => void
  /** The past-conversations button. */
  history?: ReactNode
  /** The way to screens and the widget marketplace. */
  screens?: ReactNode
  /** How much of connecting the person's tools is left. */
  setup?: ReactNode
  /** Shown when the conversation is full screen and a screen could show instead. */
  onMinimise?: () => void
  /** Set while agents may do anything in this folder without asking; turns it off. */
  onStopAllowAll?: () => void
}) {
  const t = THEMES[theme]

  return (
    <header className="titlebar flex shrink-0 items-center gap-3 border-b border-rule/70">
      <span className="wordmark" role="img" aria-label="mine">
        m
      </span>

      {screens && <div className="ml-3 flex shrink-0 items-center">{screens}</div>}
      {setup && <div className="-ml-1.5 flex shrink-0 items-center">{setup}</div>}

      {onStopAllowAll && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={onStopAllowAll}
              aria-label="Agents can do anything in this folder without asking. Click to make them ask again."
              className="h-8 shrink-0 rounded-full border border-bloom-deep/40 bg-bloom-wash px-2.5 font-mono text-[11px] font-normal text-ink hover:bg-bloom/30"
            >
              <ShieldCheck className="text-bloom-deep" />
              allowing all
            </Button>
          </TooltipTrigger>
          <TooltipContent>Agents don’t ask before anything in this folder. Click to make them ask again.</TooltipContent>
        </Tooltip>
      )}

      <div className="flex-1" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onTheme(t.next)}
            aria-label={`${t.label}. Switch to ${THEMES[t.next].label.toLowerCase()}`}
            className="rounded-full"
          >
            <t.Icon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {t.label}. Click for {t.next === 'system' ? 'system' : t.next}.
        </TooltipContent>
      </Tooltip>

      {history}

      {onSettings && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onSettings}
              aria-label={updateWaiting ? 'Settings. A new version of mine is ready.' : 'Settings'}
              aria-pressed={settingsOpen}
              className={settingsOpen ? 'relative rounded-full bg-paper-2' : 'relative rounded-full'}
            >
              <Cog />
              {updateWaiting && <span aria-hidden="true" className="absolute top-1 right-1 size-2 rounded-full bg-bloom-deep ring-2 ring-paper" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{updateWaiting ? 'A new version is ready. Settings (Ctrl+,)' : 'Settings (Ctrl+,)'}</TooltipContent>
        </Tooltip>
      )}

      {onMinimise && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onMinimise} aria-label="Minimise the conversation and show the screen" className="rounded-full">
              <Minimize2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Show the screen (Ctrl+J)</TooltipContent>
        </Tooltip>
      )}

      {canReset && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onReset} aria-label="New conversation" className="rounded-full">
              <SquarePen />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New conversation</TooltipContent>
        </Tooltip>
      )}
    </header>
  )
}
