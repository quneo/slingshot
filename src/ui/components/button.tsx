import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-bold select-none transition-[background-color,border-color,color,transform,opacity] duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        go: 'bg-go text-go-ink hover:bg-[#4be7af] shadow-[0_10px_30px_-12px_rgba(55,220,160,0.7)]',
        panel: 'panel-quiet text-ink hover:border-trail/60 hover:bg-panel',
        ghost: 'text-ink-2 hover:text-ink hover:bg-white/5',
        danger: 'bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25',
        outline: 'border border-line text-ink hover:border-trail/70 hover:bg-trail/5',
      },
      size: {
        sm: 'h-8 rounded-lg px-3 text-[13px]',
        md: 'h-10 rounded-xl px-4 text-sm',
        lg: 'h-12 rounded-2xl px-5 text-[15px]',
        xl: 'h-16 rounded-2xl px-7 text-[22px] font-extrabold',
        icon: 'h-11 w-11 rounded-xl',
        iconSm: 'h-9 w-9 rounded-lg',
      },
    },
    defaultVariants: { variant: 'panel', size: 'md' },
  },
)

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
