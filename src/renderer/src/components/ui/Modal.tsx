import { AnimatePresence, motion } from 'framer-motion'
import { X, type LucideIcon } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'

/**
 * A centred dialog over a dimmed backdrop. Escape and a click on the backdrop
 * close it. The body scrolls; the footer stays put.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon: Icon,
  width = 640,
  footer,
  children
}: {
  open: boolean
  onClose(): void
  title: string
  subtitle?: ReactNode
  icon?: LucideIcon
  width?: number
  footer?: ReactNode
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="modal"
          className="fixed inset-0 z-40 grid place-items-center bg-black/55 p-6 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            style={{ width }}
            className="flex max-h-full max-w-full flex-col overflow-hidden rounded-xl bg-panel shadow-pop"
          >
            <div className="flex items-start gap-3 border-b border-line px-5 py-4">
              {Icon && (
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
                  <Icon size={18} />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-fg">{title}</h2>
                {subtitle && <div className="mt-0.5 text-xs leading-relaxed text-muted">{subtitle}</div>}
              </div>
              <button type="button" onClick={onClose} aria-label="Close" className="grid h-7 w-7 place-items-center rounded text-faint hover:bg-raised hover:text-fg">
                <X size={15} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex items-center gap-2 border-t border-line px-5 py-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
