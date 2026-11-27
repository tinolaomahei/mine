import type { OutputFormat } from './registry'

// Each harness speaks its own stream format. A parser turns one line of it into
// the few things mine cares about: text, tool calls (with their input and
// result), a session handle, an end.

export type Parsed =
  | { type: 'session'; ref: string }
  | { type: 'delta'; text: string }
  | { type: 'tool'; id: string; name: string; input?: unknown }
  | { type: 'tool-output'; id: string; text: string }
  | { type: 'tool-end'; id: string; ok: boolean; output?: string }
  | { type: 'final'; text: string }
  | { type: 'error'; message: string }

export type Parser = (line: string) => Parsed[]

type Json = Record<string, any>

function json(line: string): Json | undefined {
  const t = line.trim()
  if (!t.startsWith('{')) return undefined
  try {
    return JSON.parse(t)
  } catch {
    return undefined
  }
}

/** Tool results arrive as a string or as content blocks; flatten to text. */
function text(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content))
    return content
      .map((c) => (typeof c === 'string' ? c : c?.type === 'text' ? String(c.text ?? '') : c?.type ? `[${c.type}]` : ''))
      .join('')
  return content == null ? '' : JSON.stringify(content)
}

/** Claude Code: `-p --output-format stream-json --verbose --include-partial-messages` */
function claude(): Parser {
  let wrote = false
  return (line) => {
    const e = json(line)
    if (!e) return []
    if (e.type === 'system' && e.subtype === 'init' && e.session_id) return [{ type: 'session', ref: e.session_id }]
    // tools run by subagents are the subagent's business; show the top level only
    if (e.parent_tool_use_id) return []
    if (e.type === 'stream_event') {
      const ev = e.event ?? {}
      if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use')
        return [{ type: 'tool', id: ev.content_block.id, name: ev.content_block.name ?? 'tool' }]
      if (ev.type === 'content_block_start' && ev.content_block?.type === 'text' && wrote)
        return [{ type: 'delta', text: '\n\n' }]
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
        wrote = true
        return [{ type: 'delta', text: ev.delta.text }]
      }
      return []
    }
    // the complete assistant message carries each tool call's full input
    if (e.type === 'assistant')
      return (e.message?.content ?? [])
        .filter((c: Json) => c.type === 'tool_use')
        .map((c: Json) => ({ type: 'tool', id: c.id, name: c.name, input: c.input }))
    if (e.type === 'user')
      return (Array.isArray(e.message?.content) ? e.message.content : [])
        .filter((c: Json) => c.type === 'tool_result')
        .map((c: Json) => ({ type: 'tool-end', id: c.tool_use_id, ok: !c.is_error, output: text(c.content) }))
    if (e.type === 'result') {
      if (e.is_error) return [{ type: 'error', message: String(e.result ?? e.subtype ?? 'Claude Code failed') }]
      return wrote ? [] : [{ type: 'final', text: String(e.result ?? '') }]
    }
    return []
  }
}

/** Pi: `-p --mode json` */
function pi(): Parser {
  let wrote = false
  return (line) => {
    const e = json(line)
    if (!e) return []
    if (e.type === 'message_update') {
      const m = e.assistantMessageEvent ?? {}
      if (m.type === 'text_start' && wrote) return [{ type: 'delta', text: '\n\n' }]
      if (m.type === 'text_delta' && m.delta) {
        wrote = true
        return [{ type: 'delta', text: String(m.delta) }]
      }
      return []
    }
    if (e.type === 'tool_execution_start') return [{ type: 'tool', id: e.toolCallId, name: e.toolName, input: e.args }]
    if (e.type === 'tool_execution_update') return [{ type: 'tool-output', id: e.toolCallId, text: text(e.partialResult?.content) }]
    if (e.type === 'tool_execution_end')
      return [{ type: 'tool-end', id: e.toolCallId, ok: !e.isError, output: text(e.result?.content) }]
    if (e.type === 'message_end' && e.message?.role === 'assistant' && e.message?.stopReason === 'error')
      return [{ type: 'error', message: String(e.message.errorMessage ?? 'The model returned an error') }]
    return []
  }
}

/** Codex: `exec --json` */
function codex(): Parser {
  return (line) => {
    const e = json(line)
    if (!e) return []
    if (e.type === 'thread.started' && e.thread_id) return [{ type: 'session', ref: e.thread_id }]
    const item = e.item ?? {}
    if (e.type === 'item.started' && item.type === 'command_execution')
      return [{ type: 'tool', id: item.id, name: 'shell', input: { command: item.command } }]
    if (e.type === 'item.completed' && item.type === 'command_execution')
      return [{ type: 'tool-end', id: item.id, ok: item.exit_code === 0, output: item.aggregated_output }]
    if (e.type === 'item.completed' && item.type === 'agent_message' && item.text)
      return [{ type: 'delta', text: String(item.text) + '\n\n' }]
    if (e.type === 'error' || e.type === 'turn.failed')
      return [{ type: 'error', message: String(e.message ?? e.error?.message ?? 'Codex failed') }]
    return []
  }
}

export function parserFor(format: OutputFormat): Parser | undefined {
  if (format === 'claude-stream') return claude()
  if (format === 'pi-json') return pi()
  if (format === 'codex-json') return codex()
  return undefined
}
