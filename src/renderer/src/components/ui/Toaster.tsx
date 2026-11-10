import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Info, X, XCircle, type LucideIcon } from 'lucide-react'
import { useEffect } from 'react'
import { cx } from '../../lib/cx'
import { useToasts, type Toast, type ToastTone } from '../../lib/toast'

const TONE: Record<ToastTone, { icon: LucideIcon; className: string }> = {
  success: { icon: CheckCircle2, className: 'text-ok' },
  info: { icon: Info, className: 'text-accent' },
  warn: { icon: AlertTriangle, className: 'text-warn' },
  error: { icon: XCircle, className: 'text-danger' }
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts)
  return (
    <ol className="pointer-events-none fixed bottom-9 right-3 z-50 flex w-[360px] max-w-[calc(100vw-24px)] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </AnimatePresence>
    </ol>
  )
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToasts((s) => s.dismiss)
  const { icon: Icon, className } = TONE[toast.tone]

  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), toast.duration)
    return () => clearTimeout(timer)
  }, [toast.id, toast.duration, dismiss])

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 500, damping: 34 }}
      className="pointer-events-auto flex gap-2.5 rounded-lg bg-panel/95 p-3 shadow-pop backdrop-blur"
      role={toast.tone === 'error' ? 'alert' : 'status'}
    >
      <Icon size={16} className={cx('mt-px shrink-0', className)} />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-fg">{toast.title}</p>
        {toast.detail && (
          <p className="mt-0.5 whitespace-pre-line break-words text-xs leading-relaxed text-muted">{toast.detail}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label="Dismiss"
        className="-m-1 h-6 w-6 shrink-0 rounded text-faint transition-colors hover:bg-raised hover:text-fg"
      >
        <X size={14} className="mx-auto" />
      </button>
    </motion.li>
  )
}
