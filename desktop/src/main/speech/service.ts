import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import type { HeardSpeech, SpeechStatus, VoiceState } from '@shared/ipc'
import { downloadModel, MODEL, MODEL_BYTES, modelDir, modelReady, vadPath } from './model'

type Pending = { resolve: (text: string) => void; reject: (err: Error) => void }

let status: SpeechStatus = { state: 'missing', model: MODEL.label, bytes: MODEL_BYTES }
let listeners: ((s: SpeechStatus) => void)[] = []
let downloading: Promise<void> | undefined

type Hands = { onVoice: (s: VoiceState) => void; onHeard: (h: HeardSpeech) => void }
let hands: Hands | undefined
let listening = false

let worker: UtilityProcess | undefined
let loaded: Promise<void> | undefined
const pending = new Map<number, Pending>()
let nextId = 1

function set(s: SpeechStatus) {
  status = s
  for (const l of listeners) l(s)
}

export function onSpeechStatus(l: (s: SpeechStatus) => void) {
  listeners.push(l)
  return () => {
    listeners = listeners.filter((x) => x !== l)
  }
}

export function speechStatus(): SpeechStatus {
  if (status.state === 'missing' && modelReady()) status = { state: 'ready', model: MODEL.label }
  return status
}

export async function prepareSpeech(): Promise<SpeechStatus> {
  if (speechStatus().state === 'ready') {
    void ensureWorker().catch(() => {})
    return status
  }
  if (!downloading) {
    set({ state: 'downloading', model: MODEL.label, bytes: MODEL_BYTES, received: 0 })
    downloading = downloadModel((received) =>
      set({ state: 'downloading', model: MODEL.label, bytes: MODEL_BYTES, received }),
    )
      .then(() => {
        set({ state: 'ready', model: MODEL.label })
        void ensureWorker().catch(() => {})
      })
      .catch((err: Error) => set({ state: 'error', model: MODEL.label, message: err.message }))
      .finally(() => {
        downloading = undefined
      })
  }
  return status
}

function ensureWorker(): Promise<void> {
  if (loaded) return loaded
  loaded = new Promise<void>((resolve, reject) => {
    const w = utilityProcess.fork(join(__dirname, 'speech.js'), [], { serviceName: 'mine speech' })
    worker = w
    w.on('message', (m: { type: string; id?: number; text?: string; message?: string; state?: VoiceState; seconds?: number }) => {
      if (m.type === 'loaded') resolve()
      else if (m.type === 'voice' && m.state) hands?.onVoice(m.state)
      else if (m.type === 'heard' && m.text) hands?.onHeard({ text: m.text, seconds: m.seconds ?? 0 })
      else if (m.type === 'error' && !m.id && listening) hands?.onVoice('quiet')
      else if (m.type === 'result' && m.id) {
        pending.get(m.id)?.resolve(m.text ?? '')
        pending.delete(m.id)
      } else if (m.type === 'error') {
        const err = new Error(m.message ?? 'Speech failed')
        if (m.id) {
          pending.get(m.id)?.reject(err)
          pending.delete(m.id)
        } else reject(err)
      }
    })
    w.on('exit', () => {
      worker = undefined
      loaded = undefined
      listening = false
      for (const p of pending.values()) p.reject(new Error('Speech engine stopped'))
      pending.clear()
      reject(new Error('Speech engine stopped'))
    })
    w.postMessage({ type: 'load', dir: modelDir() })
  })
  return loaded
}

export async function transcribe(samples: Float32Array): Promise<string> {
  if (speechStatus().state !== 'ready') throw new Error('The speech model isn’t downloaded yet.')
  await ensureWorker()
  const id = nextId++
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker!.postMessage({ type: 'transcribe', id, samples })
  })
}

export function onHandsFree(h: Hands) {
  hands = h
}

export async function startListening() {
  if (speechStatus().state !== 'ready') throw new Error('The speech model isn’t downloaded yet.')
  await ensureWorker()
  worker!.postMessage({ type: 'listen', vad: vadPath() })
  listening = true
}

export function stopListening() {
  listening = false
  worker?.postMessage({ type: 'unlisten' })
}

export function feedSpeech(samples: Float32Array) {
  if (listening) worker?.postMessage({ type: 'feed', samples })
}

export function stopSpeech() {
  worker?.kill()
}
