import { motion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/** Title block at the top of a template or entity document. */
export function DocHeader({
  icon: Icon,
  color,
  title,
  technicalName,
  meta,
  actions
}: {
  icon: LucideIcon
  color: string
  title: string
  technicalName?: string
  meta?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex items-start gap-4">
      <motion.div
        key={color}
        initial={{ scale: 0.9, opacity: 0.6 }}
        animate={{ scale: 1, opacity: 1 }}
        className="grid h-12 w-12 shrink-0 place-items-center rounded-xl"
        style={{ background: `${color}22`, color, boxShadow: `inset 0 0 0 1px ${color}55` }}
      >
        <Icon size={22} strokeWidth={1.7} />
      </motion.div>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-semibold tracking-tight text-fg">{title}</h1>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {technicalName && <code className="rounded bg-raised px-1.5 py-0.5 font-mono text-2xs text-muted">{technicalName}</code>}
          {meta}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  )
}
