import { motion, type HTMLMotionProps } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '../../lib/cx'

interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: 'primary' | 'ghost' | 'subtle'
  icon?: LucideIcon
  children: ReactNode
}

export function Button({ variant = 'subtle', icon: Icon, className, children, ...rest }: ButtonProps) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      className={cx(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
        'focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-40',
        variant === 'primary' && 'bg-accent text-bg hover:bg-accent/90',
        variant === 'subtle' && 'bg-raised text-fg ring-1 ring-line hover:bg-line/70',
        variant === 'ghost' && 'text-muted hover:bg-raised hover:text-fg',
        className
      )}
      {...rest}
    >
      {Icon && <Icon size={14} strokeWidth={1.9} />}
      {children}
    </motion.button>
  )
}
