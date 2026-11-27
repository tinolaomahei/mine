import { useEffect, useState } from 'react'
import type { ConnectionsState } from '@shared/connections'

/** The person's connections, kept up to date as they (or an agent) change them. */
export function useConnections() {
  const [state, setState] = useState<ConnectionsState | null>(null)
  useEffect(() => {
    void window.mine.connections.list().then(setState)
    return window.mine.connections.onChange(setState)
  }, [])
  return state
}

/** How much setting up is left: connections not connected yet, and sources waiting for an OK. */
export function setupLeft(s: ConnectionsState | null) {
  if (!s) return { connections: 0, sources: 0, total: 0 }
  const connections = s.connections.filter((c) => c.status !== 'connected').length
  const sources = s.sources.filter((x) => !x.approved).length
  return { connections, sources, total: connections + sources }
}
