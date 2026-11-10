import { AnimatePresence, motion, Reorder, useDragControls } from 'framer-motion'
import { ChevronDown, GripVertical, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PROPERTY_TYPES, type EnumOption, type Project, type PropertyDef, type PropertyType } from '@shared/schema'
import type { Issue } from '@shared/validate'
import { defaultOf } from '@shared/values'
import { cx } from '../../lib/cx'
import { PROPERTY_TYPE_META } from '../../lib/meta'
import { compareOrder } from '../../lib/tree'
import {
  addEnumOption,
  countLossOnDefType,
  removeDef,
  removeEnumOption,
  renameEnumOption,
  reorderEnumOptions,
  setDefType,
  updateDef,
  type DefScope,
  type PropertyPatch
} from '../../store/ops'
import { ValueEditor } from '../entities/ValueEditor'
import { Button } from '../ui/Button'
import { FieldLabel, IssueList, NumberInput, Select, TextInput, Toggle } from '../ui/fields'
import { IconButton } from '../ui/IconButton'

/**
 * One editable definition: a template property, a world variable or a
 * relationship. Drag handle, name, type, and expandable settings.
 */
export function DefCard({
  project,
  scope,
  def,
  issues,
  expanded,
  onToggle,
  onDragEnd,
  types = PROPERTY_TYPES,
  badge,
  meta,
  extraSettings,
  stateToggle,
  usage,
  deleteDetail
}: {
  project: Project
  scope: DefScope
  def: PropertyDef
  issues: Issue[]
  expanded: boolean
  onToggle(): void
  onDragEnd(): void
  types?: readonly PropertyType[]
  /** Small label beside the name (e.g. STATE). */
  badge?: ReactNode
  /** Shown next to the technical name (e.g. "Character → Character"). */
  meta?: ReactNode
  extraSettings?: ReactNode
  /** Template properties only: offer the "changes during play" switch. */
  stateToggle?: boolean
  /** How many expressions refer to this definition. */
  usage?: number
  /** Extra sentence for the delete confirmation (values that will be lost). */
  deleteDetail?: string
}) {
  const controls = useDragControls()
  const meta_ = PROPERTY_TYPE_META[def.type]
  const TypeIcon = meta_.icon
  const hasError = issues.some((i) => i.level === 'error')

  const changeType = async (type: PropertyType) => {
    if (type === def.type) return
    const lost = countLossOnDefType(project, scope, def.id, type)
    if (lost > 0) {
      const ok = await window.api.confirm({
        message: `Change “${def.name}” to ${PROPERTY_TYPE_META[type].label}?`,
        detail: `${lost} value${lost === 1 ? '' : 's'} can't be converted and will be cleared. You can undo this with Ctrl+Z.`,
        confirmLabel: 'Change type',
        danger: true
      })
      if (!ok) return
    }
    setDefType(scope, def.id, type)
  }

  const remove = async () => {
    const parts = [deleteDetail, usage ? `${usage} expression${usage === 1 ? ' refers' : 's refer'} to it and will show errors.` : null].filter(Boolean)
    if (
      parts.length === 0 ||
      (await window.api.confirm({
        message: `Delete “${def.name}”?`,
        detail: `${parts.join(' ')} You can undo this with Ctrl+Z.`,
        confirmLabel: 'Delete',
        danger: true
      }))
    ) {
      removeDef(scope, def.id)
    }
  }

  return (
    <Reorder.Item
      value={def.id}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDragEnd}
      layout="position"
      whileDrag={{ scale: 1.015, boxShadow: '0 16px 40px -16px rgb(0 0 0 / 0.8)', zIndex: 10 }}
      className={cx(
        'relative rounded-lg border bg-panel transition-colors',
        expanded ? 'border-accent/40' : hasError ? 'border-danger/40' : 'border-line hover:border-faint/50'
      )}
    >
      <div className="flex items-center gap-2 py-1.5 pl-1 pr-1.5">
        <button
          type="button"
          aria-label="Drag to reorder"
          onPointerDown={(e) => controls.start(e)}
          className="grid h-7 w-5 shrink-0 cursor-grab touch-none place-items-center rounded text-faint hover:text-muted active:cursor-grabbing"
        >
          <GripVertical size={14} />
        </button>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-raised text-muted" title={meta_.label}>
          <TypeIcon size={14} />
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <TextInput
              value={def.name}
              required
              onCommit={(name) => updateDef(scope, def.id, { name })}
              className="border-transparent bg-transparent px-1.5 py-1 font-medium hover:border-line"
            />
          </div>
          {badge}
        </div>
        <div className="hidden shrink-0 flex-col items-end leading-tight sm:flex">
          <code className="max-w-[180px] truncate font-mono text-2xs text-faint" title="Technical name">
            {def.technicalName}
          </code>
          {(meta || usage !== undefined) && (
            <span className="text-[10px] text-faint">
              {meta}
              {meta && usage !== undefined && ' · '}
              {usage !== undefined && (usage ? `used ${usage}×` : 'unused')}
            </span>
          )}
        </div>
        <div className="w-32 shrink-0">
          <Select
            value={def.type}
            options={types.map((t) => ({ value: t, label: PROPERTY_TYPE_META[t].label }))}
            onChange={(v) => v && void changeType(v as PropertyType)}
          />
        </div>
        <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}>
          <IconButton size="sm" icon={ChevronDown} label={expanded ? 'Collapse' : 'Settings'} active={expanded} onClick={onToggle} />
        </motion.span>
        <IconButton size="sm" tone="danger" icon={Trash2} label={`Delete ${def.name}`} onClick={() => void remove()} />
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
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            <DefSettings project={project} scope={scope} def={def} issues={issues} extra={extraSettings} stateToggle={stateToggle} />
          </motion.div>
        )}
      </AnimatePresence>
    </Reorder.Item>
  )
}

function DefSettings({
  project,
  scope,
  def,
  issues,
  extra,
  stateToggle
}: {
  project: Project
  scope: DefScope
  def: PropertyDef
  issues: Issue[]
  extra?: ReactNode
  stateToggle?: boolean
}) {
  const techIssues = issues.filter((i) => i.field === 'technicalName')
  const otherIssues = issues.filter((i) => i.field !== 'technicalName')
  const patch = (p: PropertyPatch) => updateDef(scope, def.id, p)

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line px-4 pb-4 pt-3">
      <FieldLabel label="Technical name" hint="used in expressions and export">
        <TextInput
          value={def.technicalName}
          mono
          invalid={techIssues.some((i) => i.level === 'error')}
          onCommit={(technicalName) => patch({ technicalName })}
        />
        <IssueList issues={techIssues} />
      </FieldLabel>

      <FieldLabel label={scope.kind === 'template' ? 'Default value' : 'Starting value'} hint={scope.kind === 'template' ? 'used until an entity sets its own' : 'at the start of the game'}>
        <ValueEditor project={project} prop={def} value={defaultOf(def)} onChange={(defaultValue) => patch({ defaultValue })} />
      </FieldLabel>

      {stateToggle && (
        <div className="col-span-2 flex items-start justify-between gap-4 rounded-md border border-line bg-bg/40 px-3 py-2">
          <div>
            <p className="text-xs text-fg">Changes during play</p>
            <p className="text-2xs leading-snug text-faint">
              Makes this property part of the game state: actions and rules can change it (e.g. Mood, Health, Location). Leave off
              for fixed design data like a biography.
            </p>
          </div>
          <Toggle checked={def.mutable === true} onChange={(v) => patch({ mutable: v || undefined })} label="Changes during play" />
        </div>
      )}

      {extra}

      <div className="col-span-2">
        <FieldLabel label="Description">
          <TextInput value={def.description} placeholder="Shown as help text" onCommit={(description) => patch({ description })} />
        </FieldLabel>
      </div>

      {def.type === 'number' && (
        <>
          <FieldLabel label="Minimum">
            <NumberInput value={def.min ?? null} placeholder="none" onCommit={(v) => patch({ min: v ?? undefined })} />
          </FieldLabel>
          <FieldLabel label="Maximum">
            <NumberInput value={def.max ?? null} placeholder="none" onCommit={(v) => patch({ max: v ?? undefined })} />
          </FieldLabel>
          <div className="col-span-2 flex items-center gap-2">
            <Toggle checked={def.integer === true} onChange={(v) => patch({ integer: v || undefined })} label="Whole numbers only" />
            <span className="text-xs text-muted">Whole numbers only</span>
            {scope.kind !== 'template' || def.mutable ? (
              <span className="ml-auto text-2xs text-faint">Changes during play are kept within these limits.</span>
            ) : null}
          </div>
        </>
      )}

      {def.type === 'reference' && (
        <div className="col-span-2">
          <FieldLabel label="Links to" hint="limit which entities can be picked">
            <Select
              value={def.referenceTemplateId ?? null}
              placeholder="Any entity"
              options={Object.values(project.templates)
                .sort(compareOrder)
                .map((t) => ({ value: t.id, label: t.name }))}
              onChange={(v) => patch({ referenceTemplateId: v ?? undefined })}
            />
          </FieldLabel>
        </div>
      )}

      {def.type === 'enum' && (
        <div className="col-span-2">
          <EnumOptionsEditor scope={scope} def={def} />
        </div>
      )}

      {otherIssues.length > 0 && (
        <div className="col-span-2">
          <IssueList issues={otherIssues} />
        </div>
      )}
    </div>
  )
}

function EnumOptionsEditor({ scope, def }: { scope: DefScope; def: PropertyDef }) {
  const options = useMemo(
    () => Object.values(def.options ?? {}).sort((a, b) => compareOrder({ ...a, name: a.label }, { ...b, name: b.label })),
    [def.options]
  )
  const [order, setOrder] = useState(() => options.map((o) => o.id))
  useEffect(() => setOrder(options.map((o) => o.id)), [options])
  const orderRef = useRef(order)
  orderRef.current = order
  const [draft, setDraft] = useState('')

  const add = () => {
    if (addEnumOption(scope, def.id, draft)) setDraft('')
  }

  return (
    <div>
      <span className="mb-1 block text-xs text-muted">Options</span>
      <Reorder.Group axis="y" values={order} onReorder={setOrder} className="flex flex-col gap-1">
        {order.map((id) => {
          const option = def.options?.[id]
          return option ? (
            <OptionRow
              key={id}
              option={option}
              isDefault={def.defaultValue === id}
              onRename={(label) => renameEnumOption(scope, def.id, id, label)}
              onRemove={() => removeEnumOption(scope, def.id, id)}
              onDragEnd={() => reorderEnumOptions(scope, def.id, orderRef.current)}
            />
          ) : null
        })}
      </Reorder.Group>
      <div className="mt-1.5 flex gap-1.5">
        <input
          value={draft}
          placeholder="Add an option and press Enter"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          className="w-full rounded-md border border-dashed border-line bg-transparent px-2 py-1.5 text-fg outline-none placeholder:text-faint focus:border-accent"
        />
        <Button onClick={add} disabled={!draft.trim()} icon={Plus}>
          Add
        </Button>
      </div>
    </div>
  )
}

function OptionRow({
  option,
  isDefault,
  onRename,
  onRemove,
  onDragEnd
}: {
  option: EnumOption
  isDefault: boolean
  onRename(label: string): void
  onRemove(): void
  onDragEnd(): void
}) {
  const controls = useDragControls()
  return (
    <Reorder.Item
      value={option.id}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDragEnd}
      layout="position"
      whileDrag={{ scale: 1.02, zIndex: 10 }}
      className="flex items-center gap-1 rounded-md bg-bg/60"
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        onPointerDown={(e) => controls.start(e)}
        className="grid h-7 w-5 shrink-0 cursor-grab touch-none place-items-center text-faint hover:text-muted"
      >
        <GripVertical size={12} />
      </button>
      <div className="min-w-0 flex-1">
        <TextInput value={option.label} required onCommit={onRename} className="border-transparent bg-transparent px-1.5 py-1 hover:border-line" />
      </div>
      {isDefault && <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-2xs text-accent">default</span>}
      <IconButton size="sm" tone="danger" icon={X} label={`Remove ${option.label}`} onClick={onRemove} />
    </Reorder.Item>
  )
}

export function StateBadge() {
  return (
    <span
      className="shrink-0 rounded bg-loop/15 px-1.5 py-px text-[10px] font-semibold tracking-wider text-loop"
      title="Part of the game state: actions and rules can change it"
    >
      STATE
    </span>
  )
}
