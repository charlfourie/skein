import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, ArrowRight, Copy, HeartHandshake, Info, Link2, MessageSquare, RotateCcw, Shapes } from 'lucide-react'
import { useMemo } from 'react'
import { findEntityReferences, findSpeakerLines } from '@shared/mutations'
import { dataString } from '@shared/nodes'
import type { Entity, Project } from '@shared/schema'
import { defaultOf, effectiveValue } from '@shared/values'
import { useIssuesFor } from '../../hooks/useIssues'
import { cx } from '../../lib/cx'
import { templateIcon } from '../../lib/meta'
import { duplicateEntity, resetEntityValue, setEntityValue, setRelationValue, sortedProperties } from '../../store/ops'
import { StateBadge } from '../defs/DefCard'
import { useProjectStore } from '../../store/projectStore'
import { Button } from '../ui/Button'
import { IssueList } from '../ui/fields'
import { DocHeader } from '../workspace/DocHeader'
import { ValueEditor } from './ValueEditor'

export function EntitySheet({ entity }: { entity: Entity }) {
  const project = useProjectStore((s) => s.project) as Project
  const select = useProjectStore((s) => s.select)
  const issues = useIssuesFor(entity.id)
  const template = project.templates[entity.templateId]
  const props = useMemo(() => (template ? sortedProperties(template) : []), [template])
  const references = useMemo(() => findEntityReferences(project, entity.id), [project, entity.id])
  const lines = useMemo(() => findSpeakerLines(project, entity.id), [project, entity.id])
  const focusNode = useProjectStore((s) => s.focusNode)

  if (!template) {
    return (
      <div className="mx-auto max-w-2xl px-6 pt-10">
        <div className="flex items-start gap-3 rounded-xl border border-danger/40 bg-danger/[0.06] p-4">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" />
          <div>
            <p className="font-medium text-fg">“{entity.name}” has no template</p>
            <p className="mt-1 text-xs text-muted">
              Its template was deleted, probably in a teammate&apos;s copy that was merged in. Its saved values are kept in the file
              untouched:
            </p>
            <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-bg p-2 font-mono text-2xs text-muted">
              {JSON.stringify(entity.values, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    )
  }

  const generalIssues = issues.filter((i) => !i.propertyId && i.field !== 'technicalName')

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 pb-16 pt-6">
        <DocHeader
          icon={templateIcon(template.icon)}
          color={template.color}
          title={entity.name}
          technicalName={entity.technicalName}
          meta={
            <button
              type="button"
              onClick={() => select({ kind: 'template', id: template.id })}
              className="flex items-center gap-1 rounded px-1 transition-colors hover:bg-raised hover:text-fg"
              title="Open template"
            >
              <Shapes size={12} style={{ color: template.color }} /> {template.name}
            </button>
          }
          actions={
            <Button icon={Copy} onClick={() => duplicateEntity(entity.id)}>
              Duplicate
            </Button>
          }
        />
        <IssueList issues={generalIssues} />

        <div className="mt-8">
          {props.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line px-6 py-8 text-center">
              <p className="text-sm text-muted">The {template.name} template has no properties yet.</p>
              <button
                type="button"
                onClick={() => select({ kind: 'template', id: template.id })}
                className="mt-2 text-xs text-accent hover:underline"
              >
                Add some in the template designer
              </button>
            </div>
          ) : (
            <div className="divide-y divide-line/70 rounded-xl border border-line bg-panel/50">
              {props.map((prop, i) => {
                const { value, overridden } = effectiveValue(prop, entity.values)
                const propIssues = issues.filter((x) => x.propertyId === prop.id)
                return (
                  <motion.div
                    key={prop.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.02, 0.2) }}
                    className="grid grid-cols-[minmax(120px,200px)_1fr_28px] items-start gap-4 px-4 py-3"
                  >
                    <div className="pt-1.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cx('h-1.5 w-1.5 shrink-0 rounded-full transition-colors', overridden ? 'bg-accent' : 'bg-line')}
                          title={overridden ? 'Set on this entity' : 'Using the template default'}
                        />
                        <span className={cx('truncate text-xs font-medium', overridden ? 'text-fg' : 'text-muted')}>{prop.name}</span>
                        {prop.mutable && <StateBadge />}
                        {prop.description && (
                          <span title={prop.description} className="shrink-0 text-faint">
                            <Info size={11} />
                          </span>
                        )}
                      </div>
                      <code className="ml-3 font-mono text-2xs text-faint">{prop.technicalName}</code>
                    </div>
                    <div className="min-w-0">
                      <ValueEditor
                        project={project}
                        prop={prop}
                        value={value}
                        inherited={!overridden}
                        invalid={propIssues.length > 0}
                        onChange={(v) => setEntityValue(entity.id, prop.id, v)}
                      />
                      <IssueList issues={propIssues} />
                    </div>
                    <div className="pt-1">
                      <AnimatePresence>
                        {overridden && (
                          <motion.button
                            type="button"
                            initial={{ opacity: 0, scale: 0.6 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.6 }}
                            whileTap={{ rotate: -90 }}
                            onClick={() => resetEntityValue(entity.id, prop.id)}
                            title="Reset to template default"
                            aria-label={`Reset ${prop.name} to default`}
                            className="grid h-6 w-6 place-items-center rounded text-faint transition-colors hover:bg-raised hover:text-fg"
                          >
                            <RotateCcw size={12} />
                          </motion.button>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          )}
        </div>

        <RelationshipsSection project={project} entity={entity} />

        {lines.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-faint">
              Speaks in · {lines.length} line{lines.length === 1 ? '' : 's'}
            </h2>
            <ul className="flex flex-col gap-1">
              {lines.slice(0, 50).map(({ flowId, nodeId }) => {
                const flow = project.flows[flowId]
                const text = dataString(flow.nodes[nodeId], 'text')
                return (
                  <li key={nodeId}>
                    <button
                      type="button"
                      onClick={() => focusNode(flowId, nodeId)}
                      className="flex w-full items-center gap-2 rounded-md border border-line bg-panel px-2.5 py-1.5 text-left text-xs transition-colors hover:border-accent/50"
                    >
                      <MessageSquare size={12} className="shrink-0 text-accent" />
                      <span className="shrink-0 text-faint">{flow.name}</span>
                      <span className="truncate text-fg">{text || <em className="text-faint">empty line</em>}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {references.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-faint">Linked from</h2>
            <ul className="flex flex-wrap gap-1.5">
              {references.map((ref) => {
                const source = project.entities[ref.entityId]
                const sourceTemplate = source && project.templates[source.templateId]
                const prop = sourceTemplate?.properties[ref.propertyId]
                if (!source || !sourceTemplate) return null
                const Icon = templateIcon(sourceTemplate.icon)
                return (
                  <li key={`${ref.entityId}:${ref.propertyId}`}>
                    <button
                      type="button"
                      onClick={() => select({ kind: 'entity', id: source.id })}
                      className="flex items-center gap-1.5 rounded-md border border-line bg-panel px-2 py-1 text-xs transition-colors hover:border-accent/50"
                    >
                      <Icon size={12} style={{ color: sourceTemplate.color }} />
                      <span className="text-fg">{source.name}</span>
                      <Link2 size={11} className="text-faint" />
                      <span className="text-muted">{prop?.name}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}

/** Starting values of one-way relationships from this entity to others. */
function RelationshipsSection({ project, entity }: { project: Project; entity: Entity }) {
  const select = useProjectStore((s) => s.select)
  const rels = Object.values(project.state.relationships)
    .filter((r) => r.fromTemplateId === entity.templateId)
    .sort((a, b) => a.order - b.order)
  if (rels.length === 0) return null
  return (
    <section className="mt-8">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-2xs font-semibold uppercase tracking-wider text-faint">Relationships · starting values</h2>
        <button type="button" onClick={() => select({ kind: 'state', id: 'relationships' })} className="text-2xs text-accent hover:underline">
          Edit definitions
        </button>
      </div>
      <div className="space-y-3">
        {rels.map((rel) => {
          const targets = Object.values(project.entities)
            .filter((e) => e.templateId === rel.toTemplateId && e.id !== entity.id)
            .sort((a, b) => a.name.localeCompare(b.name))
          return (
            <div key={rel.id} className="rounded-xl border border-line bg-panel/50">
              <div className="flex items-center gap-2 border-b border-line/70 px-4 py-2">
                <HeartHandshake size={13} className="text-[#f472b6]" />
                <span className="text-xs font-medium text-fg">{rel.name}</span>
                <code className="font-mono text-2xs text-faint">
                  {entity.technicalName}-&gt;…{'.'}
                  {rel.technicalName}
                </code>
              </div>
              {targets.length === 0 ? (
                <p className="px-4 py-2 text-2xs text-faint">No {project.templates[rel.toTemplateId]?.name ?? 'matching'} entities yet.</p>
              ) : (
                <div className="divide-y divide-line/50">
                  {targets.map((t) => {
                    const own = entity.relations?.[rel.id]?.[t.id]
                    const overridden = own !== undefined
                    return (
                      <div key={t.id} className="grid grid-cols-[minmax(120px,200px)_1fr_28px] items-center gap-4 px-4 py-2">
                        <span className="flex items-center gap-1.5 text-xs">
                          <span className={cx('h-1.5 w-1.5 rounded-full', overridden ? 'bg-accent' : 'bg-line')} />
                          <ArrowRight size={11} className="text-faint" />
                          <span className={overridden ? 'text-fg' : 'text-muted'}>{t.name}</span>
                        </span>
                        <ValueEditor
                          project={project}
                          prop={rel}
                          value={overridden ? own : defaultOf(rel)}
                          inherited={!overridden}
                          onChange={(v) => setRelationValue(entity.id, rel.id, t.id, v)}
                        />
                        {overridden ? (
                          <button
                            type="button"
                            onClick={() => setRelationValue(entity.id, rel.id, t.id, undefined)}
                            title="Reset to the relationship default"
                            className="grid h-6 w-6 place-items-center rounded text-faint hover:bg-raised hover:text-fg"
                          >
                            <RotateCcw size={12} />
                          </button>
                        ) : (
                          <span />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
