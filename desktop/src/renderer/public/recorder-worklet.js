// Collects mono audio frames on the audio thread and posts them in batches,
// along with a loudness value the UI uses to move the rings.
class Recorder extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buf = []
    this.size = 0
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) {
      this.buf.push(new Float32Array(ch))
      this.size += ch.length
      // ~64ms at 16kHz
      if (this.size >= 1024) {
        const out = new Float32Array(this.size)
        let o = 0
        let sum = 0
        for (const b of this.buf) {
          out.set(b, o)
          o += b.length
          for (let i = 0; i < b.length; i++) sum += b[i] * b[i]
        }
        this.port.postMessage({ samples: out, rms: Math.sqrt(sum / this.size) }, [out.buffer])
        this.buf = []
        this.size = 0
      }
    }
    return true
  }
}

registerProcessor('mine-recorder', Recorder)
