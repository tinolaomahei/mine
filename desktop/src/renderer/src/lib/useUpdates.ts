import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/ipc'

/** Where mine is with updating itself, kept live. */
export function useUpdates() {
  const [update, setUpdate] = useState<UpdateState | null>(null)
  useEffect(() => {
    void window.mine.updates.state().then(setUpdate)
    return window.mine.updates.onChange(setUpdate)
  }, [])
  return update
}
