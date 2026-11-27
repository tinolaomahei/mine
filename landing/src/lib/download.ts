import { useEffect, useState } from 'react'

// The latest mine release on GitHub, and which of its files suits this computer.

export const REPO = 'https://github.com/tinolaomahei/mine'
export const RELEASES = `${REPO}/releases/latest`
const API = 'https://api.github.com/repos/tinolaomahei/mine/releases/latest'

export type Build = 'windows' | 'mac-arm64' | 'mac-x64' | 'appimage' | 'deb' | 'rpm'
export type Platform = 'windows' | 'mac' | 'linux' | 'other'

export const BUILDS: Record<Build, { label: string; os: string; match: RegExp }> = {
  windows: { label: 'Windows', os: 'Windows', match: /-win-x64\.exe$/ },
  'mac-arm64': { label: 'Mac with Apple silicon', os: 'Mac', match: /-mac-arm64\.dmg$/ },
  'mac-x64': { label: 'Mac with Intel', os: 'Mac', match: /-mac-x64\.dmg$/ },
  appimage: { label: 'Linux AppImage', os: 'Linux', match: /\.AppImage$/ },
  deb: { label: 'Linux .deb', os: 'Linux', match: /\.deb$/ },
  rpm: { label: 'Linux .rpm', os: 'Linux', match: /\.rpm$/ },
}

export type File = { url: string; size: number }
export type Release = { version: string; name: string; files: Partial<Record<Build, File>> }

type Asset = { name: string; browser_download_url: string; size: number }
type ApiRelease = { tag_name: string; name: string | null; assets: Asset[] }

type UAData = {
  platform?: string
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>
}

function platform(): Platform {
  const data = (navigator as Navigator & { userAgentData?: UAData }).userAgentData
  const said = `${data?.platform ?? ''} ${navigator.userAgent}`
  if (/Android|iPhone|iPad|iPod/i.test(said) || (/Mac/i.test(said) && navigator.maxTouchPoints > 1)) return 'other'
  if (/Win/i.test(said)) return 'windows'
  if (/Mac/i.test(said)) return 'mac'
  if (/Linux|X11|CrOS/i.test(said)) return 'linux'
  return 'other'
}

function gpuSays(): 'arm64' | 'x64' | null {
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    const renderer = info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ''
    if (/Apple M\d/i.test(renderer)) return 'arm64'
    if (/Intel|AMD|Radeon/i.test(renderer)) return 'x64'
  } catch {
    return null
  }
  return null
}

/** Apple silicon or Intel, when the browser lets on. Safari doesn't, so it's a guess there. */
async function macChip(): Promise<{ chip: 'arm64' | 'x64'; sure: boolean }> {
  const data = (navigator as Navigator & { userAgentData?: UAData }).userAgentData
  try {
    const arch = (await data?.getHighEntropyValues?.(['architecture']))?.architecture
    if (arch === 'arm') return { chip: 'arm64', sure: true }
    if (arch === 'x86') return { chip: 'x64', sure: true }
  } catch {
    /* not offered: fall through to the GPU */
  }
  const gpu = gpuSays()
  return gpu ? { chip: gpu, sure: true } : { chip: 'arm64', sure: false }
}

export type Pick = { platform: Platform; build: Build | null; sure: boolean }

async function pickBuild(): Promise<Pick> {
  const p = platform()
  if (p === 'windows') return { platform: p, build: 'windows', sure: true }
  if (p === 'linux') return { platform: p, build: 'appimage', sure: true }
  if (p !== 'mac') return { platform: p, build: null, sure: false }
  const { chip, sure } = await macChip()
  return { platform: p, build: chip === 'arm64' ? 'mac-arm64' : 'mac-x64', sure }
}

function toRelease(r: ApiRelease): Release {
  const files: Release['files'] = {}
  for (const [build, { match }] of Object.entries(BUILDS) as [Build, (typeof BUILDS)[Build]][]) {
    const a = r.assets.find((x) => match.test(x.name))
    if (a) files[build] = { url: a.browser_download_url, size: a.size }
  }
  const tree = r.name?.split('·')[1]?.trim()
  return { version: r.tag_name.replace(/^v/, ''), name: tree ?? '', files }
}

let latest: Promise<Release | null> | undefined
const fetchLatest = () =>
  (latest ??= fetch(API, { headers: { Accept: 'application/vnd.github+json' } })
    .then((res) => (res.ok ? (res.json() as Promise<ApiRelease>) : null))
    .then((r) => (r ? toRelease(r) : null))
    .catch(() => null))

/** The latest release and the build for this computer; links fall back to the releases page. */
export function useDownload() {
  const [release, setRelease] = useState<Release | null>(null)
  const [pick, setPick] = useState<Pick | null>(null)
  useEffect(() => {
    let live = true
    void fetchLatest().then((r) => live && setRelease(r))
    void pickBuild().then((p) => live && setPick(p))
    return () => {
      live = false
    }
  }, [])
  const href = (b: Build | null) => (b && release?.files[b]?.url) || RELEASES
  return { release, pick, href }
}

export const megabytes = (bytes: number) => `${Math.round(bytes / 1e6)} MB`
