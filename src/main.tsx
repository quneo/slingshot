import '@fontsource-variable/manrope'
import '@fontsource/unbounded/700.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { ErrorBoundary } from './app/ErrorBoundary'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

if (import.meta.env.DEV) {
  // handy for manual testing in devtools
  void Promise.all([import('./state/gameStore'), import('./ui/sceneBridge'), import('./state/flightClock')]).then(
    ([store, bridge, clock]) => {
      Object.assign(window, { __game: store.useGame, __scene: bridge.sceneBridge, __clock: clock.flightClock })
    },
  )
}
