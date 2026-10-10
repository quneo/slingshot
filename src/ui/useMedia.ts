import { useSyncExternalStore } from 'react'

const QUERY = '(max-width: 767px), (max-height: 520px)'

function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

/** Phones and short landscape screens get the compact HUD. */
export function useCompact(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false)
}

const SHORT = '(max-height: 520px) and (orientation: landscape)'

function subscribeShort(cb: () => void) {
  const mq = window.matchMedia(SHORT)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

/** Phone held sideways: very little height, plenty of width. */
export function useShortLandscape(): boolean {
  return useSyncExternalStore(subscribeShort, () => window.matchMedia(SHORT).matches, () => false)
}

const SHORT_DESKTOP = '(max-height: 860px)'

function subscribeShortDesktop(cb: () => void) {
  const mq = window.matchMedia(SHORT_DESKTOP)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

/** Wide but not tall (typical laptop): trim vertical chrome. */
export function useShortDesktop(): boolean {
  return useSyncExternalStore(subscribeShortDesktop, () => window.matchMedia(SHORT_DESKTOP).matches, () => false)
}
