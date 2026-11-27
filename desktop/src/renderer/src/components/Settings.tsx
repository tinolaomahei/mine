import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ArrowLeft, Check, Download, FolderOpen, Monitor, Moon, Plus, RefreshCw, RotateCw, ShieldCheck, Sun, Zap } from 'lucide-react'
import type { Connection, ConnectionsState } from '@shared/connections'
import type { HarnessId, HarnessInfo, SpeechStatus, ThemePref, UpdateState } from '@shared/ipc'
import { ALL, describeRule, sameFolder, type PermissionRule } from '@shared/permissions'
import { ConnectionCard } from '@/components/Connections'
import { cn } from '@/lib/utils'

// Every setting in one place: which agent, where it works, instant commands,
// voice, the look, connected tools, what agents may do without asking.

export const SETTINGS_SECTIONS = {
  agent: 'Agent',
  instant: 'Instant commands',
  voice: 'Voice',
  appearance: 'Appearance',
  connections: 'Connections',
  permissions: 'Permissions',
  about: 'About',
} as const

export type SettingsSection = keyof typeof SETTINGS_SECTIONS

const btn = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[0.8125rem] font-semibold whitespace-nowrap transition-colors disabled:opacity-60'
const quiet = cn(btn, 'border border-rule hover:bg-paper-2')
const solid = cn(btn, 'bg-solid text-on-solid hover:bg-solid-hover')

const WAYS: Record<Connection['way']['kind'], { title: string; about: string }> = {
  mcp: { title: 'Through MCP', about: 'The service’s own MCP server. You sign in once and mine calls its tools.' },
  api: { title: 'Through their API', about: 'mine reads the service’s web API, with a sign-in or a token you pasted.' },
  local: { title: 'Programs on this computer', about: 'Command-line tools already signed in here. Each sync runs a command you approved.' },
}

const MODES: { value: ThemePref; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
]

function Section({ id, title, about, children }: { id: SettingsSection; title: string; about?: string; children: ReactNode }) {
  return (
    <section id={`settings-${id}`} aria-labelledby={`settings-${id}-title`} className="scroll-mt-6 border-t border-rule/70 pt-6 pb-10 first:border-t-0 first:pt-0">
      <h3 id={`settings-${id}-title`} className="font-display text-[1.375rem] font-semibold tracking-[-0.025em]">
        {title}
      </h3>
      {about && <p className="mt-1 max-w-[34rem] font-serif text-[0.9875rem] leading-snug text-muted-foreground">{about}</p>}
      <div className="mt-4 flex flex-col gap-3">{children}</div>
    </section>
  )
}

function Row({ label, detail, children }: { label: string; detail?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-rule bg-surface px-4 py-3">
      <div className="min-w-0 flex-1 basis-[14rem]">
        <p className="text-[0.9375rem] font-semibold">{label}</p>
        {detail && <div className="mt-0.5 text-[0.8125rem] leading-snug break-words text-muted-foreground">{detail}</div>}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className="grid h-8 place-items-center px-1">
      <span aria-hidden="true" className={cn('relative h-5 w-9 rounded-full transition-colors', on ? 'bg-bloom-deep' : 'bg-paper-3')}>
        <span className={cn('absolute top-0.5 size-4 rounded-full bg-paper shadow-sm transition-[left]', on ? 'left-[1.125rem]' : 'left-0.5')} />
      </span>
    </button>
  )
}

// --- agent ---------------------------------------------------------------------------------

function HarnessChoice({ h, on, onPick }: { h: HarnessInfo; on: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className={cn(
        'grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 rounded-xl border-[1.5px] bg-surface px-4 py-3 text-left transition-[border-color,box-shadow] hover:border-neutral',
        on ? 'border-ink shadow-[0_0_0_3px_var(--bloom-wash)]' : 'border-rule',
      )}
    >
      <span className={cn('mt-0.5 grid size-5 place-items-center rounded-full border-[1.5px]', on ? 'border-ink bg-ink text-paper' : 'border-neutral')} aria-hidden="true">
        {on && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-semibold">{h.name}</span>
          <span className="text-[0.8125rem] text-neutral">{h.vendor}</span>
        </span>
        <span className="mt-0.5 block truncate font-mono text-[10.5px] text-neutral">{h.path}</span>
      </span>
      {h.version && <span className="font-mono text-[10.5px] text-neutral">v{h.version}</span>}
    </button>
  )
}

function AgentSection({
  harnesses,
  current,
  workdir,
  onHarness,
  onRescan,
  onWorkdir,
  onExplore,
}: {
  harnesses: HarnessInfo[]
  current: HarnessId | null
  workdir: string
  onHarness: (id: HarnessId) => void
  onRescan: () => Promise<void>
  onWorkdir: () => void
  onExplore: () => void
}) {
  const [scanning, setScanning] = useState(false)
  const found = harnesses.filter((h) => h.found)
  const missing = harnesses.filter((h) => !h.found)
  const rescan = async () => {
    setScanning(true)
    await onRescan()
    setScanning(false)
  }
  return (
    <Section id="agent" title="Agent" about="mine hands what you say to the agent you already use, signed in the way you already are.">
      <div role="radiogroup" aria-label="Agent" className="grid gap-2">
        {found.map((h) => (
          <HarnessChoice key={h.id} h={h} on={h.id === current} onPick={() => onHarness(h.id)} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button type="button" onClick={rescan} disabled={scanning} className={quiet}>
          <RefreshCw className={cn('size-3.5', scanning && 'animate-spin')} />
          Search again
        </button>
        {missing.length > 0 && <span className="font-mono text-[10.5px] text-neutral">Also works with {missing.map((h) => h.name).join(', ')}.</span>}
      </div>
      <Row label="Working folder" detail={<span className="font-mono text-[11px]">{workdir}</span>}>
        <button type="button" onClick={onExplore} className={quiet}>
          Browse files
        </button>
        <button type="button" onClick={onWorkdir} className={quiet}>
          <FolderOpen className="size-3.5" />
          Change
        </button>
      </Row>
    </Section>
  )
}

// --- instant commands, voice, appearance -----------------------------------------------------

function InstantSection({ provider, model, onChange }: { provider: string | null; model?: string; onChange: () => void }) {
  const off = !provider || provider === 'off'
  return (
    <Section id="instant" title="Instant commands" about="A small, fast model that runs mine’s own commands straight away, so “dark mode” doesn’t wait for the agent.">
      <Row
        label={off ? 'Off' : provider}
        detail={off ? 'Everything you say goes to the agent.' : model ? <span className="font-mono text-[11px]">{model}</span> : 'Its default model.'}
      >
        <Zap className={cn('size-4', off ? 'text-neutral' : 'fill-bloom text-bloom-deep')} aria-hidden="true" />
        <button type="button" onClick={onChange} className={quiet}>
          {off ? 'Set up' : 'Change'}
        </button>
      </Row>
    </Section>
  )
}

function speechDetail(s: SpeechStatus | null) {
  if (!s) return 'Checking…'
  if (s.state === 'ready') return `${s.model}, on this computer.`
  if (s.state === 'downloading') return `Downloading ${s.model}: ${Math.round((s.received / Math.max(1, s.bytes)) * 100)}%`
  if (s.state === 'error') return s.message
  return `${s.model} isn’t downloaded yet (${Math.round(s.bytes / 1e6)} MB). Your voice never leaves this computer.`
}

function VoiceSection({ status, handsFree, onHandsFree }: { status: SpeechStatus | null; handsFree: boolean; onHandsFree: (on: boolean) => void }) {
  const [busy, setBusy] = useState(false)
  const download = async () => {
    setBusy(true)
    await window.mine.speech.prepare()
    setBusy(false)
  }
  const canDownload = status?.state === 'missing' || status?.state === 'error'
  return (
    <Section id="voice" title="Voice" about="Speech is turned into text on this computer.">
      <Row label="Always listening" detail={handsFree ? 'The mic stays on and picks you up when you talk. Space pauses it.' : 'Tap the mic or press Space to talk.'}>
        <Switch on={handsFree} label="Always listening" onChange={onHandsFree} />
      </Row>
      <Row label="Speech model" detail={speechDetail(status)}>
        {canDownload && (
          <button type="button" onClick={download} disabled={busy} className={quiet}>
            {status?.state === 'error' ? 'Try again' : 'Download'}
          </button>
        )}
      </Row>
    </Section>
  )
}

function AppearanceSection({
  mode,
  look,
  onMode,
  onThemes,
  onReset,
}: {
  mode: ThemePref
  look: string | null
  onMode: (m: ThemePref) => void
  onThemes: () => void
  onReset: () => void
}) {
  return (
    <Section id="appearance" title="Appearance">
      <Row label="Light or dark">
        <div role="radiogroup" aria-label="Light or dark" className="flex rounded-full border border-rule p-0.5">
          {MODES.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => onMode(value)}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-full px-3 text-[0.8125rem] font-semibold transition-colors',
                mode === value ? 'bg-solid text-on-solid' : 'text-muted-foreground hover:text-ink',
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Theme" detail={look ?? 'mine’s own look.'}>
        <button type="button" onClick={onReset} className={quiet}>
          Reset
        </button>
        <button type="button" onClick={onThemes} className={quiet}>
          Browse themes
        </button>
      </Row>
    </Section>
  )
}

// --- connections ---------------------------------------------------------------------------

function ConnectionsSection({ state, onConnect, onDescribe }: { state: ConnectionsState | null; onConnect: () => void; onDescribe: () => void }) {
  const list = state?.connections ?? []
  const kinds = (Object.keys(WAYS) as Connection['way']['kind'][]).filter((k) => list.some((c) => c.way.kind === k))
  const connected = list.filter((c) => c.status === 'connected').length
  return (
    <Section
      id="connections"
      title="Connections"
      about={list.length ? `${connected} of ${list.length} connected. Their data keeps your widgets up to date.` : 'The tools you use every day, joined to mine so widgets can show your real data.'}
    >
      {kinds.map((k) => (
        <div key={k} className="flex flex-col gap-2">
          <div className="mt-1">
            <h4 className="font-mono text-[10.5px] text-neutral uppercase">{WAYS[k].title}</h4>
            <p className="text-[0.8125rem] text-muted-foreground">{WAYS[k].about}</p>
          </div>
          {list
            .filter((c) => c.way.kind === k)
            .map((c) => (
              <ConnectionCard key={c.id} c={c} service={state?.services.find((s) => s.id === c.service)} sources={state?.sources ?? []} />
            ))}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onConnect} className={list.length ? quiet : solid}>
          <Plus className="size-3.5" />
          Connect a tool
        </button>
        <button type="button" onClick={onDescribe} className={quiet}>
          Tell mine about your day
        </button>
      </div>
    </Section>
  )
}

// --- permissions ---------------------------------------------------------------------------

function byFolder(rules: PermissionRule[]) {
  const groups = new Map<string, PermissionRule[]>()
  for (const r of rules) {
    const key = [...groups.keys()].find((f) => sameFolder(f, r.folder)) ?? r.folder
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  return [...groups.entries()]
}

function PermissionsSection({
  rules,
  workdir,
  onStopAllowAll,
  onForget,
}: {
  rules: PermissionRule[]
  workdir: string
  onStopAllowAll: () => void
  onForget: (folder?: string) => void
}) {
  const allowingAll = rules.some((r) => r.tool === ALL && sameFolder(r.folder, workdir))
  const groups = byFolder(rules)
  return (
    <Section id="permissions" title="Permissions" about="Agents ask before running commands, editing files or fetching pages. Here’s what you’ve said they can always do.">
      {allowingAll && (
        <Row label="Allowing everything here" detail="Agents don’t ask before anything in the working folder.">
          <ShieldCheck className="size-4 text-bloom-deep" aria-hidden="true" />
          <button type="button" onClick={onStopAllowAll} className={quiet}>
            Make them ask again
          </button>
        </Row>
      )}
      {groups.length === 0 && <p className="text-[0.875rem] text-muted-foreground">Nothing yet. Agents ask before anything beyond reading files.</p>}
      {groups.map(([folder, list]) => (
        <Row
          key={folder}
          label={list.length === 1 ? '1 thing always allowed' : `${list.length} things always allowed`}
          detail={
            <>
              <span className="block font-mono text-[11px]">{folder}</span>
              <span className="mt-1.5 flex flex-wrap gap-1">
                {list.map((r) => (
                  <span key={`${r.tool}${r.prefix ?? ''}${r.domain ?? ''}`} className="rounded-full bg-paper-2 px-2 py-0.5 font-mono text-[10.5px] text-ink">
                    {describeRule(r).replace(/`/g, '')}
                  </span>
                ))}
              </span>
            </>
          }
        >
          <button type="button" onClick={() => onForget(folder)} className={quiet}>
            Forget
          </button>
        </Row>
      ))}
      {groups.length > 1 && (
        <button type="button" onClick={() => onForget()} className={cn(quiet, 'self-start')}>
          Forget them all
        </button>
      )}
    </Section>
  )
}

// --- about and updates ---------------------------------------------------------------------

const since = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

function updateDetail(u: UpdateState | null): string {
  if (!u || u.state === 'idle') return 'mine checks the latest release on GitHub for a new version.'
  if (u.state === 'off') return u.reason
  if (u.state === 'checking') return 'Checking for a new version…'
  if (u.state === 'current') return `You’re on the latest version. Checked ${since(u.checkedAt)}.`
  if (u.state === 'available' && u.manual) return `Version ${u.version} is out. This Mac can’t update mine by itself yet, so download it from GitHub and drag it into Applications.`
  if (u.state === 'available') return `Version ${u.version} is out. Getting it ready…`
  if (u.state === 'downloading') return `Downloading version ${u.version}: ${u.percent}%`
  if (u.state === 'ready') return `Version ${u.version} is ready. It installs next time mine restarts.`
  return u.message
}

function UpdateActions({ u, onCheck, onInstall, onDownload }: { u: UpdateState | null; onCheck: () => void; onInstall: () => void; onDownload: () => void }) {
  if (u?.state === 'off') return null
  if (u?.state === 'ready')
    return (
      <button type="button" onClick={onInstall} className={solid}>
        <RotateCw className="size-3.5" />
        Restart and update
      </button>
    )
  if (u?.state === 'available' && u.manual)
    return (
      <button type="button" onClick={onDownload} className={solid}>
        <Download className="size-3.5" />
        Download {u.version}
      </button>
    )
  const busy = u?.state === 'checking' || u?.state === 'downloading' || u?.state === 'available'
  return (
    <button type="button" onClick={onCheck} disabled={busy} className={quiet}>
      <RefreshCw className={cn('size-3.5', busy && 'animate-spin')} />
      {u?.state === 'error' ? 'Try again' : 'Check now'}
    </button>
  )
}

function AboutSection({
  update,
  autoUpdate,
  onAutoUpdate,
  onCheck,
  onInstall,
  onDownload,
}: {
  update: UpdateState | null
  autoUpdate: boolean
  onAutoUpdate: (on: boolean) => void
  onCheck: () => void
  onInstall: () => void
  onDownload: () => void
}) {
  return (
    <Section id="about" title="About" about="Your settings, screens and conversations are kept on this computer.">
      <Row label={`mine ${__MINE_VERSION__}`} detail={updateDetail(update)}>
        <UpdateActions u={update} onCheck={onCheck} onInstall={onInstall} onDownload={onDownload} />
      </Row>
      {update?.state !== 'off' && (
        <Row
          label="Update automatically"
          detail={autoUpdate ? 'Every few hours mine looks for a new release and gets it ready in the background.' : 'mine only looks for a new version when you check.'}
        >
          <Switch on={autoUpdate} label="Update automatically" onChange={onAutoUpdate} />
        </Row>
      )}
    </Section>
  )
}

// --- the page ------------------------------------------------------------------------------

function SectionNav({ current, onGo }: { current: SettingsSection; onGo: (s: SettingsSection) => void }) {
  return (
    <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto pb-1 md:sticky md:top-8 md:flex-col md:overflow-visible md:pb-0">
      {(Object.entries(SETTINGS_SECTIONS) as [SettingsSection, string][]).map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onGo(id)}
          aria-current={id === current ? 'true' : undefined}
          className={cn(
            'shrink-0 rounded-full px-3 py-1.5 text-left text-[0.875rem] font-medium whitespace-nowrap transition-colors hover:bg-paper-2 hover:text-ink md:rounded-lg',
            id === current ? 'bg-paper-2 text-ink' : 'text-muted-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </nav>
  )
}

export type SettingsPageProps = {
  /** Which section to bring into view; `n` changes each time it's asked for. */
  at: { section: SettingsSection; n: number } | null
  backTo: string | null
  onBack: () => void
  harnesses: HarnessInfo[]
  harness: HarnessId | null
  workdir: string
  onHarness: (id: HarnessId) => void
  onRescan: () => Promise<void>
  onWorkdir: () => void
  onExplore: () => void
  decisions: { provider: string | null; model?: string }
  onDecisions: () => void
  speech: SpeechStatus | null
  handsFree: boolean
  onHandsFree: (on: boolean) => void
  mode: ThemePref
  look: string | null
  onMode: (m: ThemePref) => void
  onThemes: () => void
  onResetLook: () => void
  connections: ConnectionsState | null
  onConnect: () => void
  onDescribe: () => void
  rules: PermissionRule[]
  onStopAllowAll: () => void
  onForget: (folder?: string) => void
  update: UpdateState | null
  autoUpdate: boolean
  onAutoUpdate: (on: boolean) => void
  onCheckUpdate: () => void
  onInstallUpdate: () => void
  onDownloadUpdate: () => void
}

/** The section at the top of the view, as the page scrolls. */
function useCurrentSection(scroller: RefObject<HTMLDivElement | null>) {
  const [current, setCurrent] = useState<SettingsSection>('agent')
  useEffect(() => {
    const root = scroller.current
    if (!root) return
    const pick = () => {
      const top = root.getBoundingClientRect().top + 96
      const ids = Object.keys(SETTINGS_SECTIONS) as SettingsSection[]
      const atEnd = root.scrollTop + root.clientHeight >= root.scrollHeight - 4
      const passed = ids.filter((id) => (root.querySelector(`#settings-${id}`)?.getBoundingClientRect().top ?? Infinity) <= top)
      setCurrent(atEnd ? ids[ids.length - 1] : (passed[passed.length - 1] ?? ids[0]))
    }
    pick()
    root.addEventListener('scroll', pick, { passive: true })
    return () => root.removeEventListener('scroll', pick)
  }, [scroller])
  return current
}

export function SettingsPage(p: SettingsPageProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const current = useCurrentSection(scroller)
  const go = (s: SettingsSection) => scroller.current?.querySelector(`#settings-${s}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  useEffect(() => {
    if (p.at) go(p.at.section)
  }, [p.at])

  return (
    <div ref={scroller} className="scroll-soft h-full overflow-y-auto">
      <div className="mx-auto max-w-[56rem] px-6 pt-8 pb-36">
        <button
          type="button"
          onClick={p.onBack}
          className="-ml-1 inline-flex items-center gap-1.5 rounded-full px-1 py-0.5 font-mono text-[10.5px] text-neutral uppercase transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-3.5" /> {p.backTo ? `Back to ${p.backTo}` : 'Back'}
        </button>
        <h2 className="mt-3 font-display text-[clamp(2rem,1.5rem+1.8vw,2.75rem)] leading-[1.02] font-semibold tracking-[-0.04em]">Settings</h2>
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-10">
          <div>
            <SectionNav current={current} onGo={go} />
          </div>
          <div className="min-w-0">
            <AgentSection
              harnesses={p.harnesses}
              current={p.harness}
              workdir={p.workdir}
              onHarness={p.onHarness}
              onRescan={p.onRescan}
              onWorkdir={p.onWorkdir}
              onExplore={p.onExplore}
            />
            <InstantSection provider={p.decisions.provider} model={p.decisions.model} onChange={p.onDecisions} />
            <VoiceSection status={p.speech} handsFree={p.handsFree} onHandsFree={p.onHandsFree} />
            <AppearanceSection mode={p.mode} look={p.look} onMode={p.onMode} onThemes={p.onThemes} onReset={p.onResetLook} />
            <ConnectionsSection state={p.connections} onConnect={p.onConnect} onDescribe={p.onDescribe} />
            <PermissionsSection rules={p.rules} workdir={p.workdir} onStopAllowAll={p.onStopAllowAll} onForget={p.onForget} />
            <AboutSection
              update={p.update}
              autoUpdate={p.autoUpdate}
              onAutoUpdate={p.onAutoUpdate}
              onCheck={p.onCheckUpdate}
              onInstall={p.onInstallUpdate}
              onDownload={p.onDownloadUpdate}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
