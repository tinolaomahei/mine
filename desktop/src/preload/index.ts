import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AgentEvent, HeardSpeech, MineApi, Settings, SpeechStatus, ThemeState, UpdateState, VoiceState } from '@shared/ipc'

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
    mock: (id) => ipcRenderer.invoke('widgets:mock', id),
    onChange: (cb) => listen('widgets:changed', cb),
    onShow: (cb) => listen('widgets:show', cb),
  },
  permissions: {
    list: () => ipcRenderer.invoke('permissions:list'),
    answer: (id, choice) => ipcRenderer.invoke('permissions:answer', id, choice),
    rules: () => ipcRenderer.invoke('permissions:rules'),
    forget: (folder) => ipcRenderer.invoke('permissions:forget', folder),
    stopAll: (folder) => ipcRenderer.invoke('permissions:stop-all', folder),
    onRules: (cb) => listen('permissions:rules', cb),
    onAsk: (cb) => listen('permissions:ask', cb),
    onDrop: (cb) => listen('permissions:drop', cb),
  },
  themes: {
    list: () => ipcRenderer.invoke('themes:list'),
    apply: (id) => ipcRenderer.invoke('themes:apply', id),
    saveCurrent: (name, description) => ipcRenderer.invoke('themes:save-current', name, description),
    remove: (id) => ipcRenderer.invoke('themes:remove', id),
    onChange: (cb) => listen('themes:changed', cb),
  },
  connections: {
    list: () => ipcRenderer.invoke('connections:list'),
    onChange: (cb) => listen('connections:changed', cb),
    logos: () => ipcRenderer.invoke('connections:logos'),
    add: (service, way) => ipcRenderer.invoke('connections:add', service, way),
    useWay: (id, way) => ipcRenderer.invoke('connections:use-way', id, way),
    remove: (id) => ipcRenderer.invoke('connections:remove', id),
    setField: (id, key, value) => ipcRenderer.invoke('connections:set-field', id, key, value),
    tick: (id, step, done) => ipcRenderer.invoke('connections:tick', id, step, done),
    signIn: (id) => ipcRenderer.invoke('connections:sign-in', id),
    cancelSignIn: () => ipcRenderer.invoke('connections:cancel-sign-in'),
    test: (id) => ipcRenderer.invoke('connections:test', id),
    addSource: (connection, title) => ipcRenderer.invoke('connections:add-source', connection, title),
    approveSource: (id) => ipcRenderer.invoke('connections:approve-source', id),
    removeSource: (id) => ipcRenderer.invoke('connections:remove-source', id),
    sync: (connection) => ipcRenderer.invoke('connections:sync', connection),
    open: (url) => ipcRenderer.invoke('connections:open', url),
  },
  screens: {
    list: () => ipcRenderer.invoke('screens:list'),
    save: (screens) => ipcRenderer.invoke('screens:save', screens),
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
    listen: (on) => ipcRenderer.invoke('speech:listen', on),
    feed: (samples) => ipcRenderer.send('speech:feed', samples),
    onVoice: (cb) => listen<VoiceState>('speech:voice', cb),
    onHeard: (cb) => listen<HeardSpeech>('speech:heard', cb),
  },
  updates: {
    state: () => ipcRenderer.invoke('updates:state'),
    check: () => ipcRenderer.invoke('updates:check'),
    install: () => ipcRenderer.invoke('updates:install'),
    openRelease: () => ipcRenderer.invoke('updates:open-release'),
    onChange: (cb) => listen<UpdateState>('updates:changed', cb),
  },
  agent: {
    run: (req) => ipcRenderer.invoke('agent:run', req),
    cancel: (runId) => ipcRenderer.invoke('agent:cancel', runId),
    stopTool: (runId, toolId) => ipcRenderer.invoke('agent:stop-tool', runId, toolId),
    onEvent: (cb) => listen<AgentEvent>('agent:event', cb),
  },
}

contextBridge.exposeInMainWorld('mine', api)
