import { AnimatePresence, motion } from 'framer-motion'
import { Check, Copy, MousePointer2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { TEMPLATE_COLORS } from '@shared/factory'
import { findEntityReferences, instancesOf } from '@shared/mutations'
import { SCHEMA_VERSION, type Project } from '@shared/schema'
import { useIssuesFor } from '../../hooks/useIssues'
import { cx } from '../../lib/cx'
import { TEMPLATE_ICONS, templateIcon } from '../../lib/meta'
import { folderPath } from '../../lib/tree'
import { renameItem, updateEntityTechnicalName, updateMeta, updateTemplate } from '../../store/ops'
import { stateUsage } from '@shared/expr/usage'
import { useProjectStore, type Selection, type StateDocId } from '../../store/projectStore'
import { STATE_DOCS } from '../state/StateDocs'
import { FieldLabel, IssueList, TextArea, TextInput } from '../ui/fields'
import { EdgeInspector, NodeInspector } from './NodeInspector'

export function Inspector() {
  const selection = useProjectStore((s) => s.selection)
  const key = selection ? (selection.kind === 'project' ? 'project' : `${selection.kind}:${selection.id}`) : 'none'

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center justify-between px-3">
        <span className="text-2xs font-semibold uppercase tracking-wider text-faint">Inspector</span>
        {selection && <span className="text-2xs text-faint">{KIND_LABEL[selection.kind]}</span>}
      </div>
      <div className="relative flex-1 overflow-y-auto">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={key}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.14 }}
            className="px-3 pb-6"
          >
            <InspectorBody selection={selection} />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

const KIND_LABEL: Record<NonNullable<Selection>['kind'], string> = {
  project: 'Project',
  folder: 'Folder',
  flow: 'Flow',
  template: 'Template',
  entity: 'Entity',
  node: 'Node',
  edge: 'Connection',
  state: 'State'
}

function InspectorBody({ selection }: { selection: Selection }) {
  const project = useProjectStore((s) => s.project)
  if (!selection || !project) return <Empty />
  switch (selection.kind) {
    case 'project':
      return <ProjectInspector project={project} />
    case 'folder':
      return <FolderInspector project={project} id={selection.id} />
    case 'flow':
      return <FlowInspector project={project} id={selection.id} />
    case 'template':
      return <TemplateInspector project={project} id={selection.id} />
    case 'entity':
      return <EntityInspector project={project} id={selection.id} />
    case 'node':
      return <NodeInspector project={project} flowId={selection.flowId} nodeId={selection.id} />
    case 'edge':
      return <EdgeInspector project={project} flowId={selection.flowId} edgeId={selection.id} />
    case 'state':
      return <StateInspector project={project} id={selection.id} />
  }
}

function Empty() {
  return (
    <div className="pt-16 text-center">
      <MousePointer2 size={22} strokeWidth={1.5} className="mx-auto text-faint" />
      <p className="mt-2 text-xs text-faint">Select something to see its properties.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------

function ProjectInspector({ project }: { project: Project }) {
  const meta = project.meta
  return (
    <Fields>
      <FieldLabel label="Name">
        <TextInput value={meta.name} required onCommit={(name) => updateMeta({ name })} />
      </FieldLabel>
      <FieldLabel label="Description">
        <TextArea
          value={meta.description}
          placeholder="What is this project about?"
          onCommit={(description) => updateMeta({ description })}
        />
      </FieldLabel>
      <Group title="Identity">
        <ReadOnly label="Project ID" value={meta.id} mono copyable />
        <ReadOnly label="Created" value={formatDate(meta.createdAt)} />
        <ReadOnly label="File format" value={`skein.project v${SCHEMA_VERSION}`} mono />
      </Group>
      <Group title="Contents">
        <Stats
          items={[
            ['Flows', Object.keys(project.flows).length],
            ['Folders', Object.keys(project.folders).length],
            ['Templates', Object.keys(project.templates).length],
            ['Entities', Object.keys(project.entities).length],
            ['World variables', Object.keys(project.state.variables).length],
            ['Relationships', Object.keys(project.state.relationships).length],
            ['Rules', Object.keys(project.state.rules).length]
          ]}
        />
      </Group>
    </Fields>
  )
}

function FolderInspector({ project, id }: { project: Project; id: string }) {
  const folder = project.folders[id]
  if (!folder) return <Empty />
  const location = folderPath(project, folder.parentId)
  return (
    <Fields>
      <FieldLabel label="Name">
        <TextInput value={folder.name} required onCommit={(name) => renameItem('folder', id, name)} />
      </FieldLabel>
      <Group title="Details">
        <ReadOnly label="Section" value={folder.section[0].toUpperCase() + folder.section.slice(1)} />
        <ReadOnly label="Location" value={location.length ? location.join(' / ') : '(top level)'} />
        <ReadOnly label="Folder ID" value={folder.id} mono copyable />
      </Group>
    </Fields>
  )
}

function FlowInspector({ project, id }: { project: Project; id: string }) {
  const flow = project.flows[id]
  const issues = useIssuesFor(id)
  if (!flow) return <Empty />
  const location = folderPath(project, flow.folderId)
  return (
    <Fields>
      <FieldLabel label="Name">
        <TextInput value={flow.name} required onCommit={(name) => renameItem('flow', id, name)} />
      </FieldLabel>
      <IssueList issues={issues} />
      <Group title="Details">
        <ReadOnly label="Location" value={['Flows', ...location].join(' / ')} />
        <ReadOnly label="Flow ID" value={flow.id} mono copyable />
      </Group>
      <Group title="Contents">
        <Stats
          items={[
            ['Nodes', Object.keys(flow.nodes).length],
            ['Connections', Object.keys(flow.edges).length]
          ]}
        />
      </Group>
    </Fields>
  )
}

function TemplateInspector({ project, id }: { project: Project; id: string }) {
  const template = project.templates[id]
  const issues = useIssuesFor(id)
  if (!template) return <Empty />
  const techIssues = issues.filter((i) => i.field === 'technicalName' && !i.propertyId)
  const instances = instancesOf(project, new Set([id])).length
  const location = folderPath(project, template.folderId)

  return (
    <Fields>
      <FieldLabel label="Name">
        <TextInput value={template.name} required onCommit={(name) => renameItem('template', id, name)} />
      </FieldLabel>
      <FieldLabel label="Technical name" hint="for scripts and export">
        <TextInput
          value={template.technicalName}
          mono
          invalid={techIssues.length > 0}
          onCommit={(technicalName) => updateTemplate(id, { technicalName })}
        />
        <IssueList issues={techIssues} />
      </FieldLabel>

      <div>
        <span className="mb-1.5 block text-xs text-muted">Colour</span>
        <div className="grid w-fit grid-cols-5 gap-2">
          {TEMPLATE_COLORS.map((c) => (
            <motion.button
              key={c}
              type="button"
              whileHover={{ scale: 1.12 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => updateTemplate(id, { color: c })}
              aria-label={`Colour ${c}`}
              className={cx(
                'h-6 w-6 rounded-full transition-shadow',
                template.color === c ? 'ring-2 ring-fg ring-offset-2 ring-offset-panel' : 'ring-1 ring-black/30'
              )}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>

      <div>
        <span className="mb-1.5 block text-xs text-muted">Icon</span>
        <div className="grid grid-cols-7 gap-1">
          {Object.entries(TEMPLATE_ICONS).map(([key, Icon]) => {
            const active = template.icon === key
            return (
              <motion.button
                key={key}
                type="button"
                whileTap={{ scale: 0.9 }}
                onClick={() => updateTemplate(id, { icon: key })}
                aria-label={`Icon ${key}`}
                title={key}
                className={cx(
                  'grid aspect-square place-items-center rounded-md transition-colors',
                  active ? 'bg-raised' : 'text-faint hover:bg-raised/60 hover:text-muted'
                )}
                style={active ? { color: template.color, boxShadow: `inset 0 0 0 1px ${template.color}66` } : undefined}
              >
                <Icon size={15} strokeWidth={1.7} />
              </motion.button>
            )
          })}
        </div>
      </div>

      <FieldLabel label="Description">
        <TextArea
          value={template.description}
          rows={3}
          placeholder="What does this template represent?"
          onCommit={(description) => updateTemplate(id, { description })}
        />
      </FieldLabel>

      <Group title="Details">
        <ReadOnly label="Location" value={['Templates', ...location].join(' / ')} />
        <ReadOnly label="Template ID" value={template.id} mono copyable />
      </Group>
      <Group title="Contents">
        <Stats
          items={[
            ['Properties', Object.keys(template.properties).length],
            ['Entities', instances]
          ]}
        />
      </Group>
    </Fields>
  )
}

function EntityInspector({ project, id }: { project: Project; id: string }) {
  const entity = project.entities[id]
  const issues = useIssuesFor(id)
  const select = useProjectStore((s) => s.select)
  if (!entity) return <Empty />
  const template = project.templates[entity.templateId]
  const TemplateIcon = templateIcon(template?.icon)
  const techIssues = issues.filter((i) => i.field === 'technicalName')
  const location = folderPath(project, entity.folderId)
  const links = findEntityReferences(project, id).length
  const overridden = Object.keys(entity.values).length

  return (
    <Fields>
      <FieldLabel label="Name">
        <TextInput value={entity.name} required onCommit={(name) => renameItem('entity', id, name)} />
      </FieldLabel>
      <FieldLabel label="Technical name" hint="for scripts and export">
        <TextInput
          value={entity.technicalName}
          mono
          invalid={techIssues.length > 0}
          onCommit={(technicalName) => updateEntityTechnicalName(id, technicalName)}
        />
        <IssueList issues={techIssues} />
      </FieldLabel>

      <div>
        <span className="mb-1 block text-xs text-muted">Template</span>
        {template ? (
          <button
            type="button"
            onClick={() => select({ kind: 'template', id: template.id })}
            className="flex w-full items-center gap-2 rounded-md border border-line bg-bg px-2 py-1.5 text-left transition-colors hover:border-accent/50"
          >
            <TemplateIcon size={14} style={{ color: template.color }} />
            <span className="flex-1 truncate">{template.name}</span>
            <span className="text-2xs text-faint">open</span>
          </button>
        ) : (
          <p className="rounded-md border border-danger/40 px-2 py-1.5 text-xs text-danger">Missing template</p>
        )}
      </div>

      <Group title="Details">
        <ReadOnly label="Location" value={['Entities', ...location].join(' / ')} />
        <ReadOnly label="Entity ID" value={entity.id} mono copyable />
      </Group>
      <Group title="Contents">
        <Stats
          items={[
            ['Values set', overridden],
            ['Linked from', links]
          ]}
        />
      </Group>
    </Fields>
  )
}

function StateInspector({ project, id }: { project: Project; id: StateDocId }) {
  const usage = stateUsage(project)
  const meta = STATE_DOCS[id]
  const Icon = meta.icon
  const time = project.state.time
  const start = time.startPhaseId ? time.phases[time.startPhaseId]?.label : undefined
  const unused =
    id === 'world'
      ? Object.values(project.state.variables).filter((v) => !usage.count.get(v.id)).length
      : id === 'relationships'
        ? Object.values(project.state.relationships).filter((r) => !usage.count.get(r.id)).length
        : 0
  return (
    <Fields>
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: `${meta.color}22`, color: meta.color }}>
          <Icon size={16} />
        </span>
        <p className="font-medium text-fg">{meta.title}</p>
      </div>
      <p className="text-xs leading-relaxed text-muted">{meta.blurb}</p>
      {id === 'world' && (
        <Group title="Contents">
          <Stats items={[['Variables', Object.keys(project.state.variables).length], ['Unused', unused]]} />
        </Group>
      )}
      {id === 'relationships' && (
        <Group title="Contents">
          <Stats items={[['Relationships', Object.keys(project.state.relationships).length], ['Unused', unused]]} />
        </Group>
      )}
      {id === 'time' && (
        <Group title="Contents">
          <Stats items={[['Phases', Object.keys(time.phases).length], ['Rules', Object.keys(project.state.rules).length]]} />
          <ReadOnly label="Game starts" value={`Day ${time.startDay}${start ? `, ${start}` : ''}`} />
        </Group>
      )}
      <Group title="Character state">
        <p className="text-xs leading-relaxed text-muted">
          Per-character state (Mood, Health, Location) lives on templates: open a template, expand a property and switch on
          “Changes during play”. Each entity’s value is its starting state.
        </p>
      </Group>
    </Fields>
  )
}

// ---------------------------------------------------------------------------

function Fields({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4 pt-1">{children}</div>
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">{title}</h3>
      <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-bg/40 p-2.5">{children}</div>
    </section>
  )
}

function ReadOnly({ label, value, mono, copyable }: { label: string; value: string; mono?: boolean; copyable?: boolean }) {
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

function Stats({ items }: { items: Array<[string, number]> }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {items.map(([label, n]) => (
        <div key={label} className="rounded-md bg-raised/50 px-2 py-1.5">
          <motion.div
            key={n}
            initial={{ y: -3, opacity: 0.4 }}
            animate={{ y: 0, opacity: 1 }}
            className="text-sm font-semibold tabular-nums text-fg"
          >
            {n}
          </motion.div>
          <div className="text-2xs text-faint">{label}</div>
        </div>
      ))}
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
