import { AnimatePresence, motion, Reorder, useDragControls } from 'framer-motion'
import { ArrowRight, Clock, Globe, GripVertical, HeartHandshake, Play, Plus, Repeat, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { stateUsage } from '@shared/expr/usage'
import { PROPERTY_TYPES, type Project, type PropertyType, type Rule } from '@shared/schema'
import type { Issue } from '@shared/validate'
import { useIssues } from '../../hooks/useIssues'
import { cx } from '../../lib/cx'
import { PROPERTY_TYPE_META, templateIcon } from '../../lib/meta'
import { compareOrder } from '../../lib/tree'
import {
  addPhase,
  addRelationship,
  addRule,
  addStateVariable,
  removePhase,
  removeRule,
  renamePhase,
  reorderDefs,
  reorderPhases,
  reorderRules,
  setTimeStart,
  updateDef,
  updateRule,
  type DefScope
} from '../../store/ops'
import { useProjectStore, type StateDocId } from '../../store/projectStore'
import { DefCard } from '../defs/DefCard'
import { ExpressionField } from '../defs/ExpressionField'
import { Button } from '../ui/Button'
import { FieldLabel, IssueList, NumberInput, Select, TextInput, Toggle } from '../ui/fields'
import { IconButton } from '../ui/IconButton'
import { MenuItem, Popover, usePopover } from '../ui/Popover'
import { DocHeader } from '../workspace/DocHeader'

export const STATE_DOCS: Record<StateDocId, { title: string; icon: typeof Globe; color: string; blurb: string }> = {
  world: {
    title: 'World variables',
    icon: Globe,
    color: '#2dd4bf',
    blurb: 'Facts about the world that change during play: World.StormRaging, Player.Reputation, Quest.Stage.'
  },
  relationships: {
    title: 'Relationships',
    icon: HeartHandshake,
    color: '#f472b6',
    blurb: 'One-way feelings and ties between entities: Keeper->Stranger.Trust can differ from Stranger->Keeper.Trust.'
  },
  time: {
    title: 'Time & rules',
    icon: Clock,
    color: '#fbbf24',
    blurb: 'Days and named phases, and rules that change state automatically as time passes.'
  }
}

export function StateDoc({ id }: { id: StateDocId }) {
  const project = useProjectStore((s) => s.project) as Project
  const meta = STATE_DOCS[id]
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 pb-16 pt-6">
        <DocHeader icon={meta.icon} color={meta.color} title={meta.title} meta={<span>State</span>} />
        <p className="mt-3 text-sm leading-relaxed text-muted">{meta.blurb}</p>
        {id === 'world' && <WorldVariables project={project} />}
        {id === 'relationships' && <Relationships project={project} />}
        {id === 'time' && <TimeAndRules project={project} />}
      </div>
    </div>
  )
}

function useOrder<T extends { id: string }>(items: T[], commit: (ids: string[]) => void) {
  const [order, setOrder] = useState(() => items.map((i) => i.id))
  const key = items.map((i) => i.id).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setOrder(items.map((i) => i.id)), [key])
  const ref = useRef(order)
  ref.current = order
  const onDragEnd = useCallback(() => commit(ref.current), [commit])
  return { order, setOrder, onDragEnd }
}

function SectionHead({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-8 flex items-center justify-between">
      <h2 className="text-2xs font-semibold uppercase tracking-wider text-faint">{title}</h2>
      {action}
    </div>
  )
}

function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-dashed border-line px-6 py-8 text-center">
      <p className="text-sm font-medium text-muted">{title}</p>
      <div className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-faint">{children}</div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// World variables

function WorldVariables({ project }: { project: Project }) {
  const issues = useIssues()
  const usage = stateUsage(project)
  const vars = useMemo(
    () => Object.values(project.state.variables).sort((a, b) => a.namespace.localeCompare(b.namespace) || compareOrder(a, b)),
    [project.state.variables]
  )
  const scope: DefScope = { kind: 'variable' }
  const commit = useCallback((ids: string[]) => reorderDefs({ kind: 'variable' }, ids), [])
  const { order, setOrder, onDragEnd } = useOrder(vars, commit)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [namespace, setNamespace] = useState('World')
  const menu = usePopover()
  const namespaces = [...new Set(['World', ...vars.map((v) => v.namespace)])]

  const add = (type: PropertyType) => {
    menu.close()
    const id = addStateVariable(namespace.trim() || 'World', type)
    if (id) setExpanded(id)
  }

  return (
    <>
      <SectionHead
        title={`Variables · ${vars.length}`}
        action={
          <Button variant="primary" icon={Plus} onClick={(e) => menu.open(e.currentTarget)}>
            Add variable
          </Button>
        }
      />
      {vars.length === 0 ? (
        <Empty title="No world variables yet">
          Add things like <code className="text-muted">World.StormRaging</code> (yes / no) or{' '}
          <code className="text-muted">Player.Reputation</code> (number). Use them in conditions and change them in actions.
        </Empty>
      ) : (
        <Reorder.Group axis="y" values={order} onReorder={setOrder} className="flex flex-col gap-2">
          {order.map((id) => {
            const v = project.state.variables[id]
            if (!v) return null
            const own = issues.get(id) ?? []
            return (
              <DefCard
                key={id}
                project={project}
                scope={scope}
                def={v}
                issues={own.filter((i) => i.field !== 'namespace')}
                expanded={expanded === id}
                onToggle={() => setExpanded((c) => (c === id ? null : id))}
                onDragEnd={onDragEnd}
                badge={<span className="shrink-0 rounded bg-raised px-1.5 py-px font-mono text-[10px] text-muted">{v.namespace}.</span>}
                usage={usage.count.get(id) ?? 0}
                extraSettings={
                  <div className="col-span-2">
                    <FieldLabel label="Namespace" hint="first part of the name, e.g. World, Player, Quest">
                      <TextInput
                        value={v.namespace}
                        mono
                        required
                        invalid={own.some((i) => i.field === 'namespace' && i.level === 'error')}
                        onCommit={(ns) => updateDef(scope, id, { namespace: ns })}
                      />
                      <IssueList issues={own.filter((i) => i.field === 'namespace')} />
                    </FieldLabel>
                  </div>
                }
              />
            )
          })}
        </Reorder.Group>
      )}

      <Popover anchor={menu.anchor} onClose={menu.close} width={290}>
        <div className="border-b border-line px-2 pb-2 pt-1.5">
          <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-faint">Namespace</p>
          <div className="flex flex-wrap gap-1">
            {namespaces.map((ns) => (
              <button
                key={ns}
                type="button"
                onClick={() => setNamespace(ns)}
                className={cx('rounded px-1.5 py-0.5 font-mono text-2xs', namespace === ns ? 'bg-accent/20 text-accent' : 'bg-raised text-muted hover:text-fg')}
              >
                {ns}
              </button>
            ))}
            <input
              value={namespaces.includes(namespace) ? '' : namespace}
              onChange={(e) => setNamespace(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))}
              placeholder="new…"
              className="w-20 rounded border border-dashed border-line bg-transparent px-1.5 py-0.5 font-mono text-2xs text-fg outline-none focus:border-accent"
            />
          </div>
        </div>
        {PROPERTY_TYPES.filter((t) => t !== 'longText').map((type) => {
          const m = PROPERTY_TYPE_META[type]
          const Icon = m.icon
          return <MenuItem key={type} icon={<Icon size={14} />} label={m.label} hint={m.hint} onClick={() => add(type)} />
        })}
      </Popover>
    </>
  )
}

// ---------------------------------------------------------------------------
// Relationships

const RELATION_TYPES: PropertyType[] = ['number', 'boolean', 'enum', 'text']

function Relationships({ project }: { project: Project }) {
  const issues = useIssues()
  const usage = stateUsage(project)
  const rels = useMemo(() => Object.values(project.state.relationships).sort(compareOrder), [project.state.relationships])
  const commit = useCallback((ids: string[]) => reorderDefs({ kind: 'relationship' }, ids), [])
  const { order, setOrder, onDragEnd } = useOrder(rels, commit)
  const [expanded, setExpanded] = useState<string | null>(null)
  const templates = Object.values(project.templates).sort(compareOrder)
  const [from, setFrom] = useState<string | null>(null)
  const [to, setTo] = useState<string | null>(null)
  const menu = usePopover()
  const fromId = from ?? templates[0]?.id ?? null
  const toId = to ?? fromId

  const add = (type: PropertyType) => {
    if (!fromId || !toId) return
    menu.close()
    const id = addRelationship(fromId, toId, type)
    if (id) setExpanded(id)
  }

  const pairLabel = (a: string, b: string) => {
    const ta = project.templates[a]
    const tb = project.templates[b]
    const A = templateIcon(ta?.icon)
    const B = templateIcon(tb?.icon)
    return (
      <span className="inline-flex items-center gap-1">
        <A size={10} style={{ color: ta?.color }} /> {ta?.name ?? '?'} <ArrowRight size={10} /> <B size={10} style={{ color: tb?.color }} /> {tb?.name ?? '?'}
      </span>
    )
  }

  return (
    <>
      <SectionHead
        title={`Relationships · ${rels.length}`}
        action={
          <Button variant="primary" icon={Plus} disabled={templates.length === 0} onClick={(e) => menu.open(e.currentTarget)}>
            Add relationship
          </Button>
        }
      />
      {templates.length === 0 ? (
        <Empty title="Create a template first">Relationships connect entities of two templates, e.g. Character → Character.</Empty>
      ) : rels.length === 0 ? (
        <Empty title="No relationships yet">
          Add <strong className="text-muted">Trust</strong> from Character to Character, then write{' '}
          <code className="text-muted">Keeper-&gt;Stranger.Trust &gt;= 2</code> in a condition or{' '}
          <code className="text-muted">Keeper-&gt;Stranger.Trust += 1</code> in an action. Starting values are set on each entity’s sheet.
        </Empty>
      ) : (
        <Reorder.Group axis="y" values={order} onReorder={setOrder} className="flex flex-col gap-2">
          {order.map((id) => {
            const r = project.state.relationships[id]
            if (!r) return null
            const set = Object.values(project.entities).reduce((n, e) => n + Object.keys(e.relations?.[id] ?? {}).length, 0)
            return (
              <DefCard
                key={id}
                project={project}
                scope={{ kind: 'relationship' }}
                def={r}
                types={RELATION_TYPES}
                issues={issues.get(id) ?? []}
                expanded={expanded === id}
                onToggle={() => setExpanded((c) => (c === id ? null : id))}
                onDragEnd={onDragEnd}
                meta={pairLabel(r.fromTemplateId, r.toTemplateId)}
                usage={usage.count.get(id) ?? 0}
                deleteDetail={set ? `${set} starting value${set === 1 ? '' : 's'} set on entities will be removed.` : undefined}
              />
            )
          })}
        </Reorder.Group>
      )}

      <Popover anchor={menu.anchor} onClose={menu.close} width={300}>
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-1.5 border-b border-line px-2 pb-2 pt-1.5">
          <FieldLabel label="From">
            <Select value={fromId} options={templates.map((t) => ({ value: t.id, label: t.name }))} onChange={setFrom} />
          </FieldLabel>
          <ArrowRight size={14} className="mb-2 text-faint" />
          <FieldLabel label="To">
            <Select value={toId} options={templates.map((t) => ({ value: t.id, label: t.name }))} onChange={setTo} />
          </FieldLabel>
        </div>
        {RELATION_TYPES.map((type) => {
          const m = PROPERTY_TYPE_META[type]
          const Icon = m.icon
          const hint = { number: 'Trust, affection, fear: with limits', boolean: 'Knows, has met, owes a favour', enum: 'Attitude: Friendly / Neutral / Hostile', text: 'A free-form note' }[type as 'number']
          return <MenuItem key={type} icon={<Icon size={14} />} label={m.label} hint={hint} onClick={() => add(type)} />
        })}
      </Popover>
    </>
  )
}

// ---------------------------------------------------------------------------
// Time & rules

function TimeAndRules({ project }: { project: Project }) {
  const issues = useIssues()
  const time = project.state.time
  const phases = useMemo(() => Object.values(time.phases).sort((a, b) => a.order - b.order), [time.phases])
  const rules = useMemo(() => Object.values(project.state.rules).sort((a, b) => a.order - b.order), [project.state.rules])
  const phaseOrder = useOrder(phases, reorderPhases)
  const ruleOrder = useOrder(rules, reorderRules)
  const [draft, setDraft] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <>
      <SectionHead title={`Phases of a day · ${phases.length}`} />
      <div className="rounded-xl border border-line bg-panel/60 p-3">
        <Reorder.Group axis="x" values={phaseOrder.order} onReorder={phaseOrder.setOrder} className="flex flex-wrap gap-1.5">
          {phaseOrder.order.map((id, i) => {
            const phase = time.phases[id]
            if (!phase) return null
            return (
              <PhaseChip
                key={id}
                id={id}
                label={phase.label}
                technicalName={phase.technicalName}
                index={i}
                isStart={time.startPhaseId === id}
                onRename={(l) => renamePhase(id, l)}
                onRemove={async () => {
                  const used = rules.filter((r) => r.phaseId === id).length
                  if (
                    !used ||
                    (await window.api.confirm({
                      message: `Delete the phase “${phase.label}”?`,
                      detail: `${used} rule${used === 1 ? '' : 's'} tied to it will run every phase instead. Expressions naming it will show errors.`,
                      confirmLabel: 'Delete',
                      danger: true
                    }))
                  )
                    removePhase(id)
                }}
                onDragEnd={phaseOrder.onDragEnd}
              />
            )
          })}
        </Reorder.Group>
        <div className="mt-2 flex gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPhase(draft) && setDraft('')}
            placeholder="Add a phase (e.g. Midnight) and press Enter"
            className="w-full rounded-md border border-dashed border-line bg-transparent px-2 py-1.5 text-fg outline-none placeholder:text-faint focus:border-accent"
          />
          <Button icon={Plus} disabled={!draft.trim()} onClick={() => addPhase(draft) && setDraft('')}>
            Add
          </Button>
        </div>
        <p className="mt-2 text-2xs text-faint">
          Drag to reorder. After the last phase, a new day begins. In expressions: <code className="text-muted">Time.Phase is Night</code>,{' '}
          <code className="text-muted">Time.Phase &gt;= Dusk</code>, <code className="text-muted">Time.Day &gt;= 3</code>; in actions:{' '}
          <code className="text-muted">advance</code>, <code className="text-muted">advance 2</code>, <code className="text-muted">advance until Night</code> (stays if it’s already Night),{' '}
          <code className="text-muted">advance to Night</code> (always moves on: from Night, that’s the next Night).
        </p>
        <IssueList issues={[...(issues.get('state:time') ?? []), ...phases.flatMap((p) => issues.get(p.id) ?? [])]} />
      </div>

      <div className="mt-3 flex items-end gap-3">
        <div className="w-28">
          <FieldLabel label="Game starts on day">
            <NumberInput value={time.startDay} onCommit={(v) => v !== null && setTimeStart({ startDay: Math.round(v) })} />
          </FieldLabel>
        </div>
        <div className="w-44">
          <FieldLabel label="at">
            <Select value={time.startPhaseId} options={phases.map((p) => ({ value: p.id, label: p.label }))} onChange={(v) => setTimeStart({ startPhaseId: v })} />
          </FieldLabel>
        </div>
      </div>

      <SectionHead
        title={`Rules · ${rules.length}`}
        action={
          <Button
            variant="primary"
            icon={Plus}
            onClick={() => {
              const id = addRule()
              if (id) setExpanded(id)
            }}
          >
            Add rule
          </Button>
        }
      />
      {rules.length === 0 ? (
        <Empty title="No rules yet">
          Rules make the world move on its own. For example: when <strong className="text-muted">Night</strong> begins, for each{' '}
          <strong className="text-muted">Character</strong>: <code className="text-muted">self.Energy -= 1</code>. Or when a new day
          begins, if <code className="text-muted">Time.Day &gt;= 3</code>: <code className="text-muted">World.StormRaging = false</code>.
        </Empty>
      ) : (
        <Reorder.Group axis="y" values={ruleOrder.order} onReorder={ruleOrder.setOrder} className="flex flex-col gap-2">
          {ruleOrder.order.map((id) => {
            const rule = project.state.rules[id]
            if (!rule) return null
            return (
              <RuleCard
                key={id}
                project={project}
                rule={rule}
                issues={issues.get(id) ?? []}
                expanded={expanded === id}
                onToggle={() => setExpanded((c) => (c === id ? null : id))}
                onDragEnd={ruleOrder.onDragEnd}
              />
            )
          })}
        </Reorder.Group>
      )}
      {rules.length > 1 && <p className="mt-2 text-2xs text-faint">Rules run top to bottom. A new day runs day rules before phase rules.</p>}
    </>
  )
}

function PhaseChip({
  id,
  label,
  technicalName,
  index,
  isStart,
  onRename,
  onRemove,
  onDragEnd
}: {
  id: string
  label: string
  technicalName: string
  index: number
  isStart: boolean
  onRename(l: string): void
  onRemove(): void
  onDragEnd(): void
}) {
  const controls = useDragControls()
  return (
    <Reorder.Item
      value={id}
      title={technicalName}
      as="div"
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDragEnd}
      layout="position"
      className="group flex items-center gap-1 rounded-lg border border-line bg-bg py-1 pl-1 pr-1"
    >
      <button type="button" onPointerDown={(e) => controls.start(e)} className="cursor-grab touch-none text-faint" aria-label="Drag to reorder">
        <GripVertical size={12} />
      </button>
      <span className="text-[10px] tabular-nums text-faint">{index + 1}</span>
      <div className="w-24">
        <TextInput value={label} required onCommit={onRename} className="border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-line" />
      </div>
      {isStart && (
        <span title="The game starts in this phase" className="text-ok">
          <Play size={10} fill="currentColor" />
        </span>
      )}
      <IconButton size="sm" tone="danger" icon={X} label={`Delete ${label}`} onClick={onRemove} className="opacity-0 group-hover:opacity-100" />
    </Reorder.Item>
  )
}

function RuleCard({
  project,
  rule,
  issues,
  expanded,
  onToggle,
  onDragEnd
}: {
  project: Project
  rule: Rule
  issues: Issue[]
  expanded: boolean
  onToggle(): void
  onDragEnd(): void
}) {
  const controls = useDragControls()
  const phases = Object.values(project.state.time.phases).sort((a, b) => a.order - b.order)
  const forEach = rule.forEachTemplateId ? project.templates[rule.forEachTemplateId] : undefined
  const ctx = useMemo(() => ({ selfTemplateId: rule.forEachTemplateId, allowAdvance: false }), [rule.forEachTemplateId])
  const when =
    rule.trigger === 'day'
      ? 'When a new day begins'
      : rule.phaseId
        ? `When ${project.state.time.phases[rule.phaseId]?.label ?? '?'} begins`
        : 'Whenever a phase begins'
  const scope = rule.flowId ? project.flows[rule.flowId] : undefined
  const hasError = issues.some((i) => i.level === 'error')

  return (
    <Reorder.Item
      value={rule.id}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDragEnd}
      layout="position"
      className={cx('rounded-lg border bg-panel', expanded ? 'border-accent/40' : hasError ? 'border-danger/40' : 'border-line', !rule.enabled && 'opacity-60')}
    >
      <div className="flex items-center gap-2 py-1.5 pl-1 pr-1.5">
        <button type="button" onPointerDown={(e) => controls.start(e)} className="grid h-7 w-5 cursor-grab touch-none place-items-center text-faint" aria-label="Drag to reorder">
          <GripVertical size={14} />
        </button>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-raised text-warn">
          <Repeat size={14} />
        </span>
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left">
          <p className="truncate font-medium text-fg">{rule.name}</p>
          <p className="truncate text-2xs text-faint">
            {when}
            {forEach ? ` · for each ${forEach.name}` : ''}
            {scope ? ` · only during “${scope.name}”` : ''}
            {rule.condition.trim() ? ` · if ${rule.condition.trim()}` : ''}
          </p>
        </button>
        <Toggle checked={rule.enabled} onChange={(enabled) => updateRule(rule.id, { enabled })} label="Enabled" />
        <IconButton size="sm" tone="danger" icon={Trash2} label={`Delete ${rule.name}`} onClick={() => removeRule(rule.id)} />
      </div>
      {!expanded && issues.length > 0 && (
        <div className="px-10 pb-2">
          <IssueList issues={issues} />
        </div>
      )}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line px-4 pb-4 pt-3">
              <div className="col-span-2">
                <FieldLabel label="Name">
                  <TextInput value={rule.name} required onCommit={(name) => updateRule(rule.id, { name })} />
                </FieldLabel>
              </div>
              <FieldLabel label="When">
                <Select
                  value={rule.trigger === 'day' ? 'day' : (rule.phaseId ?? 'any')}
                  options={[
                    { value: 'any', label: 'Whenever a phase begins' },
                    { value: 'day', label: 'When a new day begins' },
                    ...phases.map((p) => ({ value: p.id, label: `When ${p.label} begins`, group: 'A specific phase' }))
                  ]}
                  onChange={(v) =>
                    v === 'day'
                      ? updateRule(rule.id, { trigger: 'day', phaseId: null })
                      : updateRule(rule.id, { trigger: 'phase', phaseId: v === 'any' ? null : v })
                  }
                />
              </FieldLabel>
              <FieldLabel label="Run" hint="“self” is each entity in turn">
                <Select
                  value={rule.forEachTemplateId ?? 'once'}
                  options={[
                    { value: 'once', label: 'Once' },
                    ...Object.values(project.templates)
                      .sort(compareOrder)
                      .map((t) => ({ value: t.id, label: `For each ${t.name}` }))
                  ]}
                  onChange={(v) => updateRule(rule.id, { forEachTemplateId: v === 'once' ? null : v })}
                />
              </FieldLabel>
              <div className="col-span-2">
                <FieldLabel label="While playing" hint="limit the rule to one flow, e.g. a scene with its own clock">
                  <Select
                    value={rule.flowId && project.flows[rule.flowId] ? rule.flowId : 'any'}
                    options={[
                      { value: 'any', label: 'Any time (whatever is playing)' },
                      ...Object.values(project.flows)
                        .sort(compareOrder)
                        .map((f) => ({ value: f.id, label: `Only while “${f.name}” is playing`, group: 'One flow' }))
                    ]}
                    onChange={(v) => updateRule(rule.id, { flowId: v === 'any' ? null : v })}
                  />
                </FieldLabel>
              </div>
              <div className="col-span-2">
                <FieldLabel label="Only if" hint="optional condition">
                  <ExpressionField
                    project={project}
                    value={rule.condition}
                    mode="condition"
                    ctx={ctx}
                    placeholder={forEach ? 'self.Energy > 0' : 'Time.Day >= 3'}
                    onCommit={(condition) => updateRule(rule.id, { condition })}
                  />
                </FieldLabel>
              </div>
              <div className="col-span-2">
                <FieldLabel label="Then" hint="one change per line">
                  <ExpressionField
                    project={project}
                    value={rule.effects}
                    mode="action"
                    ctx={ctx}
                    rows={3}
                    placeholder={forEach ? 'self.Energy -= 1' : 'World.StormRaging = false'}
                    onCommit={(effects) => updateRule(rule.id, { effects })}
                  />
                </FieldLabel>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Reorder.Item>
  )
}
