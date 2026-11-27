import { ipcMain } from 'electron'
import {
  DECISION_PROVIDERS,
  decisionProvider,
  type DecisionProviderId,
  type DecisionsSettings,
  type DecisionsStatus,
  type DecisionsTest,
  type RouteContext,
  type RouteResult,
} from '@shared/decisions'
import { getSettings, setSettings } from '../settings'
import { canEncrypt, getSecret, hasSecret, setSecret } from '../secrets'
import { allCommands, commandOptions } from '../commands'
import { widgets } from '../widgets'
import { decide, type Endpoint } from './client'
import { interpret, PARAM_MIN, routePlan, routeState, type Picked, type Targets } from './route'

// Requests from the window go through here. Keys stay on this side.

const keyName = (id: DecisionProviderId) => `decisions.${id}`

// A fast layer that's slow is worse than none: past this, the agent gets it.
const ROUTE_TIMEOUT_MS = 2500
const TEST_TIMEOUT_MS = 20000

function endpoint(s: DecisionsSettings, key: string): Endpoint {
  if (s.provider === 'off') throw new Error('Decisions are off')
  const p = decisionProvider(s.provider)
  const base = (s.baseUrl?.trim() || p.baseUrl).replace(/\/+$/, '')
  return { url: base + p.path, format: p.format, model: s.model?.trim() || p.defaultModel, key }
}

function status(): DecisionsStatus {
  return {
    settings: getSettings().decisions ?? null,
    keys: Object.fromEntries(DECISION_PROVIDERS.map((p) => [p.id, hasSecret(keyName(p.id))])),
    canEncrypt: canEncrypt(),
  }
}

const SAMPLE: RouteContext = {
  appearance: 'light',
  harness: 'claude',
  harnesses: [
    { id: 'claude', name: 'Claude Code' },
    { id: 'pi', name: 'Pi' },
  ],
  running: false,
}

/** The test asks about light and dark mode, so it works even before the window has registered its commands. */
const SAMPLE_TARGETS = (): Targets => {
  const app = allCommands()
  if (app.some((c) => c.name === 'set-appearance')) return { commands: app, widgets: [] }
  return {
    widgets: [],
    commands: [
      {
        name: 'set-appearance',
        title: 'Light or dark',
        description: 'Switch mine to light mode, dark mode, or following the system setting.',
        examples: ['dark mode', 'switch to light mode'],
        params: {
          mode: {
            description: 'Which mode',
            options: [
              { value: 'light', description: 'Light mode' },
              { value: 'dark', description: 'Dark mode' },
              { value: 'system', description: 'Follow the computer’s setting' },
            ],
          },
        },
        canUndo: true,
        source: 'app',
      },
    ],
  }
}

const describe = (r: RouteResult) => {
  if (r.kind === 'agent') return 'a job for the agent'
  const sure = `${Math.round(r.confidence * 100)}% sure`
  if (r.kind === 'widget') return `show ${r.title} (${sure})`
  const ps = Object.values(r.params)
  return `${r.title.toLowerCase()}${ps.length ? `: ${ps.join(', ')}` : ''} (${sure})`
}

export function wireDecisions() {
  ipcMain.handle('decisions:status', () => status())

  /** Check the key with one real request, and only save if it works. */
  ipcMain.handle('decisions:save', async (_e, s: DecisionsSettings, key?: string): Promise<DecisionsTest> => {
    if (s.provider === 'off') {
      setSettings({ decisions: { provider: 'off' } })
      return { ok: true, ms: 0, model: '', heard: '' }
    }
    const useKey = key?.trim() || getSecret(keyName(s.provider))
    if (!useKey) return { ok: false, error: 'Paste an API key first.' }
    const said = 'switch to dark mode please'
    try {
      const t = SAMPLE_TARGETS()
      const plan = routePlan(SAMPLE, t)
      const d = await decide(endpoint(s, useKey), routeState(said, SAMPLE), plan.questions, TEST_TIMEOUT_MS)
      const r = interpret(d, SAMPLE, s.provider, plan, t)
      if (key?.trim()) setSecret(keyName(s.provider), key.trim())
      setSettings({ decisions: { provider: s.provider, model: s.model?.trim() || undefined, baseUrl: s.baseUrl?.trim() || undefined } })
      return { ok: true, ms: d.ms, model: d.model, heard: `“${said}” → ${describe(r)}` }
    } catch (err) {
      const e = err as Error
      return { ok: false, error: e.name === 'TimeoutError' ? 'No answer within 20 seconds.' : e.message }
    }
  })

  ipcMain.handle('decisions:route', async (_e, text: string, ctx: RouteContext): Promise<RouteResult> => {
    const s = getSettings().decisions
    if (!s || s.provider === 'off') return { kind: 'agent' }
    const key = getSecret(keyName(s.provider))
    if (!key) return { kind: 'agent', error: 'No key saved for the decisions provider.' }
    try {
      const ep = endpoint(s, key)
      const t: Targets = { commands: allCommands(), widgets: widgets() }
      const plan = routePlan(ctx, t)
      const state = routeState(text, ctx)
      const d = await decide(ep, state, plan.questions, ROUTE_TIMEOUT_MS)
      const r = interpret(d, ctx, decisionProvider(s.provider).name, plan, t)
      if (!('picked' in r)) return r
      const { picked, ...result } = r as RouteResult & { picked: Picked }
      if (!picked.missing.length) return result
      // choices that depend on the moment (e.g. which subfolder): one more quick call
      const asks = await Promise.all(
        picked.missing.map(async (param) => ({ param, options: await commandOptions(picked.name, param, text) })),
      )
      const info = t.commands.find((c) => c.name === picked.name)!
      const d2 = await decide(
        ep,
        state,
        asks.map(({ param, options }) => ({
          key: param,
          kind: 'choice' as const,
          instructions: `The request is to ${picked.title.toLowerCase()}. ${info.params[param].description}?`,
          options,
        })),
        ROUTE_TIMEOUT_MS,
      )
      const params = { ...picked.params }
      for (const { param, options } of asks) {
        const a = d2.answers[param]
        if (a?.kind !== 'choice' || a.confidence < PARAM_MIN || !options.some((o) => o.value === a.value)) return { kind: 'agent', ms: d.ms + d2.ms }
        params[param] = a.value
      }
      return { ...result, params, ms: d.ms + d2.ms } as RouteResult
    } catch (err) {
      // never block the person: on any failure the agent takes it
      return { kind: 'agent', error: (err as Error).message }
    }
  })
}
