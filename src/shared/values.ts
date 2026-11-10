import type { Project, PropertyDef, PropertyType, PropertyValue } from './schema'

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

/** The value a property has when nothing (not even a default) is set. */
export function emptyValue(type: PropertyType): PropertyValue {
  switch (type) {
    case 'text':
    case 'longText':
      return ''
    case 'boolean':
      return false
    case 'color':
      return '#ffffff'
    case 'number':
    case 'enum':
    case 'reference':
      return null
  }
}

export function defaultOf(prop: PropertyDef): PropertyValue {
  return prop.defaultValue !== undefined ? prop.defaultValue : emptyValue(prop.type)
}

/** An entity's value for a property, and whether it overrides the template default. */
export function effectiveValue(
  prop: PropertyDef,
  values: Record<string, PropertyValue>
): { value: PropertyValue; overridden: boolean } {
  const own = values[prop.id]
  return own !== undefined ? { value: own, overridden: true } : { value: defaultOf(prop), overridden: false }
}

/**
 * Structural problems: the value can't mean anything for this property (wrong
 * type, an enum option or entity that no longer exists). These are repaired on load.
 */
export function structuralValueProblem(
  project: Pick<Project, 'entities'>,
  prop: PropertyDef,
  value: PropertyValue
): string | null {
  switch (prop.type) {
    case 'text':
    case 'longText':
      return typeof value === 'string' ? null : 'expected text'
    case 'number':
      return value === null || typeof value === 'number' ? null : 'expected a number'
    case 'boolean':
      return typeof value === 'boolean' ? null : 'expected true or false'
    case 'enum':
      if (value === null) return null
      if (typeof value !== 'string') return 'expected an option'
      return prop.options?.[value] ? null : 'that option no longer exists'
    case 'reference':
      if (value === null) return null
      if (typeof value !== 'string') return 'expected an entity'
      return project.entities[value] ? null : 'the referenced entity no longer exists'
    case 'color':
      return typeof value === 'string' && HEX_COLOR_RE.test(value) ? null : 'expected a #rrggbb colour'
  }
}

/**
 * Soft problems: the value is well-formed but breaks a rule the designer set
 * (out of range, wrong template). Shown as warnings; the data is kept.
 */
export function ruleValueProblem(
  project: Pick<Project, 'entities'>,
  prop: PropertyDef,
  value: PropertyValue
): string | null {
  if (prop.type === 'number' && typeof value === 'number') {
    if (prop.integer && !Number.isInteger(value)) return 'must be a whole number'
    if (prop.min !== undefined && value < prop.min) return `must be at least ${prop.min}`
    if (prop.max !== undefined && value > prop.max) return `must be at most ${prop.max}`
  }
  if (prop.type === 'reference' && typeof value === 'string' && prop.referenceTemplateId) {
    const target = project.entities[value]
    if (target && target.templateId !== prop.referenceTemplateId) return 'refers to an entity of a different template'
  }
  return null
}

/**
 * Best-effort conversion when a property changes type. Returns undefined when
 * the value can't be carried over (the caller then drops it).
 */
export function coerceValue(value: PropertyValue, to: PropertyType): PropertyValue | undefined {
  if (value === null) return undefined
  switch (to) {
    case 'text':
    case 'longText':
      return typeof value === 'string' ? value : String(value)
    case 'number': {
      if (typeof value === 'number') return value
      if (typeof value === 'boolean') return value ? 1 : 0
      const text = value.trim()
      const n = Number(text)
      return text !== '' && Number.isFinite(n) ? n : undefined
    }
    case 'boolean':
      if (typeof value === 'boolean') return value
      if (typeof value === 'number') return value !== 0
      if (/^(true|yes|1)$/i.test(value.trim())) return true
      if (/^(false|no|0)$/i.test(value.trim())) return false
      return undefined
    case 'color':
      return typeof value === 'string' && HEX_COLOR_RE.test(value) ? value.toLowerCase() : undefined
    case 'enum':
    case 'reference':
      return undefined
  }
}
