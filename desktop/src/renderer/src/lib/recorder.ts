// Records the microphone as 16kHz mono Float32, which is what Parakeet expects.

const RATE = 16000
const MAX_SECONDS = 120

export class Recorder {
  private ctx?: AudioContext
  private stream?: MediaStream
  private node?: AudioWorkletNode
  private chunks: Float32Array[] = []
  private length = 0

  constructor(
    private onLevel: (level: number) => void,
    private onLimit: () => void,
  ) {}

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    this.ctx = new AudioContext({ sampleRate: RATE })
    await this.ctx.audioWorklet.addModule(new URL('recorder-worklet.js', document.baseURI).href)
    const source = this.ctx.createMediaStreamSource(this.stream)
    this.node = new AudioWorkletNode(this.ctx, 'mine-recorder')
    this.node.port.onmessage = (e: MessageEvent<{ samples: Float32Array; rms: number }>) => {
      this.chunks.push(e.data.samples)
      this.length += e.data.samples.length
      // speech sits around 0.02–0.2 rms; map it onto 0..1 with a soft curve
      this.onLevel(Math.min(1, Math.sqrt(e.data.rms * 6)))
      if (this.length >= RATE * MAX_SECONDS) this.onLimit()
    }
    source.connect(this.node)
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
    this.node?.port.close()
    this.node?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    if (this.ctx && this.ctx.state !== 'closed') await this.ctx.close()
    this.node = undefined
    this.stream = undefined
    this.ctx = undefined
    this.onLevel(0)
  }
}

export const seconds = (samples: Float32Array) => samples.length / RATE
