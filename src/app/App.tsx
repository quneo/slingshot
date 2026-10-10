import { useEffect } from 'react'
import { useGame } from '../state/gameStore'
import { GameCanvas } from '../ui/GameCanvas'
import { FlightHud } from '../ui/screens/FlightHud'
import { MissionSelect } from '../ui/screens/MissionSelect'
import { PlanningScreen } from '../ui/screens/PlanningScreen'
import { ResultPanel } from '../ui/screens/ResultPanel'
import { SettingsDialog } from '../ui/screens/SettingsDialog'
import { Tour } from '../ui/tour/Tour'

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, [role="slider"], [role="dialog"]')) return
      const s = useGame.getState()
      if (s.screen !== 'mission') return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        s.undo()
      } else if (s.phase === 'flight' && e.key === ' ') {
        e.preventDefault()
        s.setFlightPlaying(!s.flight.playing)
      } else if (s.phase === 'plan' && e.key === 'Enter' && !target.closest('button')) {
        s.launch()
      } else if (s.phase === 'plan' && (e.key === 'Delete' || e.key === 'Backspace') && s.selection?.kind === 'node') {
        s.removeNode(s.selection.id)
      } else if (e.key === 'Escape' && s.phase !== 'plan') {
        s.backToPlanning()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function App() {
  const screen = useGame((s) => s.screen)
  const phase = useGame((s) => s.phase)
  const levelId = useGame((s) => s.levelId)
  useKeyboard()
  return (
    <main className="relative h-full w-full overflow-hidden">
      <GameCanvas />
      {screen === 'menu' && <MissionSelect />}
      {/* keyed by mission: local UI state (open editor, expanded card) starts fresh in every mission */}
      {screen === 'mission' && phase === 'plan' && <PlanningScreen key={levelId} />}
      {screen === 'mission' && phase === 'flight' && <FlightHud />}
      {screen === 'mission' && phase === 'result' && <ResultPanel />}
      {screen === 'mission' && <Tour />}
      <SettingsDialog />
    </main>
  )
}
