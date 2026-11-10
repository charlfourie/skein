import type { Project, PropertyDef, PropertyValue } from '@shared/schema'
import { compareOrder } from '../../lib/tree'
import { ColorInput, NumberInput, Select, TextArea, TextInput, Toggle, type SelectOption } from '../ui/fields'

interface ValueEditorProps {
  project: Project
  prop: PropertyDef
  value: PropertyValue
  onChange(value: PropertyValue): void
  /** Show the value as inherited from the template default (dimmed). */
  inherited?: boolean
  invalid?: boolean
}

/** Edits one property value, with the right control for the property's type. */
export function ValueEditor({ project, prop, value, onChange, inherited, invalid }: ValueEditorProps) {
  switch (prop.type) {
    case 'text':
      return <TextInput value={asString(value)} onCommit={onChange} dimmed={inherited} />
    case 'longText':
      return <TextArea value={asString(value)} onCommit={onChange} rows={4} dimmed={inherited} />
    case 'number':
      return (
        <NumberInput
          value={typeof value === 'number' ? value : null}
          onCommit={onChange}
          placeholder={rangeHint(prop)}
          dimmed={inherited}
          invalid={invalid}
        />
      )
    case 'boolean':
      return (
        <div className="flex h-8 items-center gap-2">
          <Toggle checked={value === true} onChange={onChange} dimmed={inherited} label={prop.name} />
          <span className={inherited ? 'text-faint' : 'text-muted'}>{value === true ? 'Yes' : 'No'}</span>
        </div>
      )
    case 'enum': {
      const options: SelectOption[] = Object.values(prop.options ?? {})
        .sort((a, b) => compareOrder({ ...a, name: a.label }, { ...b, name: b.label }))
        .map((o) => ({ value: o.id, label: o.label }))
      return (
        <Select
          value={typeof value === 'string' ? value : null}
          options={options}
          placeholder="—"
          onChange={onChange}
          dimmed={inherited}
        />
      )
    }
    case 'reference':
      return (
        <Select
          value={typeof value === 'string' ? value : null}
          options={referenceOptions(project, prop)}
          placeholder="None"
          onChange={onChange}
          dimmed={inherited}
          invalid={invalid}
        />
      )
    case 'color':
      return <ColorInput value={typeof value === 'string' ? value : '#ffffff'} onCommit={onChange} dimmed={inherited} />
  }
}

function asString(value: PropertyValue): string {
  return typeof value === 'string' ? value : value === null ? '' : String(value)
}

function rangeHint(prop: PropertyDef): string | undefined {
  if (prop.min !== undefined && prop.max !== undefined) return `${prop.min} – ${prop.max}`
  if (prop.min !== undefined) return `≥ ${prop.min}`
  if (prop.max !== undefined) return `≤ ${prop.max}`
  return undefined
}

function referenceOptions(project: Project, prop: PropertyDef): SelectOption[] {
  const filter = prop.referenceTemplateId ?? null
  return Object.values(project.entities)
    .filter((e) => filter === null || e.templateId === filter)
    .sort((a, b) => {
      const ta = project.templates[a.templateId]?.name ?? ''
      const tb = project.templates[b.templateId]?.name ?? ''
      return ta.localeCompare(tb) || compareOrder(a, b)
    })
    .map((e) => ({ value: e.id, label: e.name, group: filter ? undefined : project.templates[e.templateId]?.name ?? 'Unknown' }))
}
