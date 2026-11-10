import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, ChevronRight, FileJson, PackageOpen, X, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { buildExport, serializeExport, type ExportProblem } from '@shared/export/build'
import type { Project } from '@shared/schema'
import { cx } from '../../lib/cx'
import { basename, shortcut, suggestedFileName } from '../../lib/platform'
import { toast } from '../../lib/toast'
import { useProjectStore } from '../../store/projectStore'
import { useUi } from '../../store/ui'
import { Button } from '../ui/Button'
import { Toggle } from '../ui/fields'

const PREFS_KEY = 'skein.exportPrefs.v1'

interface Prefs {
  compact: boolean
  includeSource: boolean
  /** Last export location per project id (this machine only). */
  lastPath: Record<string, string>
}

function loadPrefs(): Prefs {
  try {
    return { compact: false, includeSource: true, lastPath: {}, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }
  } catch {
    return { compact: false, includeSource: true, lastPath: {} }
  }
}

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    // Not persisted; harmless.
  }
}

export function ExportDialog() {
  const open = useUi((s) => s.exportOpen)
  const setOpen = useUi((s) => s.setExportOpen)
  const project = useProjectStore((s) => s.project)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  return (
    <AnimatePresence>
      {open && project && (
        <motion.div
          key="export"
          className="fixed inset-0 z-40 grid place-items-center bg-black/55 p-6 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Export for game engine"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className="flex max-h-full w-[640px] max-w-full flex-col overflow-hidden rounded-xl bg-panel shadow-pop"
          >
            <ExportBody project={project} onClose={() => setOpen(false)} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function ExportBody({ project, onClose }: { project: Project; onClose(): void }) {
  const [prefs, setPrefs] = useState(loadPrefs)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const focusNode = useProjectStore((s) => s.focusNode)
  const select = useProjectStore((s) => s.select)

  const update = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch }
      savePrefs(next)
      return next
    })

  const { file, problems } = useMemo(() => buildExport(project, { includeSource: prefs.includeSource }), [project, prefs.includeSource])
  const text = useMemo(() => serializeExport(file, prefs.compact), [file, prefs.compact])
  const errors = problems.filter((p) => p.level === 'error')
  const warnings = problems.filter((p) => p.level === 'warning')
  const nodes = Object.values(file.flows).reduce((n, f) => n + Object.keys(f.nodes).length, 0)
  const lastPath = prefs.lastPath[project.meta.id]

  const go = (p: ExportProblem) => {
    if (!p.at) return
    onClose()
    if (p.at.kind === 'node') focusNode(p.at.flowId, p.at.nodeId)
    else select({ kind: 'state', id: 'time' })
  }

  const doExport = async () => {
    if (errors.length) {
      const ok = await window.api.confirm({
        message: `Export with ${errors.length} error${errors.length === 1 ? '' : 's'}?`,
        detail: 'Broken conditions are exported as “always false” and broken actions as “no change”, so the game stays safe, but those parts won’t work as written.',
        confirmLabel: 'Export anyway',
        danger: true
      })
      if (!ok) return
    }
    const suggested = lastPath ?? suggestedFileName(project.meta.name).replace(/\.skein\.json$/, '.game.json')
    const path = await window.api.exportDialog(suggested)
    if (!path) return
    setBusy(true)
    const res = await window.api.exportWrite(path, text)
    setBusy(false)
    if (!res.ok) return void toast.error('Export failed', res.error)
    update({ lastPath: { ...prefs.lastPath, [project.meta.id]: res.path } })
    toast.success('Exported for game engine', `${basename(res.path)} · ${formatBytes(res.bytes)}`)
    onClose()
  }

  return (
    <>
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
          <PackageOpen size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-fg">Export for game engine</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            A clean JSON file for your game: no canvas positions, colours or notes; everything named by its technical name; every
            condition and action pre-compiled so the engine needs no parser. Format spec: <code className="text-fg">docs/EXPORT.md</code>.
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="grid h-7 w-7 place-items-center rounded text-faint hover:bg-raised hover:text-fg">
          <X size={15} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="grid grid-cols-5 gap-2">
          {(
            [
              ['Flows', Object.keys(file.flows).length],
              ['Nodes', nodes],
              ['Entities', Object.keys(file.entities).length],
              ['State items', Object.keys(file.state.variables).length + Object.keys(file.state.relationships).length],
              ['Rules', file.state.rules.length]
            ] as const
          ).map(([label, n]) => (
            <div key={label} className="rounded-lg bg-raised/50 px-2.5 py-2">
              <div className="text-sm font-semibold tabular-nums text-fg">{n}</div>
              <div className="text-2xs text-faint">{label}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-2.5 rounded-lg border border-line bg-bg/40 p-3">
          <OptionRow
            label="Include expression text"
            hint="Keep each condition’s and action’s original text beside its compiled form. Handy for debugging; turn off for a smaller file."
            checked={prefs.includeSource}
            onChange={(includeSource) => update({ includeSource })}
          />
          <OptionRow
            label="Compact"
            hint="No whitespace: smallest file. Leave off for readable, diff-friendly output."
            checked={prefs.compact}
            onChange={(compact) => update({ compact })}
          />
        </div>

        <AnimatePresence initial={false}>
          {problems.length > 0 && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div
                className={cx(
                  'mt-4 rounded-lg border p-3',
                  errors.length ? 'border-danger/40 bg-danger/[0.06]' : 'border-warn/40 bg-warn/[0.06]'
                )}
              >
                <p className={cx('mb-1.5 flex items-center gap-1.5 text-xs font-medium', errors.length ? 'text-danger' : 'text-warn')}>
                  {errors.length ? <XCircle size={13} /> : <AlertTriangle size={13} />}
                  {errors.length ? `${errors.length} error${errors.length === 1 ? '' : 's'}` : ''}
                  {errors.length && warnings.length ? ' · ' : ''}
                  {warnings.length ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''}
                </p>
                <ul className="max-h-36 space-y-1 overflow-y-auto">
                  {[...errors, ...warnings].map((p, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        disabled={!p.at}
                        onClick={() => go(p)}
                        className="flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-left text-2xs leading-snug text-muted hover:bg-raised/60 hover:text-fg disabled:pointer-events-none"
                      >
                        <span className={p.level === 'error' ? 'text-danger' : 'text-warn'}>•</span>
                        <span className="flex-1">{p.message}</span>
                        {p.at && <ChevronRight size={11} className="mt-0.5 shrink-0 text-faint" />}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          type="button"
          onClick={() => setPreview((v) => !v)}
          className="mt-4 flex items-center gap-1.5 text-xs text-muted hover:text-fg"
        >
          <motion.span animate={{ rotate: preview ? 90 : 0 }}>
            <ChevronRight size={13} />
          </motion.span>
          <FileJson size={13} /> Preview · {formatBytes(new TextEncoder().encode(text).length)}
        </button>
        <AnimatePresence initial={false}>
          {preview && (
            <motion.pre
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-2 max-h-72 overflow-auto rounded-lg border border-line bg-bg p-3 font-mono text-[11px] leading-relaxed text-muted"
            >
              {text.length > 60_000 ? `${text.slice(0, 60_000)}\n… (${formatBytes(text.length - 60_000)} more)` : text}
            </motion.pre>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        <span className="min-w-0 flex-1 truncate text-2xs text-faint" title={lastPath}>
          {lastPath ? `Last exported to ${lastPath}` : `Shortcut: ${shortcut('E')}`}
        </span>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" icon={PackageOpen} onClick={() => void doExport()} disabled={busy}>
          {busy ? 'Exporting…' : 'Export…'}
        </Button>
      </div>
    </>
  )
}

function OptionRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-xs text-fg">{label}</p>
        <p className="text-2xs leading-snug text-faint">{hint}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  )
}

function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`
}
