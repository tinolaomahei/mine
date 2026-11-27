import { BUILDS, RELEASES, megabytes, useDownload, type Build, type Pick } from '../lib/download'

const NOTE: Record<string, string> = {
  windows: 'Windows will say it’s from an unknown publisher. Click More info, then Run anyway.',
  mac: 'The first time you open it, go to System Settings, then Privacy & Security, and click Open Anyway.',
  linux: 'Make the AppImage executable and run it, or install the .deb or .rpm.',
}

const OTHERS: Build[] = ['windows', 'mac-arm64', 'mac-x64', 'appimage', 'deb', 'rpm']

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="dl-icon">
      <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" fill="none" />
    </svg>
  )
}

function mainLabel(pick: Pick | null) {
  if (!pick?.build) return 'Download mine'
  return `Download for ${BUILDS[pick.build].os}`
}

/** The one button for this computer, used in the hero and the download section. */
export function DownloadButton({ className = '' }: { className?: string }) {
  const { pick, href } = useDownload()
  return (
    <a className={`btn btn-solid btn-download ${className}`} href={href(pick?.build ?? null)}>
      <DownloadIcon />
      {mainLabel(pick)}
    </a>
  )
}

export function Download() {
  const { release, pick, href } = useDownload()
  const build = pick?.build ?? null
  const file = build ? release?.files[build] : undefined
  const chipNote = pick?.platform === 'mac' && build ? BUILDS[build].label : null
  const others = OTHERS.filter((b) => b !== build)

  return (
    <section className="section download" id="download" aria-labelledby="download-title">
      <h2 id="download-title" className="h2">
        Download mine.
      </h2>
      <p className="body">
        It’s free and open source, for Windows, Mac and Linux. You’ll need an agent like Claude Code installed and signed
        in.
      </p>

      <div className="dl-main">
        <a className="btn btn-solid btn-download" href={href(build)}>
          <DownloadIcon />
          {mainLabel(pick)}
        </a>
        <p className="dl-meta mono">
          {[release && `Version ${release.version}`, release?.name, chipNote, file && megabytes(file.size)].filter(Boolean).join(' · ') ||
            'Latest release'}
        </p>
      </div>
      {pick?.platform === 'mac' && !pick.sure && (
        <p className="dl-hint">
          On a Mac with an Intel chip?{' '}
          <a href={href('mac-x64')} className="dl-link">
            Get the Intel version
          </a>
          .
        </p>
      )}
      {pick?.platform === 'other' && <p className="dl-hint">mine runs on desktop computers. Pick yours below.</p>}
      {pick && NOTE[pick.platform] && <p className="dl-hint">{NOTE[pick.platform]}</p>}

      <ul className="dl-others" aria-label="Other downloads">
        {others.map((b) => (
          <li key={b}>
            <a href={href(b)} className="dl-link">
              {BUILDS[b].label}
            </a>
          </li>
        ))}
        <li>
          <a href={RELEASES} className="dl-link">
            Release notes and every file
          </a>
        </li>
      </ul>
    </section>
  )
}
