import { motion, Reorder } from 'framer-motion'
import { Plus, Shapes } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { stateUsage } from '@shared/expr/usage'
import { instancesOf } from '@shared/mutations'
import { PROPERTY_TYPES, type Project, type PropertyType, type Template } from '@shared/schema'
import { useIssuesFor } from '../../hooks/useIssues'
import { PROPERTY_TYPE_META, templateIcon } from '../../lib/meta'
import { addProperty, reorderProperties, sortedProperties } from '../../store/ops'
import { useProjectStore } from '../../store/projectStore'
import { DefCard, StateBadge } from '../defs/DefCard'
import { TemplatePicker } from '../entities/TemplatePicker'
import { Button } from '../ui/Button'
import { MenuItem, Popover, usePopover } from '../ui/Popover'
import { DocHeader } from '../workspace/DocHeader'

export function TemplateDesigner({ template }: { template: Template }) {
  const project = useProjectStore((s) => s.project) as Project
  const issues = useIssuesFor(template.id)
  const props = useMemo(() => sortedProperties(template), [template])
  const instanceCount = useMemo(() => instancesOf(project, new Set([template.id])).length, [project, template.id])
  const usage = stateUsage(project)

  // Local order while dragging; committed as one undo step when the drag ends.
  const [order, setOrder] = useState(() => props.map((p) => p.id))
  useEffect(() => setOrder(props.map((p) => p.id)), [props])
  const orderRef = useRef(order)
  orderRef.current = order
  const commitOrder = useCallback(() => reorderProperties(template.id, orderRef.current), [template.id])

  const [expanded, setExpanded] = useState<string | null>(null)
  const addMenu = usePopover()
  const entityMenu = usePopover()

  const add = (type: PropertyType) => {
    addMenu.close()
    const id = addProperty(template.id, type)
    if (id) setExpanded(id)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 pb-16 pt-6">
        <DocHeader
          icon={templateIcon(template.icon)}
          color={template.color}
          title={template.name}
          technicalName={template.technicalName}
          meta={
            <>
              <span className="flex items-center gap-1">
                <Shapes size={12} /> Template
              </span>
              <span>
                {instanceCount} {instanceCount === 1 ? 'entity' : 'entities'}
              </span>
            </>
          }
          actions={
            <Button icon={Plus} onClick={(e) => entityMenu.open(e.currentTarget)}>
              New entity
            </Button>
          }
        />
        {template.description && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted">{template.description}</p>}

        <TemplateEntities project={project} templateId={template.id} />

        <div className="mb-2 mt-8 flex items-center justify-between">
          <h2 className="text-2xs font-semibold uppercase tracking-wider text-faint">Properties</h2>
          <Button variant="primary" icon={Plus} onClick={(e) => addMenu.open(e.currentTarget)}>
            Add property
          </Button>
        </div>

        {props.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-xl border border-dashed border-line px-6 py-10 text-center"
          >
            <p className="text-sm font-medium text-muted">No properties yet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-faint">
              Properties are the fields every {template.name} has: for a character, perhaps Age, Faction and Biography.
            </p>
          </motion.div>
        ) : (
          <Reorder.Group axis="y" values={order} onReorder={setOrder} className="flex flex-col gap-2">
            {order.map((id) => {
              const prop = template.properties[id]
              if (!prop) return null
              const valuesSet = Object.values(project.entities).filter((e) => e.templateId === template.id && id in e.values).length
              return (
                <DefCard
                  key={id}
                  project={project}
                  scope={{ kind: 'template', templateId: template.id }}
                  def={prop}
                  issues={issues.filter((i) => i.propertyId === id)}
                  expanded={expanded === id}
                  onToggle={() => setExpanded((cur) => (cur === id ? null : id))}
                  onDragEnd={commitOrder}
                  badge={prop.mutable ? <StateBadge /> : undefined}
                  stateToggle
                  usage={usage.count.get(id) ?? 0}
                  deleteDetail={valuesSet ? `${valuesSet} entit${valuesSet === 1 ? 'y has a value' : 'ies have values'} for it, which will be removed.` : undefined}
                />
              )
            })}
          </Reorder.Group>
        )}
      </div>

      <Popover anchor={addMenu.anchor} onClose={addMenu.close} width={280}>
        {PROPERTY_TYPES.map((type) => {
          const meta = PROPERTY_TYPE_META[type]
          const Icon = meta.icon
          return <MenuItem key={type} icon={<Icon size={14} />} label={meta.label} hint={meta.hint} onClick={() => add(type)} />
        })}
      </Popover>
      <TemplatePicker project={project} anchor={entityMenu.anchor} onClose={entityMenu.close} folderId={null} />
    </div>
  )
}

/** The entities made from this template, each a link to its sheet. */
function TemplateEntities({ project, templateId }: { project: Project; templateId: string }) {
  const select = useProjectStore((s) => s.select)
  const entities = Object.values(project.entities)
    .filter((e) => e.templateId === templateId)
    .sort((a, b) => a.name.localeCompare(b.name))
  if (entities.length === 0) return null
  return (
    <div className="mt-6">
      <h2 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-faint">Entities ({entities.length})</h2>
      <div className="flex flex-wrap gap-1.5">
        {entities.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => select({ kind: 'entity', id: e.id })}
            title={`Open ${e.name}`}
            className="rounded-md border border-line bg-panel px-2.5 py-1 text-xs text-fg transition-colors hover:border-accent/50 hover:text-accent"
          >
            {e.name || e.technicalName || '(unnamed)'}
          </button>
        ))}
      </div>
    </div>
  )
}
