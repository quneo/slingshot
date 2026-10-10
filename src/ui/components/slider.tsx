import * as SliderPrimitive from '@radix-ui/react-slider'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface SliderProps extends ComponentProps<typeof SliderPrimitive.Root> {
  /** extra layer inside the track (e.g. a highlighted launch window) */
  trackOverlay?: ReactNode
  thumbClassName?: string
}

export function Slider({ className, trackOverlay, thumbClassName, ...props }: SliderProps) {
  return (
    <SliderPrimitive.Root
      className={cn('relative flex h-7 w-full touch-none select-none items-center', className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-line/80">
        {trackOverlay}
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-trail/70" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        className={cn(
          'block h-5 w-5 rounded-full border-2 border-trail bg-space shadow-[0_0_0_4px_rgba(77,207,245,0.15)] transition-transform duration-150 hover:scale-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-trail/30',
          thumbClassName,
        )}
      />
    </SliderPrimitive.Root>
  )
}
