import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { app } from 'electron'

// NVIDIA Parakeet TDT 0.6B v3, int8 ONNX export for sherpa-onnx. Runs fully on
// this machine; nothing you say leaves it. Multilingual (25 European languages).
// Silero VAD comes with it, so hands-free listening can tell speech from silence.

export const MODEL = {
  id: 'parakeet-tdt-0.6b-v3-int8',
  label: 'Parakeet TDT 0.6B v3',
  base: 'https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/main/',
  files: [
    { name: 'tokens.txt', bytes: 93939 },
    { name: 'decoder.int8.onnx', bytes: 11845274 },
    { name: 'joiner.int8.onnx', bytes: 6355277 },
    { name: 'encoder.int8.onnx', bytes: 652282294 },
    { name: 'silero_vad.onnx', bytes: 643854, url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx' },
  ],
} as const

export const vadPath = () => join(modelDir(), 'silero_vad.onnx')
const urlOf = (f: (typeof MODEL.files)[number]) => ('url' in f ? f.url : MODEL.base + f.name)

export const MODEL_BYTES = MODEL.files.reduce((n, f) => n + f.bytes, 0)

export function modelDir() {
  return join(app.getPath('userData'), 'models', MODEL.id)
}

function sizeOf(p: string) {
  try {
    return statSync(p).size
  } catch {
    return -1
  }
}

export function modelReady() {
  const dir = modelDir()
  return MODEL.files.every((f) => sizeOf(join(dir, f.name)) === f.bytes)
}

export async function downloadModel(onProgress: (received: number) => void) {
  const dir = modelDir()
  mkdirSync(dir, { recursive: true })
  let done = 0

  for (const f of MODEL.files) {
    const target = join(dir, f.name)
    if (sizeOf(target) === f.bytes) {
      done += f.bytes
      onProgress(done)
      continue
    }
    const part = target + '.part'
    if (existsSync(part)) rmSync(part)

    const res = await fetch(urlOf(f))
    if (!res.ok || !res.body) throw new Error(`Download failed for ${f.name} (${res.status})`)

    let last = 0
    const count = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        done += chunk.length
        const now = Date.now()
        if (now - last > 120) {
          last = now
          onProgress(done)
        }
        cb(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(res.body as WebReadableStream), count, createWriteStream(part))
    if (sizeOf(part) !== f.bytes) throw new Error(`${f.name} came down incomplete. Try again.`)
    renameSync(part, target)
    onProgress(done)
  }
}
