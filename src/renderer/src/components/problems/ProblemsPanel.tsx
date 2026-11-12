import { AlertTriangle, CheckCircle2, ChevronRight, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { collectProblems, type Problem } from '@shared/problems'
import type { Project } from '@shared/schema'
import { cx } from '../../lib/cx'
import { usePlay } from '../../store/play'
import { useProjectStore } from '../../store/projectStore'
import { useTests } from '../../store/tests'

/** Everything wrong in the project, grouped by where it is. Click one to go there. */
export function ProblemsPanel({ project }: { project: Project }) {
  const tests = useTests((s) => s.results)
  const problems = useProblems(project, tests)
  const [levels, setLevels] = useState({ error: true, warning: true })
  const shown = problems.filter((p) => levels[p.level])
  const errors = problems.filter((p) => p.level === 'error').length
  const warnings = problems.length - errors

  const groups = useMemo(() => {
    const map = new Map<string, Problem[]>()
    for (const p of shown) {
      const list = map.get(p.group)
      if (list) list.push(p)
      else map.set(p.group, [p])
    }
    return [...map.entries()]
  }, [shown])

  const chip = (level: 'error' | 'warning', n: number) => (
    <button
      type="button"
      aria-pressed={levels[level]}
      onClick={() => setLevels({ ...levels, [level]: !levels[level] })}
      className={cx(
        'flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs transition-colors',
        levels[level] ? (level === 'error' ? 'border-danger/50 bg-danger/10 text-danger' : 'border-warn/50 bg-warn/10 text-warn') : 'border-line text-faint'
      )}
    >
      {level === 'error' ? <XCircle size={11} /> : <AlertTriangle size={11} />}
      {n} {level === 'error' ? `error${n === 1 ? '' : 's'}` : `warning${n === 1 ? '' : 's'}`}
    </button>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-1 px-2 pb-2">
        {chip('error', errors)}
        {chip('warning', warnings)}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
        {problems.length === 0 ? (
          <p className="flex items-center gap-1.5 px-2 text-2xs text-ok">
            <CheckCircle2 size={12} /> No problems. Every flow, rule and test checks out.
          </p>
        ) : (
          groups.map(([group, list]) => <Group key={group} title={group} problems={list} />)
        )}
      </div>
    </div>
  )
}

function Group({ title, problems }: { title: string; problems: Problem[] }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="mt-1">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-2xs font-semibold text-muted hover:bg-raised/60">
        <ChevronRight size={12} className={cx('shrink-0 transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="tabular-nums text-faint">{problems.length}</span>
      </button>
      {open && (
        <ul>
          {problems.map((p, i) => (
            <li key={i}>
              <button type="button" onClick={() => goToProblem(p)} className="flex w-full items-start gap-1.5 rounded px-2 py-1 pl-5 text-left hover:bg-raised/60">
                {p.level === 'error' ? <XCircle size={12} className="mt-0.5 shrink-0 text-danger" /> : <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warn" />}
                <span className="min-w-0 flex-1">
                  {p.label && <span className="block truncate text-[10px] uppercase tracking-wider text-faint">{p.label}</span>}
                  <span className="block text-xs leading-snug text-muted">{p.message}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type Results = ReturnType<typeof useTests.getState>['results']
/** One list per project snapshot and test run, shared by the panel and the status bar. */
const cache = new WeakMap<Project, { tests: Results; problems: Problem[] }>()

/** The project's problems, recomputed only when the project or the test results change. */
export function useProblems(project: Project, tests: Results): Problem[] {
  const hit = cache.get(project)
  if (hit && hit.tests === tests) return hit.problems
  const problems = collectProblems(project, { tests })
  cache.set(project, { tests, problems })
  return problems
}

export function goToProblem(p: Problem): void {
  const s = useProjectStore.getState()
  const place = p.place
  switch (place.kind) {
    case 'node':
      return s.focusNode(place.flowId, place.nodeId)
    case 'flow':
      return s.openDoc({ kind: 'flow', id: place.flowId })
    case 'test':
      s.openDoc({ kind: 'flow', id: place.flowId })
      return usePlay.getState().openFor(place.flowId, 'tests')
    case 'rule':
      return s.select({ kind: 'state', id: 'time' })
    case 'entity':
      return s.select({ kind: 'entity', id: place.entityId })
    case 'template':
      return s.select({ kind: 'template', id: place.templateId })
    case 'state':
      return s.select({ kind: 'state', id: place.doc })
    case 'project':
      return s.select({ kind: 'project' })
  }
}
