import { ReactFlowProvider } from '@xyflow/react'
import { AnimatePresence, motion } from 'framer-motion'
import { FileText, MousePointerClick, Network, Workflow, type LucideIcon } from 'lucide-react'
import type { Project } from '@shared/schema'
import { templateIcon } from '../../lib/meta'
import { useProjectStore, type DocRef, type StateDocId } from '../../store/projectStore'
import { useUi, type FlowView } from '../../store/ui'
import { cx } from '../../lib/cx'
import { ScriptView } from '../script/ScriptView'
import { STATE_DOCS, StateDoc } from '../state/StateDocs'
import { EntitySheet } from '../entities/EntitySheet'
import { FlowEditor } from '../flow/FlowEditor'
import { TemplateDesigner } from '../templates/TemplateDesigner'

interface DocInfo {
  name: string
  icon: LucideIcon
  color: string
}

function describeDoc(project: Project, doc: DocRef): DocInfo | null {
  if (doc.kind === 'state') {
    const meta = STATE_DOCS[doc.id as StateDocId]
    return meta ? { name: meta.title, icon: meta.icon, color: meta.color } : null
  }
  if (doc.kind === 'flow') {
    const flow = project.flows[doc.id]
    return flow ? { name: flow.name, icon: Workflow, color: 'rgb(var(--c-accent))' } : null
  }
  if (doc.kind === 'template') {
    const t = project.templates[doc.id]
    return t ? { name: t.name, icon: templateIcon(t.icon), color: t.color } : null
  }
  const e = project.entities[doc.id]
  if (!e) return null
  const t = project.templates[e.templateId]
  return { name: e.name, icon: templateIcon(t?.icon), color: t?.color ?? 'rgb(var(--c-danger))' }
}

/** The central workspace: shows the open flow, template or entity. */
export function Workspace() {
  const project = useProjectStore((s) => s.project) as Project
  const doc = useProjectStore((s) => s.activeDoc)
  const info = doc ? describeDoc(project, doc) : null
  const flowView = useUi((s) => s.flowView)
  const isFlow = doc?.kind === 'flow' && info !== null
  const key = doc && info ? `${doc.kind}:${doc.id}${isFlow ? `:${flowView}` : ''}` : 'empty'
  const TabIcon = info?.icon

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex h-9 shrink-0 items-end gap-1 border-b border-line bg-panel px-2">
        <AnimatePresence initial={false} mode="popLayout">
          {info && TabIcon && (
            <motion.div
              key={doc ? `${doc.kind}:${doc.id}` : 'none'}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ type: 'spring', stiffness: 500, damping: 36 }}
              className="relative -mb-px flex h-8 max-w-[260px] items-center gap-2 rounded-t-md border border-b-0 border-line bg-bg px-3"
            >
              <TabIcon size={13} className="shrink-0" style={{ color: info.color }} />
              <span className="truncate text-xs font-medium">{info.name}</span>
            </motion.div>
          )}
        </AnimatePresence>
        {isFlow && <ViewSwitch view={flowView} />}
      </div>

      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={key}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            <DocView project={project} doc={info ? doc : null} flowView={flowView} />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

const VIEWS: { id: FlowView; label: string; icon: LucideIcon }[] = [
  { id: 'canvas', label: 'Canvas', icon: Network },
  { id: 'script', label: 'Script', icon: FileText }
]

/** Canvas or script: two ways of looking at the same flow. */
function ViewSwitch({ view }: { view: FlowView }) {
  const setView = useUi((s) => s.setFlowView)
  return (
    <div role="tablist" aria-label="Flow view" className="mb-1 ml-auto flex shrink-0 items-center gap-0.5 rounded-md bg-bg p-0.5 ring-1 ring-line">
      {VIEWS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={view === id}
          onClick={() => setView(id)}
          className={cx(
            'flex h-6 items-center gap-1.5 rounded px-2 text-2xs font-medium transition-colors',
            view === id ? 'bg-raised text-fg' : 'text-faint hover:text-fg'
          )}
        >
          <Icon size={12} />
          {label}
        </button>
      ))}
    </div>
  )
}

function DocView({ project, doc, flowView }: { project: Project; doc: DocRef | null; flowView: FlowView }) {
  if (doc?.kind === 'flow' && project.flows[doc.id] && flowView === 'script') return <ScriptView flow={project.flows[doc.id]} />
  if (doc?.kind === 'flow' && project.flows[doc.id]) {
    return (
      <ReactFlowProvider>
        <FlowEditor flow={project.flows[doc.id]} />
      </ReactFlowProvider>
    )
  }
  if (doc?.kind === 'template' && project.templates[doc.id]) return <TemplateDesigner template={project.templates[doc.id]} />
  if (doc?.kind === 'entity' && project.entities[doc.id]) return <EntitySheet entity={project.entities[doc.id]} />
  if (doc?.kind === 'state' && doc.id in STATE_DOCS) return <StateDoc id={doc.id as StateDocId} />
  return (
    <div className="grid h-full place-items-center">
      <div className="text-center">
        <MousePointerClick size={28} strokeWidth={1.5} className="mx-auto text-faint" />
        <p className="mt-3 text-sm font-medium text-muted">Nothing open</p>
        <p className="mt-1 text-xs text-faint">Pick a flow, template or entity in the explorer.</p>
      </div>
    </div>
  )
}
