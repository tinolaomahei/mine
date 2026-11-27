import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { SpeechStatus, VoiceState } from '@shared/ipc'
import { MicStream, Recorder, seconds } from './recorder'

export type MicState = 'idle' | 'listening' | 'thinking' | 'blocked'
export type MicLook = MicState | 'ambient'

/** Hands-free: off, waiting for the person to speak, hearing them, writing it down, or paused by them. */
export type Ears = 'off' | 'waiting' | 'hearing' | 'writing' | 'paused'

const plain = (err: unknown) => (err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))

/**
 * Tap to talk, tap to send. Or, hands-free, the mic stays on and each thing
 * the person says is picked up when they stop talking. Audio is decoded by
 * Parakeet on this computer, and the text goes to `onText`.
 */
export function useSpeech(voiceRef: RefObject<HTMLElement | null>, onText: (text: string) => void, handsFree = false) {
  const [status, setStatus] = useState<SpeechStatus | null>(null)
  const [mic, setMic] = useState<MicState>('idle')
  const [note, setNote] = useState<string | null>(null)
  const [voice, setVoice] = useState<VoiceState>('quiet')
  const [paused, setPaused] = useState(false)
  const [open, setOpen] = useState(false)
  const recorder = useRef<Recorder | null>(null)
  const onTextRef = useRef(onText)
  onTextRef.current = onText
  const voiceNow = useRef<VoiceState>('quiet')
  voiceNow.current = voice

  useEffect(() => {
    const off = window.mine.speech.onStatus(setStatus)
    void window.mine.speech.status().then((s) => {
      setStatus(s)
      if (s.state === 'ready') void window.mine.speech.prepare()
    })
    return off
  }, [])

  const setLevel = useCallback((level: number) => voiceRef.current?.style.setProperty('--level', level.toFixed(3)), [voiceRef])

  const ready = status?.state === 'ready'
  const wantEars = handsFree && ready && !paused && mic === 'idle'

  useEffect(() => {
    if (handsFree && (status?.state === 'missing' || status?.state === 'error')) void window.mine.speech.prepare().then(setStatus)
  }, [handsFree, status?.state])

  useEffect(() => {
    if (!handsFree) setPaused(false)
  }, [handsFree])

  useEffect(() => {
    if (!wantEars) return
    let live = true
    const stream = new MicStream(
      (chunk) => window.mine.speech.feed(chunk),
      (level) => setLevel(voiceNow.current === 'speaking' ? level : 0),
    )
    const offVoice = window.mine.speech.onVoice((s) => live && setVoice(s))
    const offHeard = window.mine.speech.onHeard((h) => live && onTextRef.current(h.text))
    void (async () => {
      try {
        await window.mine.speech.listen(true)
        await stream.start()
        if (!live) return void stream.stop()
        setOpen(true)
      } catch (err) {
        if (!live) return
        setMic('blocked')
        setNote(err instanceof DOMException ? 'mine can’t hear you. Allow microphone access for desktop apps in your system privacy settings.' : plain(err))
      }
    })()
    return () => {
      live = false
      offVoice()
      offHeard()
      setOpen(false)
      setVoice('quiet')
      void stream.stop()
      void window.mine.speech.listen(false)
    }
  }, [wantEars, setLevel])

  const stop = useCallback(async () => {
    const r = recorder.current
    if (!r) return
    recorder.current = null
    const samples = await r.stop()
    if (seconds(samples) < 0.35) {
      setMic('idle')
      setNote('That was too short. Tap, talk, then tap again.')
      return
    }
    setMic('thinking')
    try {
      const text = await window.mine.speech.transcribe(samples)
      setMic('idle')
      if (!text) setNote('I didn’t catch any words. Try again a little closer to the mic.')
      else onTextRef.current(text)
    } catch (err) {
      setMic('idle')
      setNote(plain(err))
    }
  }, [])

  const start = useCallback(async () => {
    setNote(null)
    const r = new Recorder(setLevel, () => void stop())
    try {
      await r.start()
      recorder.current = r
      setMic('listening')
    } catch {
      await r.cancel()
      setMic('blocked')
      setNote('mine can’t hear you. Allow microphone access for desktop apps in your system privacy settings.')
    }
  }, [setLevel, stop])

  const cancel = useCallback(async () => {
    const r = recorder.current
    recorder.current = null
    await r?.cancel()
    setMic('idle')
  }, [])

  /** The one button: download the model, start listening, or send. Hands-free, it pauses and resumes. */
  const toggle = useCallback(async () => {
    if (mic === 'thinking') return
    if (mic === 'listening') return stop()
    if (!status || status.state === 'missing' || status.state === 'error') {
      setNote(null)
      setStatus(await window.mine.speech.prepare())
      return
    }
    if (status.state === 'downloading') return
    if (handsFree) {
      setNote(null)
      if (mic === 'blocked') setMic('idle')
      return setPaused((p) => !p)
    }
    return start()
  }, [mic, status, start, stop, handsFree])

  useEffect(() => () => void recorder.current?.cancel(), [])

  const ears: Ears = !handsFree ? 'off' : paused ? 'paused' : !open ? 'off' : voice === 'speaking' ? 'hearing' : voice === 'decoding' ? 'writing' : 'waiting'

  const look: MicLook = ears === 'hearing' ? 'listening' : ears === 'writing' ? 'thinking' : ears === 'waiting' ? 'ambient' : mic

  return { status, mic, ears, look, note, toggle, cancel, clearNote: () => setNote(null) }
}
