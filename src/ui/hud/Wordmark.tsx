import { cn } from '@/lib/utils'

/** SLINGSHOT wordmark: the O is a planet with its orbit and a probe slinging around it. */
export function Wordmark({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <div className={cn('pointer-events-none select-none', className)} aria-label="Slingshot">
      <div
        className={cn(
          'flex items-center font-display font-bold leading-none tracking-[0.16em] text-transparent',
          compact ? 'text-[19px]' : 'text-[30px]',
        )}
        style={{ backgroundImage: 'linear-gradient(180deg, #ffffff 15%, #ffe2b8 100%)', backgroundClip: 'text', WebkitBackgroundClip: 'text' }}
      >
        <span>SLINGSH</span>
        <OrbitO size={compact ? 20 : 31} />
        <span>T</span>
      </div>
      {!compact && <div className="mt-1.5 text-[12px] font-semibold tracking-[0.06em] text-ink-2">Мало топлива. Большие возможности.</div>}
    </div>
  )
}

function OrbitO({ size }: { size: number }) {
  return (
    <svg width={size * 1.12} height={size} viewBox="0 0 36 32" className="mx-[0.06em] -mt-[0.04em]" aria-hidden>
      <defs>
        <radialGradient id="wm-planet" cx="0.35" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#fff2d6" />
          <stop offset="0.55" stopColor="#ffd9a3" />
          <stop offset="1" stopColor="#f0a24a" />
        </radialGradient>
      </defs>
      <circle cx="18" cy="16" r="10.5" fill="none" stroke="url(#wm-planet)" strokeWidth="4.2" />
      <ellipse cx="18" cy="16" rx="17" ry="6.2" fill="none" stroke="#FFB64D" strokeWidth="2.2" transform="rotate(-30 18 16)" />
      <circle cx="31.6" cy="7.4" r="3" fill="#FFB64D" />
      <circle cx="4.6" cy="24.4" r="1.9" fill="#FFB64D" opacity="0.8" />
    </svg>
  )
}
