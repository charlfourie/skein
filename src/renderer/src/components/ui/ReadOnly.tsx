import { AnimatePresence, motion } from 'framer-motion'
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { cx } from '../../lib/cx'

/** A label and a value that can't be edited here, optionally with a copy button. */
export function ReadOnly({ label, value, mono, copyable }: { label: string; value: string; mono?: boolean; copyable?: boolean }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="shrink-0 text-faint">{label}</span>
      <span className="flex min-w-0 items-center gap-1">
        <span className={cx('truncate text-muted', mono && 'font-mono text-2xs')} title={value}>
          {value}
        </span>
        {copyable && (
          <button
            type="button"
            onClick={copy}
            aria-label={`Copy ${label}`}
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-faint transition-colors hover:bg-raised hover:text-fg"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={copied ? 'y' : 'n'}
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ duration: 0.12 }}
              >
                {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
              </motion.span>
            </AnimatePresence>
          </button>
        )}
      </span>
    </div>
  )
}
