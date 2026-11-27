import { useCallback, useEffect, useRef, useState } from 'react'
import type { Screen, ScreenItem, WidgetInfo } from '@shared/widgets'
import { firstFree } from './grid'

// The person's screens, kept in main (screens.json) and edited here. Changes
// apply at once and save a moment later.

const uid = (): string => crypto.randomUUID().replace(/-/g, '').slice(0, 12)

export function useScreens() {
  const [screens, setScreens] = useState<Screen[] | null>(null)
  const latest = useRef<Screen[]>([])
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    void window.mine.screens.list().then((s) => {
      latest.current = s
      setScreens(s)
    })
  }, [])

  const save = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void window.mine.screens.save(latest.current), 250)
  }
  // anything pending goes before the window does
  useEffect(() => {
    const flush = () => {
      clearTimeout(timer.current)
      void window.mine.screens.save(latest.current)
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  const change = useCallback((fn: (all: Screen[]) => Screen[]) => {
    const next = fn(latest.current)
    latest.current = next
    setScreens(next)
    save()
  }, [])

  const touch = (s: Screen, patch: Partial<Screen>): Screen => ({
    ...s,
    ...patch,
    updatedAt: Date.now(),
  })

  const create = useCallback(
    (name?: string) => {
      const taken = (t: string) => latest.current.some((s) => s.name.toLowerCase() === t.toLowerCase())
      let title = name?.trim().slice(0, 60) ?? ''
      if (!title) {
        title = taken('Home') ? '' : 'Home'
        for (let k = latest.current.length + 1; !title; k++) if (!taken(`Screen ${k}`)) title = `Screen ${k}`
      }
      const s: Screen = {
        id: uid(),
        name: title,
        items: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      change((all) => [...all, s])
      return s
    },
    [change],
  )

  const rename = useCallback(
    (id: string, name: string) => change((all) => all.map((s) => (s.id === id ? touch(s, { name: name.trim().slice(0, 60) || s.name }) : s))),
    [change],
  )

  /** Delete a screen; returns a way to put it back. */
  const remove = useCallback(
    (id: string) => {
      const at = latest.current.findIndex((s) => s.id === id)
      const gone = latest.current[at]
      change((all) => all.filter((s) => s.id !== id))
      return () => gone && change((all) => (all.some((s) => s.id === id) ? all : [...all.slice(0, at), gone, ...all.slice(at)]))
    },
    [change],
  )

  const setItems = useCallback(
    (id: string, items: ScreenItem[]) => change((all) => all.map((s) => (s.id === id ? touch(s, { items }) : s))),
    [change],
  )

  /** Put a widget on a screen at the first free spot, at its own size. */
  const addWidget = useCallback(
    (screenId: string, w: WidgetInfo, props?: Record<string, unknown>) => {
      const s = latest.current.find((x) => x.id === screenId)
      if (!s) return null
      const at = firstFree(s.items, w.size.w, w.size.h)
      const id = uid()
      // each placement gets its own instance key, so per-placement state (a note) stays separate
      const item: ScreenItem = {
        id,
        widget: w.id,
        ...at,
        w: w.size.w,
        h: w.size.h,
        props: { ...props, instance: props?.instance ?? id },
      }
      setItems(screenId, [...s.items, item])
      return item
    },
    [setItems],
  )

  const removeItem = useCallback(
    (screenId: string, itemId: string) => {
      const s = latest.current.find((x) => x.id === screenId)
      const item = s?.items.find((i) => i.id === itemId)
      if (!s || !item) return null
      setItems(
        screenId,
        s.items.filter((i) => i.id !== itemId),
      )
      return item
    },
    [setItems],
  )

  return {
    screens,
    create,
    rename,
    remove,
    setItems,
    addWidget,
    removeItem,
    latest,
  }
}

export type ScreensApi = ReturnType<typeof useScreens>
