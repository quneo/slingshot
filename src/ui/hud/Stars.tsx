import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Stars({ value, size = 16, className, animate = false }: { value: number; size?: number; className?: string; animate?: boolean }) {
  return (
    <div className={cn('flex items-center gap-0.5', className)} aria-label={`Звёзд: ${value} из 3`} role="img">
      {[0, 1, 2].map((i) => (
        <Star
          key={i}
          size={size}
          className={cn(i < value ? 'fill-gold text-gold' : 'text-ink-3', animate && i < value && 'animate-pop')}
          style={animate ? { animationDelay: `${200 + i * 160}ms` } : undefined}
          strokeWidth={i < value ? 1.5 : 1.75}
          aria-hidden
        />
      ))}
    </div>
  )
}
