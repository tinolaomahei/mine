import type { ReactNode } from 'react'
import { FolderOpen, Monitor, Moon, SquarePen, Sun, Zap } from 'lucide-react'
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
}) {
  const found = harnesses.filter((h) => h.found)
  const t = THEMES[theme]

  return (
    <header className="titlebar flex shrink-0 items-center gap-3 border-b border-rule/70">
      <span className="wordmark" role="img" aria-label="mine">
        m
      </span>

      {settings?.harness && (
        <div className="ml-3 flex min-w-0 items-center gap-1.5">
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
