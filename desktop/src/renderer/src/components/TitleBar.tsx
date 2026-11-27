import type { ReactNode } from 'react'
import { FolderOpen, Minimize2, Monitor, Moon, ShieldCheck, SquarePen, Sun, Zap } from 'lucide-react'
import type { HarnessId, HarnessInfo, Settings, ThemePref } from '@shared/ipc'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const THEMES: Record<ThemePref, { next: ThemePref; label: string; Icon: typeof Sun }> = {
  system: { next: 'light', label: 'Theme follows your system', Icon: Monitor },
  light: { next: 'dark', label: 'Light theme', Icon: Sun },
  dark: { next: 'system', label: 'Dark theme', Icon: Moon },
}

function shortPath(p: string) {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length <= 2 ? p : `…/${parts.slice(-2).join('/')}`
}

export function TitleBar({
  harnesses,
  settings,
  canReset,
  theme,
  onTheme,
  decisions,
  onDecisions,
  onHarness,
  onWorkdir,
  onReset,
  history,
  screens,
  setup,
  onMinimise,
  onStopAllowAll,
}: {
  harnesses: HarnessInfo[]
  settings: Settings | null
  canReset: boolean
  theme: ThemePref
  onTheme: (t: ThemePref) => void
  /** Provider name, 'off', or null before setup. */
  decisions: string | null
  onDecisions: () => void
  onHarness: (id: HarnessId) => void
  onWorkdir: () => void
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
  const found = harnesses.filter((h) => h.found)
  const t = THEMES[theme]

  return (
    <header className="titlebar flex shrink-0 items-center gap-3 border-b border-rule/70">
      <span className="wordmark" role="img" aria-label="mine">
        m
      </span>

      {screens && <div className="ml-3 flex shrink-0 items-center">{screens}</div>}
      {setup && <div className="-ml-1.5 flex shrink-0 items-center">{setup}</div>}

      {settings?.harness && (
        <div className={`${screens ? 'ml-1' : 'ml-3'} flex min-w-0 items-center gap-1.5`}>
          <Select value={settings.harness} onValueChange={(v) => onHarness(v as HarnessId)}>
            <SelectTrigger
              size="sm"
              aria-label="Harness"
              className="h-8 rounded-full border-rule bg-surface pr-2.5 pl-3 text-[0.875rem] font-medium shadow-none"
            >
              <span className="size-1.5 shrink-0 rounded-full bg-bloom-deep" aria-hidden="true" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start" className="rounded-xl border-rule">
              {found.map((h) => (
                <SelectItem key={h.id} value={h.id} className="rounded-lg">
                  {h.name}
                  <span className="font-mono text-[10.5px] text-neutral">{h.vendor}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={onWorkdir}
                className="h-8 min-w-0 rounded-full px-2.5 font-mono text-[11px] font-normal text-muted-foreground"
              >
                <FolderOpen />
                <span className="truncate">{settings ? shortPath(settings.workdir) : ''}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Agents work in {settings?.workdir}. Click to change.</TooltipContent>
          </Tooltip>

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

          {decisions && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDecisions}
                  className="h-8 shrink-0 rounded-full px-2.5 font-mono text-[11px] font-normal text-muted-foreground"
                  aria-label={decisions === 'off' ? 'Instant commands are off. Set up a decisions model' : `Instant commands by ${decisions}`}
                >
                  <Zap className={decisions === 'off' ? '' : 'fill-bloom text-bloom-deep'} />
                  {decisions === 'off' ? 'off' : decisions}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {decisions === 'off' ? 'Instant commands are off. Click to set up.' : `Instant commands via ${decisions}. Click to change.`}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
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
