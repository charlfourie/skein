import { AnimatePresence, motion } from 'framer-motion'
import { Circle, CircleCheck, CircleDot } from 'lucide-react'
import { SCHEMA_VERSION } from '@shared/schema'
import { selectDirty, useProjectStore } from '../../store/projectStore'

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
        <button
          type="button"
          onClick={() => window.api.showInFolder(filePath)}
          title="Show in folder"
          className="min-w-0 truncate font-mono text-faint transition-colors hover:text-fg"
        >
          {filePath}
        </button>
      )}

      <div className="flex-1" />
      <span className="tabular-nums">
        {Object.keys(project.flows).length} flows · {Object.keys(project.entities).length} entities ·{' '}
        {Object.keys(project.state.variables).length} world variables
      </span>
      <span className="font-mono text-faint">v{SCHEMA_VERSION}</span>
    </footer>
  )
}
