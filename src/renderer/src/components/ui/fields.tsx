import { motion } from 'framer-motion'
import { AlertTriangle, XCircle } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { Issue } from '@shared/validate'
import { cx } from '../../lib/cx'

/**
 * Form primitives. Text edits commit on blur or Enter, never per keystroke, so
 * one edit is one undo step and the history stays meaningful.
 */

export const inputClass =
  'w-full rounded-md border border-line bg-bg px-2 py-1.5 text-fg placeholder:text-faint outline-none ' +
  'transition-[border-color,box-shadow,opacity] hover:border-faint/60 focus:border-accent focus:ring-2 focus:ring-accent/25 ' +
  'disabled:opacity-50'

export function FieldLabel({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted">{label}</span>
        {hint && <span className="text-2xs text-faint">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

interface TextInputProps {
  value: string
  onCommit(value: string): void
  placeholder?: string
  /** Disallow committing an empty value (reverts instead). */
  required?: boolean
  mono?: boolean
  dimmed?: boolean
  className?: string
  invalid?: boolean
  autoFocus?: boolean
}

export function TextInput({ value, onCommit, placeholder, required, mono, dimmed, className, invalid, autoFocus }: TextInputProps) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  const commit = () => {
    const next = draft.trim()
    if (required && !next) return setDraft(value)
    if (next !== value) onCommit(next)
    else setDraft(value)
  }

  return (
    <input
      value={draft}
      placeholder={placeholder}
      autoFocus={autoFocus}
      spellCheck={!mono}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(value)
          const el = e.currentTarget
          requestAnimationFrame(() => el.blur())
        }
      }}
      className={cx(
        inputClass,
        mono && 'font-mono text-xs',
        dimmed && 'text-muted',
        invalid && 'border-danger/70 focus:border-danger focus:ring-danger/25',
        className
      )}
    />
  )
}

export function TextArea({
  value,
  onCommit,
  placeholder,
  rows = 4,
  dimmed
}: {
  value: string
  onCommit(value: string): void
  placeholder?: string
  rows?: number
  dimmed?: boolean
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <textarea
      value={draft}
      placeholder={placeholder}
      rows={rows}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      className={cx(inputClass, 'resize-y leading-relaxed', dimmed && 'text-muted')}
    />
  )
}

/** Number input; an empty field commits `null`. Invalid text reverts. */
export function NumberInput({
  value,
  onCommit,
  placeholder,
  dimmed,
  invalid
}: {
  value: number | null
  onCommit(value: number | null): void
  placeholder?: string
  dimmed?: boolean
  invalid?: boolean
}) {
  const shown = value === null ? '' : String(value)
  const [draft, setDraft] = useState(shown)
  useEffect(() => setDraft(shown), [shown])

  const commit = () => {
    const text = draft.trim()
    if (text === '') return value !== null ? onCommit(null) : undefined
    const n = Number(text)
    if (!Number.isFinite(n)) return setDraft(shown)
    if (n !== value) onCommit(n)
  }

  return (
    <input
      inputMode="decimal"
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setDraft(shown)
          const el = e.currentTarget
          requestAnimationFrame(() => el.blur())
        }
      }}
      className={cx(inputClass, 'tabular-nums', dimmed && 'text-muted', invalid && 'border-warn/70')}
    />
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  dimmed
}: {
  checked: boolean
  onChange(value: boolean): void
  label?: string
  dimmed?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-accent/60',
        checked ? 'bg-accent' : 'bg-line',
        dimmed && 'opacity-60'
      )}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 700, damping: 35 }}
        className={cx('h-4 w-4 rounded-full bg-fg shadow', checked ? 'ml-[18px]' : 'ml-0.5')}
      />
    </button>
  )
}

export interface SelectOption {
  value: string
  label: string
  group?: string
}

export function Select({
  value,
  options,
  onChange,
  placeholder,
  dimmed,
  invalid
}: {
  value: string | null
  options: SelectOption[]
  onChange(value: string | null): void
  placeholder?: string
  dimmed?: boolean
  invalid?: boolean
}) {
  const groups = new Map<string | undefined, SelectOption[]>()
  for (const o of options) {
    const list = groups.get(o.group)
    if (list) list.push(o)
    else groups.set(o.group, [o])
  }
  const known = value === null || options.some((o) => o.value === value)
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      className={cx(inputClass, 'cursor-pointer appearance-auto pr-1', dimmed && 'text-muted', invalid && 'border-warn/70')}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {!known && <option value={value ?? ''}>(missing)</option>}
      {[...groups.entries()].map(([group, list]) =>
        group ? (
          <optgroup key={group} label={group}>
            {list.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ) : (
          list.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))
        )
      )}
    </select>
  )
}

export function ColorInput({ value, onCommit, dimmed }: { value: string; onCommit(value: string): void; dimmed?: boolean }) {
  return (
    <div className={cx('flex items-center gap-2', dimmed && 'opacity-70')}>
      <label
        className="relative h-7 w-9 shrink-0 cursor-pointer overflow-hidden rounded-md border border-line"
        style={{ background: value }}
      >
        <input
          type="color"
          value={value}
          onChange={(e) => onCommit(e.target.value.toLowerCase())}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      <TextInput
        value={value}
        mono
        onCommit={(v) => /^#[0-9a-fA-F]{6}$/.test(v) && onCommit(v.toLowerCase())}
        className="w-28"
      />
    </div>
  )
}

export function IssueList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return null
  return (
    <ul className="mt-1 space-y-0.5">
      {issues.map((issue, i) => (
        <motion.li
          key={i}
          initial={{ opacity: 0, y: -2 }}
          animate={{ opacity: 1, y: 0 }}
          className={cx('flex items-start gap-1.5 text-2xs leading-snug', issue.level === 'error' ? 'text-danger' : 'text-warn')}
        >
          {issue.level === 'error' ? (
            <XCircle size={11} className="mt-px shrink-0" />
          ) : (
            <AlertTriangle size={11} className="mt-px shrink-0" />
          )}
          {issue.message}
        </motion.li>
      ))}
    </ul>
  )
}
