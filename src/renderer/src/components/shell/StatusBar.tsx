import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Circle, CircleCheck, CircleDot, Keyboard, XCircle } from 'lucide-react'
import { sortedTests } from '@shared/play/storyTests'
import { isFolderProjectPath } from '@shared/projectFiles'
import { SCHEMA_VERSION, type Project } from '@shared/schema'
import { SKEIN_VERSION } from '@shared/version'
import { displayName } from '../../lib/projectIO'
import { usePlay } from '../../store/play'
import { selectDirty, useProjectStore } from '../../store/projectStore'
import { useTests } from '../../store/tests'
import { useUi } from '../../store/ui'
import { TestStatusIcon } from '../play/TestStatus'
import { useProblems } from '../problems/ProblemsPanel'

export function StatusBar() {
  const filePath = useProjectStore((s) => s.filePath)
  const dirty = useProjectStore(selectDirty)
  const project = useProjectStore((s) => s.project)
  if (!project) return null

  const state = !filePath ? 'unsaved' : dirty ? 'dirty' : 'clean'
  const label = { unsaved: 'Never saved', dirty: 'Unsaved changes', clean: 'All changes saved' }[state]
  const Icon = { unsaved: Circle, dirty: CircleDot, clean: CircleCheck }[state]
  const color = { unsaved: 'text-faint', dirty: 'text-warn', clean: 'text-ok' }[state]

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-panel px-3 text-2xs text-muted">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={state}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.12 }}
          className="flex items-center gap-1.5"
        >
          <Icon size={11} className={color} />
          {label}
        </motion.span>
      </AnimatePresence>

      {filePath && (
        <span className="min-w-0 truncate font-mono text-faint" title={filePath}>
          {displayName(filePath)}
          {isFolderProjectPath(filePath) ? ' (folder)' : ''}
        </span>
      )}

      <div className="flex-1" />
      <ProblemsSummary project={project} />
      <TestSummary project={project} />
      <span className="tabular-nums">
        {Object.keys(project.flows).length} flows · {Object.keys(project.entities).length} entities ·{' '}
        {Object.keys(project.state.variables).length} world variables
      </span>
      <span className="font-mono text-faint" title={`Skein ${SKEIN_VERSION}, project format v${SCHEMA_VERSION}`}>
        {SKEIN_VERSION} · format v{SCHEMA_VERSION}
      </span>
      <button
        type="button"
        onClick={() => useUi.getState().setShortcutsOpen(true)}
        title="Keyboard shortcuts (?)"
        aria-label="Keyboard shortcuts"
        className="-mr-1 grid h-5 w-5 place-items-center rounded text-faint hover:bg-raised hover:text-fg"
      >
        <Keyboard size={12} />
      </button>
    </footer>
  )
}

/** How the story tests are doing; click to open the first failing one's flow. */
function TestSummary({ project }: { project: Project }) {
  const results = useTests((s) => s.results)
  const fresh = useTests((s) => s.checked === project && !s.running)
  const tests = sortedTests(project)
  if (tests.length === 0) return null
  const bad = tests.filter((t) => results[t.id] && results[t.id].status !== 'pass')
  const first = bad[0] ?? tests[0]
  const open = () => {
    if (!project.flows[first.flowId]) return
    useProjectStore.setState({ activeDoc: { kind: 'flow', id: first.flowId } })
    usePlay.getState().openFor(first.flowId, 'tests')
  }
  // While re-checking after an edit, keep showing the last results (dimmed) rather than flickering.
  const known = tests.every((t) => results[t.id])
  const status = !known ? 'pending' : bad.some((t) => results[t.id].status === 'fail') ? 'fail' : bad.length ? 'broken' : 'pass'
  const label = !known
    ? `Checking ${tests.length} test${tests.length === 1 ? '' : 's'}…`
    : bad.length
      ? `${bad.length} of ${tests.length} test${tests.length === 1 ? '' : 's'} need${bad.length === 1 ? 's' : ''} attention`
      : `${tests.length} test${tests.length === 1 ? '' : 's'} passing`
  return (
    <button
      type="button"
      onClick={open}
      className={`flex items-center gap-1.5 transition-[color,opacity] hover:text-fg ${!fresh && known ? 'opacity-50' : ''}`}
      title={!fresh ? 'Re-checking the story tests after your edit…' : 'Story tests (they re-run after every edit)'}
    >
      <TestStatusIcon status={status} size={11} />
      <span className={status === 'fail' ? 'text-danger' : status === 'broken' ? 'text-warn' : undefined}>{label}</span>
    </button>
  )
}

/** Errors and warnings across the project; click to list them. */
function ProblemsSummary({ project }: { project: Project }) {
  const tests = useTests((s) => s.results)
  const problems = useProblems(project, tests)
  if (problems.length === 0) return null
  const errors = problems.filter((p) => p.level === 'error').length
  const warnings = problems.length - errors
  return (
    <button
      type="button"
      onClick={() => useUi.getState().showLeft('problems')}
      className="flex items-center gap-2 transition-colors hover:text-fg"
      title="Show every problem in the project"
    >
      {errors > 0 && (
        <span className="flex items-center gap-1 text-danger">
          <XCircle size={11} /> {errors}
        </span>
      )}
      {warnings > 0 && (
        <span className="flex items-center gap-1 text-warn">
          <AlertTriangle size={11} /> {warnings}
        </span>
      )}
    </button>
  )
}
