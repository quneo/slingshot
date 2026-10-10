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
