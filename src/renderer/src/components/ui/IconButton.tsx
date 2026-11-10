import { motion, type HTMLMotionProps } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import { cx } from '../../lib/cx'

interface IconButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  icon: LucideIcon
  label: string
  active?: boolean
  size?: 'sm' | 'md'
  tone?: 'default' | 'accent' | 'danger'
}

export function IconButton({
  icon: Icon,
  label,
  active = false,
  size = 'md',
  tone = 'default',
  className,
  ...rest
}: IconButtonProps) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-md transition-colors',
        'focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-35',
        size === 'sm' ? 'h-6 w-6' : 'h-8 w-8',
        tone === 'accent'
          ? 'text-accent hover:bg-accent/15'
          : tone === 'danger'
            ? 'text-muted hover:bg-danger/15 hover:text-danger'
            : 'text-muted hover:bg-raised hover:text-fg',
        active && 'bg-raised text-fg',
        className
      )}
      {...rest}
    >
      <Icon size={size === 'sm' ? 14 : 16} strokeWidth={1.75} />
    </motion.button>
  )
}
