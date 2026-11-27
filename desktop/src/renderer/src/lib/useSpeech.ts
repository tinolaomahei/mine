import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { SpeechStatus } from '@shared/ipc'
import { Recorder, seconds } from './recorder'

export type MicState = 'idle' | 'listening' | 'thinking' | 'blocked'

/**
 * Tap to talk, tap to send. Audio is recorded here, decoded by Parakeet in the
 * main process, and the text goes to `onText`.
 */
export function useSpeech(voiceRef: RefObject<HTMLElement | null>, onText: (text: string) => void) {
  const [status, setStatus] = useState<SpeechStatus | null>(null)
  const [mic, setMic] = useState<MicState>('idle')
  const [note, setNote] = useState<string | null>(null)
  const recorder = useRef<Recorder | null>(null)
  const onTextRef = useRef(onText)
  onTextRef.current = onText

  useEffect(() => {
    const off = window.mine.speech.onStatus(setStatus)
    void window.mine.speech.status().then((s) => {
      setStatus(s)
      // warm the model in the background so the first tap is quick
      if (s.state === 'ready') void window.mine.speech.prepare()
    })
    return off
  }, [])

  const setLevel = useCallback(
    (level: number) => voiceRef.current?.style.setProperty('--level', level.toFixed(3)),
    [voiceRef],
  )

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
      setNote(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
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

  /** The one button: download the model, start listening, or send. */
  const toggle = useCallback(async () => {
    if (mic === 'thinking') return
    if (mic === 'listening') return stop()
    if (!status || status.state === 'missing' || status.state === 'error') {
      setNote(null)
      setStatus(await window.mine.speech.prepare())
      return
    }
    if (status.state === 'downloading') return
    return start()
  }, [mic, status, start, stop])

  useEffect(() => () => void recorder.current?.cancel(), [])

  return { status, mic, note, toggle, cancel, clearNote: () => setNote(null) }
}
