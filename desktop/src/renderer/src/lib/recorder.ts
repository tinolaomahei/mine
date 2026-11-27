// Records the microphone as 16kHz mono Float32, which is what Parakeet expects.

const RATE = 16000
const MAX_SECONDS = 120

type Frame = (samples: Float32Array, rms: number) => void

async function openMic(onFrame: Frame): Promise<() => Promise<void>> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  const ctx = new AudioContext({ sampleRate: RATE })
  try {
    await ctx.audioWorklet.addModule(new URL('recorder-worklet.js', document.baseURI).href)
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop())
    await ctx.close()
    throw err
  }
  const source = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'mine-recorder')
  node.port.onmessage = (e: MessageEvent<{ samples: Float32Array; rms: number }>) => onFrame(e.data.samples, e.data.rms)
  source.connect(node)
  return async () => {
    node.port.close()
    node.disconnect()
    stream.getTracks().forEach((t) => t.stop())
    if (ctx.state !== 'closed') await ctx.close()
  }
}

// speech sits around 0.02–0.2 rms; map it onto 0..1 with a soft curve
export const levelOf = (rms: number) => Math.min(1, Math.sqrt(rms * 6))

export class Recorder {
  private close?: () => Promise<void>
  private chunks: Float32Array[] = []
  private length = 0

  constructor(
    private onLevel: (level: number) => void,
    private onLimit: () => void,
  ) {}

  async start() {
    this.close = await openMic((samples, rms) => {
      this.chunks.push(samples)
      this.length += samples.length
      this.onLevel(levelOf(rms))
      if (this.length >= RATE * MAX_SECONDS) this.onLimit()
    })
  }

  /** Stop and return everything heard. */
  async stop(): Promise<Float32Array> {
    await this.teardown()
    const out = new Float32Array(this.length)
    let o = 0
    for (const c of this.chunks) {
      out.set(c, o)
      o += c.length
    }
    this.chunks = []
    this.length = 0
    return out
  }

  async cancel() {
    await this.teardown()
    this.chunks = []
    this.length = 0
  }

  private async teardown() {
    await this.close?.()
    this.close = undefined
    this.onLevel(0)
  }
}

/** The microphone, always on: every stretch of audio goes to onChunk as it arrives. */
export class MicStream {
  private close?: () => Promise<void>

  constructor(
    private onChunk: (samples: Float32Array) => void,
    private onLevel: (level: number) => void,
  ) {}

  async start() {
    this.close = await openMic((samples, rms) => {
      this.onChunk(samples)
      this.onLevel(levelOf(rms))
    })
  }

  async stop() {
    await this.close?.()
    this.close = undefined
    this.onLevel(0)
  }
}

export const seconds = (samples: Float32Array) => samples.length / RATE
