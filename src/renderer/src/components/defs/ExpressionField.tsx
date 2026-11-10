import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, CircleDashed, Plus, XCircle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { compile, getEnv, type CompileContext, type Mode } from '@shared/expr/check'
import { evaluateAtStart } from '@shared/expr/runtime'
import type { Diagnostic } from '@shared/expr/syntax'
import type { Project } from '@shared/schema'
import { cx } from '../../lib/cx'
import { inputClass } from '../ui/fields'
import { Popover, usePopover } from '../ui/Popover'

/**
 * An expression editor with live checking. Typing is checked on every
 * keystroke; the value is committed on blur (one undo step per edit).
 */
export function ExpressionField({
  project,
  value,
  mode,
  ctx,
  onCommit,
  placeholder,
  rows = 2,
  preview = mode === 'condition'
}: {
  project: Project
  value: string
  mode: Mode
  ctx?: CompileContext
  onCommit(value: string): void
  placeholder?: string
  rows?: number
  preview?: boolean
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const ref = useRef<HTMLTextAreaElement>(null)
  const insert = usePopover()

  const result = useMemo(() => compile(project, draft, mode, ctx), [project, draft, mode, ctx])
  const atStart = useMemo(() => (preview && result.ok && !ctx?.selfTemplateId ? evaluateAtStart(project, draft) : null), [preview, result.ok, project, draft, ctx])
  const errors = result.diagnostics.filter((d) => d.level === 'error')
  const warnings = result.diagnostics.filter((d) => d.level === 'warning')

  const commit = () => draft !== value && onCommit(draft)

  const insertText = (text: string) => {
    const el = ref.current
    const start = el?.selectionStart ?? draft.length
    const end = el?.selectionEnd ?? draft.length
    const before = draft.slice(0, start)
    const pad = before && !/\s$/.test(before) ? ' ' : ''
    const next = before + pad + text + draft.slice(end)
    setDraft(next)
    insert.close()
    requestAnimationFrame(() => {
      el?.focus()
      const pos = start + pad.length + text.length
      el?.setSelectionRange(pos, pos)
    })
  }

  return (
    <div>
      <div className="relative">
        <textarea
          ref={ref}
          value={draft}
          rows={rows}
          spellCheck={false}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => {
            // Don't commit when focus moves into the insert menu.
            if ((e.relatedTarget as Element | null)?.closest('[role="menu"]')) return
            commit()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft(value)
              e.currentTarget.blur()
            }
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.currentTarget.blur()
          }}
          className={cx(
            inputClass,
            'resize-y pr-16 font-mono text-xs leading-relaxed',
            errors.length > 0 && 'border-danger/70 focus:border-danger focus:ring-danger/25'
          )}
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => insert.open(e.currentTarget)}
          className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded bg-raised px-1.5 py-0.5 text-2xs text-muted transition-colors hover:text-fg"
          title="Insert a name"
        >
          <Plus size={11} /> Insert
        </button>
      </div>

      <AnimatePresence initial={false} mode="popLayout">
        {errors.length > 0 ? (
          <motion.div key="err" initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-1.5 space-y-1">
            {errors.map((d, i) => (
              <DiagnosticLine key={i} d={d} source={draft} />
            ))}
          </motion.div>
        ) : (
          <motion.div key="ok" initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs">
            {result.empty ? (
              <span className="flex items-center gap-1 text-faint">
                <CircleDashed size={11} /> {mode === 'condition' ? 'Always passes when empty' : 'Nothing happens when empty'}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-ok">
                <CheckCircle2 size={11} /> Valid
              </span>
            )}
            {atStart !== null && (
              <span className={atStart ? 'text-ok' : 'text-muted'}>
                At game start: <strong>{atStart ? 'true' : 'false'}</strong>
              </span>
            )}
            {warnings.map((w, i) => (
              <span key={i} className="flex items-center gap-1 text-warn">
                <AlertTriangle size={11} /> {w.message}
              </span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <Popover anchor={insert.anchor} onClose={insert.close} width={320} align="end">
        <InsertMenu project={project} mode={mode} ctx={ctx} onPick={insertText} />
      </Popover>
    </div>
  )
}

/** The message plus the source line with the offending span highlighted. */
function DiagnosticLine({ d, source }: { d: Diagnostic; source: string }) {
  const lineStart = source.lastIndexOf('\n', Math.max(0, d.start - 1)) + 1
  const lineEndIdx = source.indexOf('\n', d.start)
  const lineEnd = lineEndIdx < 0 ? source.length : lineEndIdx
  const line = source.slice(lineStart, lineEnd)
  const a = Math.max(0, d.start - lineStart)
  const b = Math.max(a + 1, Math.min(line.length, d.end - lineStart))
  const lineNo = source.slice(0, lineStart).split('\n').length
  return (
    <div className="rounded-md border border-danger/30 bg-danger/[0.06] px-2 py-1.5">
      <p className="flex items-start gap-1.5 text-2xs leading-snug text-danger">
        <XCircle size={11} className="mt-px shrink-0" />
        <span>
          {d.message}
          {source.includes('\n') && <span className="text-danger/70"> (line {lineNo})</span>}
        </span>
      </p>
      {line.trim() && (
        <pre className="mt-1 overflow-x-auto whitespace-pre font-mono text-2xs text-muted">
          {line.slice(0, a)}
          <mark className="rounded-sm bg-danger/30 px-px text-fg underline decoration-danger decoration-wavy underline-offset-2">
            {line.slice(a, b) || ' '}
          </mark>
          {line.slice(b)}
        </pre>
      )}
    </div>
  )
}

interface Group {
  title: string
  items: Array<{ text: string; hint?: string }>
}

function InsertMenu({ project, mode, ctx, onPick }: { project: Project; mode: Mode; ctx?: CompileContext; onPick(text: string): void }) {
  const [filter, setFilter] = useState('')
  const groups = useMemo<Group[]>(() => {
    const env = getEnv(project)
    const out: Group[] = []
    const vars = Object.values(project.state.variables).sort((a, b) => a.namespace.localeCompare(b.namespace) || a.order - b.order)
    if (vars.length) out.push({ title: 'World variables', items: vars.map((v) => ({ text: `${v.namespace}.${v.technicalName}`, hint: v.name })) })
    out.push({
      title: 'Time',
      items: [
        { text: 'Time.Day', hint: 'day number' },
        { text: 'Time.Phase', hint: env.phases.map((p) => p.technicalName).join(' / ') },
        ...(mode === 'action' && ctx?.allowAdvance !== false
          ? [
              { text: 'advance', hint: 'one phase' },
              ...env.phases.flatMap((p) => [
                { text: `advance until ${p.technicalName}`, hint: `stays if already ${p.label}` },
                { text: `advance to ${p.technicalName}`, hint: `next ${p.label}: a whole day if already ${p.label}` }
              ])
            ]
          : [])
      ]
    })
    if (mode === 'action' || ctx?.allowRandom) {
      out.push({
        title: 'Dice',
        items: [
          { text: 'chance(50)', hint: 'true half the time' },
          { text: 'roll(1, 6)', hint: 'a whole number from 1 to 6' }
        ]
      })
    }
    if (mode === 'condition' && env.tags.size) {
      const items: Group['items'] = []
      for (const [tag, at] of [...env.tags.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const flow = project.flows[at.flowId]
        items.push({ text: `Seen.${tag}`, hint: flow ? `in ${flow.name}` : '' }, { text: `Visits.${tag}`, hint: 'how many times' })
      }
      out.push({ title: 'Seen (tagged nodes)', items })
    }
    const self = ctx?.selfTemplateId ? project.templates[ctx.selfTemplateId] : undefined
    if (self) {
      out.push({
        title: `self (each ${self.name})`,
        items: Object.values(self.properties)
          .sort((a, b) => Number(Boolean(b.mutable)) - Number(Boolean(a.mutable)) || a.order - b.order)
          .filter((p) => mode === 'condition' || p.mutable)
          .map((p) => ({ text: `self.${p.technicalName}`, hint: p.mutable ? 'state' : 'fixed' }))
      })
    }
    const entityItems: Group['items'] = []
    for (const e of Object.values(project.entities).sort((a, b) => a.name.localeCompare(b.name))) {
      const t = project.templates[e.templateId]
      for (const p of Object.values(t?.properties ?? {}).sort((a, b) => a.order - b.order)) {
        if (mode === 'action' && !p.mutable) continue
        entityItems.push({ text: `${e.technicalName}.${p.technicalName}`, hint: p.mutable ? 'state' : 'fixed' })
      }
    }
    if (entityItems.length) out.push({ title: mode === 'action' ? 'Character & thing state' : 'Characters & things', items: entityItems })
    const relItems: Group['items'] = []
    for (const r of Object.values(project.state.relationships)) {
      const froms = Object.values(project.entities).filter((e) => e.templateId === r.fromTemplateId)
      const tos = Object.values(project.entities).filter((e) => e.templateId === r.toTemplateId)
      for (const a of froms) for (const b of tos) if (a.id !== b.id) relItems.push({ text: `${a.technicalName}->${b.technicalName}.${r.technicalName}`, hint: r.name })
    }
    if (relItems.length) out.push({ title: 'Relationships (one-way)', items: relItems.slice(0, 200) })
    return out
  }, [project, mode, ctx])

  const f = filter.trim().toLowerCase()
  return (
    <div className="flex max-h-80 flex-col">
      <input
        autoFocus
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter…"
        className="mx-1 mb-1 mt-1 rounded-md border border-line bg-bg px-2 py-1 text-xs text-fg outline-none focus:border-accent"
      />
      <div className="overflow-y-auto">
        {groups.map((g) => {
          const items = g.items.filter((i) => !f || i.text.toLowerCase().includes(f))
          if (!items.length) return null
          return (
            <div key={g.title} className="mb-1">
              <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-faint">{g.title}</p>
              {items.map((i) => (
                <button
                  key={i.text}
                  type="button"
                  onClick={() => onPick(i.text)}
                  className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left hover:bg-raised"
                >
                  <code className="truncate font-mono text-xs text-fg">{i.text}</code>
                  {i.hint && <span className="shrink-0 text-[10px] text-faint">{i.hint}</span>}
                </button>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
