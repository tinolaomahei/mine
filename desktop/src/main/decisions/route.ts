import type { CommandInfo } from '@shared/commands'
import type { RouteContext, RouteResult } from '@shared/decisions'
import type { WidgetInfo } from '@shared/widgets'
import type { Decision, Question } from './client'

/** What the person has added: their commands and widgets. */
export type Targets = { commands: CommandInfo[]; widgets: WidgetInfo[] }
/** Which answer key holds which command parameter. */
type ParamKey = { key: string; command: string; param: string }
export type Plan = { questions: Question[]; params: ParamKey[] }

const said = (examples: string[]) => (examples.length ? ` For example: ${examples.map((e) => `“${e}”`).join(', ')}.` : '')

// The fast intent layer. One decision request asks, in parallel: is this one
// of the few things mine can do itself, and if so with which setting? Anything
// uncertain goes to the agent. A wrong instant action is worse than a slower
// right one, so the bar is high.

const ACTION_MIN = 0.72
export const PARAM_MIN = 0.6

const AGENT = {
  value: 'agent',
  description:
    'Anything that needs real work or thought: questions, tasks, files, code, research, writing, restyling or rebranding the app, changing specific colours or fonts, building something new into mine. Choose this whenever unsure, or when the request asks for more than one of the commands below.',
}

export function routePlan(_ctx: RouteContext, t: Targets = { commands: [], widgets: [] }): Plan {
  const params: ParamKey[] = []
  const options = [
    AGENT,
    ...t.commands.map((c) => ({ value: `c:${c.name}`, description: c.description + said(c.examples) })),
    ...t.widgets
      .filter((w) => w.approved && !w.error)
      .map((w) => ({ value: `w:${w.id}`, description: `Show the “${w.title}” widget. ${w.description}${said(w.examples)}` })),
  ]
  const qs: Question[] = [
    {
      key: 'action',
      kind: 'choice',
      instructions:
        'The person said this request to mine, a desktop app that hands work to an AI agent. Is it exactly one of the app’s own commands, or should the agent handle it?',
      options,
    },
  ]
  // choices with fixed options are answered in the same call; the rest come after
  for (const c of t.commands)
    for (const [param, p] of Object.entries(c.params)) {
      if (!p.options) continue
      const key = `p${params.length}`
      params.push({ key, command: c.name, param })
      qs.push({ key, kind: 'choice', instructions: `If the request is to ${c.title.toLowerCase()}: ${p.description}`, options: p.options })
    }
  return { questions: qs, params }
}

export const routeQuestions = (ctx: RouteContext, t?: Targets) => routePlan(ctx, t).questions

export function routeState(text: string, ctx: RouteContext) {
  return `Request: "${text}"
${ctx.workdir ? `Working folder: ${ctx.workdir}
` : ''}App now: ${ctx.appearance === 'system' ? 'following the system for light/dark' : `${ctx.appearance} mode`}; agent ${
    ctx.harnesses.find((h) => h.id === ctx.harness)?.name ?? 'none'
  }; ${ctx.running ? 'the agent is working' : 'the agent is idle'}.`
}

/** A command the model picked, and which of its choices still need asking. */
export type Picked = { name: string; title: string; params: Record<string, string>; missing: string[] }

export function interpret(d: Decision, _ctx: RouteContext, provider: string, plan?: Plan, t?: Targets): RouteResult | (RouteResult & { picked: Picked }) {
  const a = d.answers.action
  if (a?.kind !== 'choice' || a.value === 'agent' || a.confidence < ACTION_MIN) return { kind: 'agent', ms: d.ms }
  const meta = { confidence: a.confidence, ms: d.ms, model: d.model, provider }

  if (a.value.startsWith('w:')) {
    const w = t?.widgets.find((x) => x.id === a.value.slice(2))
    return w ? { kind: 'widget', name: w.id, title: w.title, ...meta } : { kind: 'agent', ms: d.ms }
  }
  if (a.value.startsWith('c:')) {
    const c = t?.commands.find((x) => x.name === a.value.slice(2))
    if (!c) return { kind: 'agent', ms: d.ms }
    const params: Record<string, string> = {}
    const missing: string[] = []
    for (const [param, p] of Object.entries(c.params)) {
      if (p.dynamic) {
        missing.push(param)
        continue
      }
      // free text (a name, say): the agent fills it if it's needed, otherwise it's left out
      if (p.text) {
        if (p.required) return { kind: 'agent', ms: d.ms }
        continue
      }
      const key = plan?.params.find((k) => k.command === c.name && k.param === param)?.key
      const ans = key ? d.answers[key] : undefined
      if (ans?.kind !== 'choice' || ans.confidence < PARAM_MIN) return { kind: 'agent', ms: d.ms }
      params[param] = ans.value
    }
    return { kind: 'command', name: c.name, title: c.title, params, ...meta, picked: { name: c.name, title: c.title, params, missing } }
  }
  return { kind: 'agent', ms: d.ms }
}
