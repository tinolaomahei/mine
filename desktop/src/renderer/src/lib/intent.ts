import { commandOf, type ToolCall } from './useConversation'

// The fast intent layer for speech while an agent is working. "Stop" and its
// variations are handled here on the spot, without a round trip to a model.
// Anything else is a real message and waits its turn.

export type StopIntent = { kind: 'all' } | { kind: 'tool'; id: string } | { kind: 'none' }

const STOP = /^(?:ok(?:ay)?\s+|please\s+|hey\s+|no\s+)*(stop|cancel|abort|halt|kill|quit|end|interrupt|hold on|wait|never ?mind)\b\s*(.*)$/
const ALL = /\b(all|everything|it all|the whole thing|whole thing|agent|claude|pi|working|now|it)\b/
const FILLER = new Set(['the', 'that', 'this', 'it', 'a', 'please', 'command', 'tool', 'process', 'one', 'running', 'thing', 'job', 'task'])

export function stopIntent(said: string, running: ToolCall[]): StopIntent {
  const s = said
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // long sentences that start with "stop" are usually instructions, not a brake
  if (s.split(' ').length > 7) return { kind: 'none' }
  const m = s.match(STOP)
  if (!m) return { kind: 'none' }
  const rest = m[2].trim()

  const commands = running.filter((t) => commandOf(t.input) !== undefined)
  const words = rest.split(' ').filter((w) => w && !FILLER.has(w))

  // "stop the build", "kill the dev server": match words against running commands
  if (words.length) {
    const scored = commands
      .map((t) => {
        const hay = `${t.name} ${commandOf(t.input) ?? ''}`.toLowerCase()
        return { t, score: words.filter((w) => hay.includes(w.replace(/s$/, ''))).length }
      })
      .sort((a, b) => b.score - a.score)
    if (scored[0]?.score) return { kind: 'tool', id: scored[0].t.id }
  }
  // "stop that command": the most recently started one
  if (/\b(command|that|this|tool|process)\b/.test(rest) && !ALL.test(rest.replace(/\bthat\b|\bthis\b/g, '')) && commands.length)
    return { kind: 'tool', id: commands[commands.length - 1].id }
  return { kind: 'all' }
}
