import { useEffect } from 'react'
import { useCasual } from '../state/casualStore'
import { Hud } from '../ui/casual/Hud'
import { Menu } from '../ui/casual/Menu'
import { ResultCard } from '../ui/casual/ResultCard'
import { Stage } from '../ui/casual/Stage'

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useCasual.getState()
      if (s.screen !== 'play') return
      if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') s.restart()
      else if (e.key === 'Escape') s.toMenu()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function App() {
  const screen = useCasual((s) => s.screen)
  const levelId = useCasual((s) => s.levelId)
  useKeyboard()
  return (
    <main className="relative h-full w-full select-none overflow-hidden">
      <Stage />
      {screen === 'menu' && <Menu />}
      {screen === 'play' && <Hud key={levelId} />}
      {screen === 'play' && <ResultCard />}
    </main>
  )
}
