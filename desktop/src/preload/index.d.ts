import type { MineApi } from '../shared/ipc'

declare global {
  interface Window {
    mine: MineApi
  }
}

export {}
