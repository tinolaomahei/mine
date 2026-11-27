// System One decision models: fast, typed answers with probabilities instead
// of generated text. mine uses one as a fast intent layer in front of the
// agent. Providers differ in wire format; everything else is provider-agnostic.

export type DecisionProviderId = 'typesafe' | 'openai' | 'openrouter'

/** systemone: TypeSafe's shape (state + keyed questions), also served by OpenRouter. openai: input + question list. */
export type DecisionFormat = 'systemone' | 'openai'

export type DecisionProvider = {
  id: DecisionProviderId
  name: string
  vendor: string
  blurb: string
  baseUrl: string
  path: string
  format: DecisionFormat
  defaultModel: string
  models: string[]
  keyUrl: string
  keyLabel: string
}

export const DECISION_PROVIDERS: DecisionProvider[] = [
  {
    id: 'typesafe',
    name: 'Jev',
    vendor: 'TypeSafe',
    blurb: 'The first System One model. Typed answers with probabilities; you pay for input only.',
    baseUrl: 'https://api.typesafe.ai',
    path: '/v1/systemone',
    format: 'systemone',
    defaultModel: 'jev-latest',
    models: ['jev-latest', 'jev-1.14.0', 'jev-1.13.0'],
    keyUrl: 'https://docs.typesafe.ai/introduction/quickstart',
    keyLabel: 'TypeSafe API key',
  },
  {
    id: 'openai',
    name: 'Decisions API',
    vendor: 'OpenAI',
    blurb: 'OpenAI’s fast decision layer on gpt-6-luna. Same key as the rest of the OpenAI API.',
    baseUrl: 'https://api.openai.com',
    path: '/v1/decisions',
    format: 'openai',
    defaultModel: 'gpt-6-luna',
    models: ['gpt-6-luna'],
    keyUrl: 'https://platform.openai.com/api-keys',
    keyLabel: 'OpenAI API key',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    vendor: 'OpenRouter',
    blurb: 'One key for Jev, OpenAI’s decisions model and about twenty others. The endpoint is still in alpha.',
    baseUrl: 'https://openrouter.ai',
    path: '/api/alpha/decisions',
    format: 'systemone',
    defaultModel: 'typesafe/jev-1.14',
    models: [
      'typesafe/jev-1.14',
      'openai/gpt-6-luna-decisions',
      'cloudflare/clef-flash',
      'perplexity/pplx-decider-flash-v1.2',
      'liquid/d1.2',
      'inception/mercury-decide',
    ],
    keyUrl: 'https://openrouter.ai/keys',
    keyLabel: 'OpenRouter API key',
  },
]

export function decisionProvider(id: DecisionProviderId) {
  const p = DECISION_PROVIDERS.find((x) => x.id === id)
  if (!p) throw new Error(`Unknown decisions provider: ${id}`)
  return p
}

/** Stored in settings. null means the person hasn't been asked yet. */
export type DecisionsSettings = { provider: DecisionProviderId | 'off'; model?: string; baseUrl?: string }

// ── the fast intent layer ─────────────────────────────────────────────────

/** Things mine can do itself, instantly, without the agent. */

export type RouteContext = {
  workdir?: string
  appearance: 'system' | 'light' | 'dark'
  harness: string | null
  harnesses: { id: string; name: string }[]
  running: boolean
}

export type RouteResult =
  | { kind: 'agent'; ms?: number; error?: string }
  /** A command (mine's own or the person's), with its choices made. */
  | { kind: 'command'; name: string; title: string; params: Record<string, string>; confidence: number; ms: number; model: string; provider: string }
  /** Open one of the person's widgets. */
  | { kind: 'widget'; name: string; title: string; confidence: number; ms: number; model: string; provider: string }

export type DecisionsStatus = {
  settings: DecisionsSettings | null
  /** Which providers have a saved key. The keys themselves never leave the main process. */
  keys: Partial<Record<DecisionProviderId, boolean>>
  /** False when the OS can't encrypt secrets; keys are then kept for this session only. */
  canEncrypt: boolean
}

export type DecisionsTest =
  | { ok: true; ms: number; model: string; heard: string }
  | { ok: false; error: string }
