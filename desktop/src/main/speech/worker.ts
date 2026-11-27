// Utility process: holds the Parakeet recognizer and decodes audio on request.
// Kept out of the main process because decoding is synchronous and heavy.

import { join } from 'node:path'
import { createRequire } from 'node:module'

type Msg =
  | { type: 'load'; dir: string }
  | { type: 'transcribe'; id: number; samples: Float32Array }
  | { type: 'listen'; vad: string }
  | { type: 'feed'; samples: Float32Array }
  | { type: 'unlisten' }

type Segment = { start: number; samples: Float32Array }
type Vad = { acceptWaveform(s: Float32Array): void; isEmpty(): boolean; isDetected(): boolean; front(external?: boolean): Segment; pop(): void; flush(): void; reset(): void }
type VadClass = new (config: object, bufferSeconds: number) => Vad

const RATE = 16000
const WINDOW = 512
const MIN_SECONDS = 0.35
const FILLER = /^(u+m+|u+h+|h+m+|m+|a+h+|o+h+|e+r+m*)[.!?,]*$/i

const nodeRequire = createRequire(__filename)
let recognizer: any // sherpa-onnx-node ships no types
let vad: Vad | undefined
let pending = new Float32Array(0)
let speaking = false

function load(dir: string) {
  const sherpa = nodeRequire('sherpa-onnx-node')
  recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(dir, 'encoder.int8.onnx'),
        decoder: join(dir, 'decoder.int8.onnx'),
        joiner: join(dir, 'joiner.int8.onnx'),
      },
      tokens: join(dir, 'tokens.txt'),
      numThreads: 4,
      provider: 'cpu',
      debug: 0,
      modelType: 'nemo_transducer',
    },
  })
}

function decode(samples: Float32Array) {
  if (!recognizer) throw new Error('Speech model is not loaded')
  const stream = recognizer.createStream()
  stream.acceptWaveform({ samples, sampleRate: RATE })
  recognizer.decode(stream)
  return String(recognizer.getResult(stream).text ?? '').trim()
}

function listen(model: string) {
  const { Vad: VadCtor } = nodeRequire('sherpa-onnx-node') as { Vad: VadClass }
  vad = new VadCtor(
    {
      sileroVad: { model, threshold: 0.5, minSilenceDuration: 0.7, minSpeechDuration: 0.25, windowSize: WINDOW, maxSpeechDuration: 30 },
      sampleRate: RATE,
      numThreads: 1,
      provider: 'cpu',
      debug: 0,
    },
    60,
  )
  pending = new Float32Array(0)
  speaking = false
}

function unlisten() {
  vad = undefined
  pending = new Float32Array(0)
  setSpeaking(false)
}

const post = (m: object) => process.parentPort.postMessage(m)

function setSpeaking(on: boolean) {
  if (on === speaking) return
  speaking = on
  post({ type: 'voice', state: on ? 'speaking' : 'quiet' })
}

function append(samples: Float32Array) {
  const next = new Float32Array(pending.length + samples.length)
  next.set(pending)
  next.set(samples, pending.length)
  pending = next
}

function heard(segment: Segment) {
  if (segment.samples.length < RATE * MIN_SECONDS) return
  post({ type: 'voice', state: 'decoding' })
  const text = decode(segment.samples)
  post({ type: 'voice', state: 'quiet' })
  if (text && !FILLER.test(text)) post({ type: 'heard', text, seconds: segment.samples.length / RATE })
}

function feed(samples: Float32Array) {
  if (!vad) return
  append(samples)
  let used = 0
  while (pending.length - used >= WINDOW) {
    vad.acceptWaveform(pending.subarray(used, used + WINDOW))
    used += WINDOW
  }
  pending = pending.slice(used)
  setSpeaking(vad.isDetected())
  while (!vad.isEmpty()) {
    const segment = vad.front(false)
    vad.pop()
    heard(segment)
  }
}

process.parentPort.on('message', (e: { data: Msg }) => {
  const msg = e.data
  try {
    if (msg.type === 'load') {
      load(msg.dir)
      process.parentPort.postMessage({ type: 'loaded' })
    } else if (msg.type === 'transcribe') {
      process.parentPort.postMessage({ type: 'result', id: msg.id, text: decode(msg.samples) })
    } else if (msg.type === 'listen') listen(msg.vad)
    else if (msg.type === 'feed') feed(msg.samples)
    else if (msg.type === 'unlisten') unlisten()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.parentPort.postMessage({ type: 'error', id: 'id' in msg ? msg.id : undefined, message })
  }
})
