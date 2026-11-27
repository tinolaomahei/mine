// Utility process: holds the Parakeet recognizer and decodes audio on request.
// Kept out of the main process because decoding is synchronous and heavy.

import { join } from 'node:path'
import { createRequire } from 'node:module'

type Msg = { type: 'load'; dir: string } | { type: 'transcribe'; id: number; samples: Float32Array }

const nodeRequire = createRequire(__filename)
let recognizer: any // sherpa-onnx-node ships no types

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

process.parentPort.on('message', (e: { data: Msg }) => {
  const msg = e.data
  try {
    if (msg.type === 'load') {
      load(msg.dir)
      process.parentPort.postMessage({ type: 'loaded' })
    } else if (msg.type === 'transcribe') {
      if (!recognizer) throw new Error('Speech model is not loaded')
      const stream = recognizer.createStream()
      stream.acceptWaveform({ samples: msg.samples, sampleRate: 16000 })
      recognizer.decode(stream)
      const text = String(recognizer.getResult(stream).text ?? '').trim()
      process.parentPort.postMessage({ type: 'result', id: msg.id, text })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.parentPort.postMessage({ type: 'error', id: 'id' in msg ? msg.id : undefined, message })
  }
})
