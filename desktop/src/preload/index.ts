import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AgentEvent, MineApi, Settings, SpeechStatus, ThemeState } from '@shared/ipc'

function listen<T>(channel: string, cb: (v: T) => void) {
  const handler = (_e: IpcRendererEvent, v: T) => cb(v)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: MineApi = {
  platform: process.platform,
  harness: {
    detect: () => ipcRenderer.invoke('harness:detect'),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    pickWorkdir: () => ipcRenderer.invoke('settings:pick-workdir'),
    onChange: (cb) => listen<Settings>('settings:changed', cb),
  },
  conversations: {
    list: () => ipcRenderer.invoke('conversations:list'),
    get: (id) => ipcRenderer.invoke('conversations:get', id),
    save: (record) => ipcRenderer.invoke('conversations:save', record),
    remove: (id) => ipcRenderer.invoke('conversations:delete', id),
  },
  commands: {
    list: () => ipcRenderer.invoke('commands:list'),
    run: (name, params, said) => ipcRenderer.invoke('commands:run', name, params, said),
    undo: (name, undoState) => ipcRenderer.invoke('commands:undo', name, undoState),
    approve: (name) => ipcRenderer.invoke('commands:approve', name),
    remove: (name) => ipcRenderer.invoke('commands:remove', name),
    reveal: (path) => ipcRenderer.invoke('commands:reveal', path),
    registerApp: (infos) => ipcRenderer.invoke('commands:register-app', infos),
    onInvoke: (cb) => listen('commands:invoke', cb),
    invokeDone: (id, result) => ipcRenderer.invoke('commands:invoke-done', id, result),
    onChange: (cb) => listen('commands:changed', cb),
    onEffect: (cb) => listen('commands:effect', cb),
  },
  widgets: {
    list: () => ipcRenderer.invoke('widgets:list'),
    approve: (name) => ipcRenderer.invoke('widgets:approve', name),
    remove: (name) => ipcRenderer.invoke('widgets:remove', name),
    reveal: (name) => ipcRenderer.invoke('widgets:reveal', name),
    onChange: (cb) => listen('widgets:changed', cb),
    onShow: (cb) => listen('widgets:show', cb),
  },
  files: {
    list: (path) => ipcRenderer.invoke('files:list', path),
    read: (path) => ipcRenderer.invoke('files:read', path),
    open: (path) => ipcRenderer.invoke('files:open', path),
    write: (path, text, expected, force) => ipcRenderer.invoke('files:write', path, text, expected, force),
  },
  onShortcut: (cb) => listen<'close-tab'>('shortcut', cb),
  data: {
    call: (method, args) => ipcRenderer.invoke('data:call', method, args),
    onChange: (cb) => listen<string>('data:changed', cb),
  },
  decisions: {
    status: () => ipcRenderer.invoke('decisions:status'),
    save: (settings, key) => ipcRenderer.invoke('decisions:save', settings, key),
    route: (text, ctx) => ipcRenderer.invoke('decisions:route', text, ctx),
  },
  theme: {
    get: () => ipcRenderer.invoke('theme:get'),
    undo: () => ipcRenderer.invoke('theme:undo'),
    reset: () => ipcRenderer.invoke('theme:reset'),
    onChange: (cb) => listen<ThemeState>('theme:changed', cb),
  },
  speech: {
    status: () => ipcRenderer.invoke('speech:status'),
    prepare: () => ipcRenderer.invoke('speech:prepare'),
    transcribe: (samples) => ipcRenderer.invoke('speech:transcribe', samples),
    onStatus: (cb) => listen<SpeechStatus>('speech:status', cb),
  },
  agent: {
    run: (req) => ipcRenderer.invoke('agent:run', req),
    cancel: (runId) => ipcRenderer.invoke('agent:cancel', runId),
    stopTool: (runId, toolId) => ipcRenderer.invoke('agent:stop-tool', runId, toolId),
    onEvent: (cb) => listen<AgentEvent>('agent:event', cb),
  },
}

contextBridge.exposeInMainWorld('mine', api)
