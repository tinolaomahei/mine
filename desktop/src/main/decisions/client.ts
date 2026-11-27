import type { DecisionFormat } from '@shared/decisions'

// One provider-agnostic call: a piece of state and some typed questions in,
// normalised answers out. Only the wire format differs between providers.

export type Question =
  | { key: string; kind: 'choice'; instructions: string; options: { value: string; description: string }[] }
  | { key: string; kind: 'yesno'; instructions: string }

export type Answer =
  | { kind: 'choice'; value: string; confidence: number; probabilities: Record<string, number> }
  | { kind: 'yesno'; probability: number }
  | { kind: 'none' } // refusal, or missing

export type Decision = { answers: Record<string, Answer>; model: string; ms: number }

export type Endpoint = { url: string; format: DecisionFormat; model: string; key: string }

type Json = Record<string, any>

function body(format: DecisionFormat, model: string, state: string, questions: Question[]): Json {
  if (format === 'systemone')
    return {
      model,
      state,
      questions: Object.fromEntries(
        questions.map((q) => [
          q.key,
          q.kind === 'choice'
            ? { type: 'choice', instructions: q.instructions, criteria: Object.fromEntries(q.options.map((o) => [o.value, o.description])) }
            : { type: 'noul', instructions: q.instructions },
        ]),
      ),
    }
  return {
    model,
    input: state,
    questions: questions.map((q) =>
      q.kind === 'choice'
        ? { type: 'choice', name: q.key, instructions: q.instructions, choices: q.options.map((o) => ({ value: o.value, description: o.description })) }
        : { type: 'predicate', name: q.key, instructions: q.instructions },
    ),
  }
}

const top = (probs: Record<string, number>) => Math.max(0, ...Object.values(probs))

function normalise(format: DecisionFormat, res: Json): Record<string, Answer> {
  const out: Record<string, Answer> = {}
  if (format === 'systemone') {
    for (const [key, a] of Object.entries((res.answers ?? {}) as Record<string, Json>)) {
      if (a?.type === 'choice' && typeof a.choice === 'string') {
        const probabilities = (a.probabilities ?? {}) as Record<string, number>
        out[key] = { kind: 'choice', value: a.choice, probabilities, confidence: typeof a.confidence === 'number' ? a.confidence : top(probabilities) }
      } else if (a?.type === 'noul' && typeof a.noul === 'number') out[key] = { kind: 'yesno', probability: a.noul }
      else out[key] = { kind: 'none' }
    }
    return out
  }
  for (const a of (res.answers ?? []) as Json[]) {
    if (!a?.name) continue
    if (a.type === 'choice' && a.choice !== undefined) {
      const probabilities = Object.fromEntries(((a.probabilities ?? []) as Json[]).map((p) => [String(p.value), Number(p.probability)]))
      out[a.name] = {
        kind: 'choice',
        value: String(a.choice),
        probabilities,
        confidence: typeof a.confidence === 'number' ? a.confidence : top(probabilities),
      }
    } else if (a.type === 'predicate' && typeof a.probability === 'number') out[a.name] = { kind: 'yesno', probability: a.probability }
    else out[a.name] = { kind: 'none' }
  }
  return out
}

function explain(status: number, text: string) {
  let detail = text.slice(0, 300)
  try {
    const j = JSON.parse(text)
    const d = j.error?.message ?? j.detail ?? j.message
    if (d) detail = typeof d === 'string' ? d : JSON.stringify(d).slice(0, 300)
  } catch {
    /* not JSON */
  }
  if (status === 401) return `The key was rejected (401). ${detail}`
  if (status === 402) return `The account needs credit (402). ${detail}`
  if (status === 403) return `This key can’t use the decisions endpoint (403). ${detail}`
  if (status === 404) return `Endpoint or model not found (404). ${detail}`
  if (status === 429) return `Rate limited (429). Try again in a moment.`
  return `The provider returned ${status}. ${detail}`
}

/** Providers want at least two options per choice; a lone option gets a "none" beside it. */
const padded = (qs: Question[]): Question[] =>
  qs.map((q) => (q.kind === 'choice' && q.options.length < 2 ? { ...q, options: [...q.options, { value: '-', description: 'None of these' }] } : q))

export async function decide(ep: Endpoint, state: string, questions: Question[], timeoutMs: number): Promise<Decision> {
  questions = padded(questions)
  const started = performance.now()
  const res = await fetch(ep.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ep.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body(ep.format, ep.model, state, questions)),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  const ms = Math.round(performance.now() - started)
  if (!res.ok) throw new Error(explain(res.status, text))
  let json: Json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('The provider sent back something that isn’t JSON.')
  }
  return { answers: normalise(ep.format, json), model: String(json.model ?? ep.model), ms }
}
