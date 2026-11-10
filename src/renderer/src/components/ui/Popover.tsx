import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface PopoverProps {
  /** Bounding box of the element the popover hangs from; null = closed. */
  anchor: DOMRect | null
  onClose(): void
  children: ReactNode
  width?: number
  align?: 'start' | 'end'
}

/**
 * A floating panel rendered in a portal (so tree rows and scroll containers
 * can't clip it), positioned under its anchor and kept inside the window.
 */
export function Popover({ anchor, onClose, children, width = 260, align = 'start' }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!anchor) return setPos(null)
    const margin = 8
    const height = ref.current?.offsetHeight ?? 0
    let left = align === 'end' ? anchor.right - width : anchor.left
    left = Math.min(Math.max(margin, left), window.innerWidth - width - margin)
    let top = anchor.bottom + 4
    if (height && top + height > window.innerHeight - margin) top = Math.max(margin, anchor.top - height - 4)
    setPos({ left, top })
  }, [anchor, width, align])

  useEffect(() => {
    if (!anchor) return
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [anchor, onClose])

  return createPortal(
    <AnimatePresence>
      {anchor && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.1 } }}
          transition={{ type: 'spring', stiffness: 600, damping: 36 }}
          style={{ position: 'fixed', left: pos?.left ?? anchor.left, top: pos?.top ?? anchor.bottom + 4, width }}
          className="z-50 origin-top rounded-lg bg-panel p-1 shadow-pop"
          role="menu"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

export function MenuItem({
  icon,
  label,
  hint,
  onClick,
  color
}: {
  icon: ReactNode
  label: string
  hint?: string
  onClick(): void
  color?: string
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-raised focus-visible:bg-raised"
    >
      <span className="mt-0.5 shrink-0" style={color ? { color } : undefined}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-fg">{label}</span>
        {hint && <span className="block text-2xs leading-snug text-faint">{hint}</span>}
      </span>
    </button>
  )
}

/** Small helper: open a popover from a click on any element. */
export function usePopover() {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  return {
    anchor,
    open: (el: Element) => setAnchor(el.getBoundingClientRect()),
    close: () => setAnchor(null)
  }
}
