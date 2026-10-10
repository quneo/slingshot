import { CircleHelp } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../components/button'
import { HelpDialog } from './HelpDialog'

export function HelpButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="icon" className={className} onClick={() => setOpen(true)} aria-label="Как управлять" title="Как управлять" data-tour="help">
        <CircleHelp size={20} />
      </Button>
      <HelpDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
