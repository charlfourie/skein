import type { Draft } from 'immer'
import {
  createEntity as makeEntity,
  createFlow as makeFlow,
  createFolder as makeFolder,
  createPhase as makePhase,
  createProperty as makeProperty,
  createRelationship as makeRelationship,
  createRule as makeRule,
  createStateVariable as makeStateVariable,
  createTemplate as makeTemplate,
  TEMPLATE_COLORS
} from '@shared/factory'
import { applyRename } from '@shared/expr/sites'
import { reprefixLines } from '@shared/lineIds'
import { newId } from '@shared/ids'
import {
  changePropertyType,
  countLossOnTypeChange,
  deleteEntities,
  deletePhase,
  deleteRelationship,
  deleteFolderTree,
  deleteTestsOfFlows,
  deleteTemplates,
  removeEnumOption as removeEnumOptionMutation,
  removeProperty as removePropertyMutation
} from '@shared/mutations'
import type {
  Project,
  ProjectMeta,
  PropertyDef,
  PropertyType,
  PropertyValue,
  RelationshipDef,
  Rule,
  Scenario,
  SectionId,
  StateVariable,
  StoryTest,
  Template
} from '@shared/schema'
import { coerceValue } from '@shared/values'
import { isDerivedTechnicalName, toTechnicalName, uniqueTechnicalName } from '@shared/technicalName'
import { compareOrder, nextOrder } from '../lib/tree'
import { docExists, selectionExists, useProjectStore, type TreeKind } from './projectStore'

/**
 * Every change to the project document goes through one of these functions,
 * each of which is a single undoable step.
 */

const store = () => useProjectStore.getState()
const edit = (label: string, recipe: (p: Draft<Project>) => void) => store().edit(label, recipe)

export const PROPERTY_DEFAULT_NAMES: Record<PropertyType, string> = {
  text: 'Text',
  longText: 'Notes',
  number: 'Number',
  boolean: 'Flag',
  enum: 'Choice',
  reference: 'Link',
  color: 'Colour'
}

// ---------------------------------------------------------------------------
// Tree

export function createFolder(section: SectionId, parentId: string | null): string | null {
  const id = newId()
  const ok = edit('New folder', (p) => {
    const siblings = Object.values(p.folders).filter((f) => f.section === section && f.parentId === parentId)
    p.folders[id] = makeFolder(id, 'New Folder', section, parentId, nextOrder(siblings))
  })
  if (!ok) return null
  useProjectStore.setState({ selection: { kind: 'folder', id }, renamingId: id })
  return id
}

export function createFlow(folderId: string | null): string | null {
  const id = newId()
  const ok = edit('New flow', (p) => {
    const siblings = Object.values(p.flows).filter((f) => f.folderId === folderId)
    p.flows[id] = makeFlow(id, 'New Flow', folderId, nextOrder(siblings))
  })
  if (!ok) return null
  store().select({ kind: 'flow', id })
  store().setRenaming(id)
  return id
}

export function createTemplate(folderId: string | null): string | null {
  const id = newId()
  const ok = edit('New template', (p) => {
    const all = Object.values(p.templates)
    const technicalName = uniqueTechnicalName('NewTemplate', all.map((t) => t.technicalName))
    const color = TEMPLATE_COLORS[all.length % TEMPLATE_COLORS.length]
    const siblings = all.filter((t) => t.folderId === folderId)
    p.templates[id] = makeTemplate(id, 'New Template', technicalName, folderId, nextOrder(siblings), color)
  })
  if (!ok) return null
  store().select({ kind: 'template', id })
  store().setRenaming(id)
  return id
}

export function createEntity(templateId: string, folderId: string | null): string | null {
  const template = store().project?.templates[templateId]
  if (!template) return null
  const id = newId()
  const ok = edit(`New ${template.name}`, (p) => {
    const all = Object.values(p.entities)
    const name = `New ${template.name}`
    const technicalName = uniqueTechnicalName(toTechnicalName(name), all.map((e) => e.technicalName))
    const siblings = all.filter((e) => e.folderId === folderId)
    p.entities[id] = makeEntity(id, name, technicalName, templateId, folderId, nextOrder(siblings))
  })
  if (!ok) return null
  store().select({ kind: 'entity', id })
  store().setRenaming(id)
  return id
}

export function duplicateEntity(sourceId: string): string | null {
  const source = store().project?.entities[sourceId]
  if (!source) return null
  const id = newId()
  const ok = edit(`Duplicate ${source.name}`, (p) => {
    const all = Object.values(p.entities)
    const name = `${source.name} Copy`
    const technicalName = uniqueTechnicalName(toTechnicalName(name), all.map((e) => e.technicalName))
    // Place it right after the source; later siblings shift down by one.
    for (const e of all) if (e.folderId === source.folderId && e.order > source.order) e.order += 1
    p.entities[id] = {
      ...makeEntity(id, name, technicalName, source.templateId, source.folderId, source.order + 1),
      values: { ...source.values }
    }
  })
  if (!ok) return null
  store().select({ kind: 'entity', id })
  return id
}

/** Rename a tree item. Technical names that were auto-derived follow the new name. */
export function renameItem(kind: TreeKind, id: string, rawName: string): void {
  const name = rawName.trim()
  if (!name) return
  edit('Rename', (p) => {
    if (kind === 'folder') {
      if (p.folders[id]) p.folders[id].name = name
    } else if (kind === 'flow') {
      if (p.flows[id]) p.flows[id].name = name
    } else {
      const col = kind === 'template' ? p.templates : p.entities
      const item = col[id]
      if (!item || item.name === name) return
      if (isDerivedTechnicalName(item.technicalName, item.name)) {
        const taken = Object.values(col)
          .filter((o) => o.id !== id)
          .map((o) => o.technicalName)
        const next = uniqueTechnicalName(toTechnicalName(name), taken)
        if (kind === 'entity' && next !== item.technicalName) {
          applyRename(p, { kind: 'entity', from: item.technicalName, to: next })
        }
        item.technicalName = next
      }
      item.name = name
    }
  })
}

/** Delete a tree item and everything that depends on it. (Confirmation is the caller's job.) */
export function deleteItem(kind: TreeKind, id: string): void {
  edit('Delete', (p) => {
    if (kind === 'flow') {
      delete p.flows[id]
      deleteTestsOfFlows(p, new Set([id]))
    }    else if (kind === 'entity') deleteEntities(p, [id])
    else if (kind === 'template') deleteTemplates(p, [id])
    else deleteFolderTree(p, id)
  })
  const s = store()
  if (s.project) {
    // Selection/doc may point at something that's gone now.
    const { selection, activeDoc } = s
    const project = s.project
    useProjectStore.setState({
      selection: selectionExists(project, selection) ? selection : { kind: 'project' },
      activeDoc: activeDoc && !docExists(project, activeDoc) ? null : activeDoc,
      renamingId: null
    })
  }
}

export function updateMeta(patch: Partial<Pick<ProjectMeta, 'name' | 'description'>>): void {
  edit('Edit project', (p) => {
    for (const [k, v] of Object.entries(patch) as Array<[keyof typeof patch, string]>) {
      if (p.meta[k] !== v) p.meta[k] = v
    }
  })
}

// ---------------------------------------------------------------------------
// Templates

type TemplatePatch = Partial<Pick<Template, 'technicalName' | 'description' | 'color' | 'icon'>>

export function updateTemplate(id: string, patch: TemplatePatch): void {
  edit('Edit template', (p) => {
    const t = p.templates[id]
    if (!t) return
    for (const [k, v] of Object.entries(patch) as Array<[keyof TemplatePatch, string]>) {
      if (t[k] !== v) t[k] = v
    }
  })
}

/**
 * Where a property-like definition lives. Template properties, world
 * variables and relationships share one shape (name, technical name, type,
 * default, limits, options), so they share these operations.
 */
export type DefScope = { kind: 'template'; templateId: string } | { kind: 'variable' } | { kind: 'relationship' }

function defsOf(p: Draft<Project>, scope: DefScope): Record<string, PropertyDef> | undefined {
  if (scope.kind === 'template') return p.templates[scope.templateId]?.properties
  return (scope.kind === 'variable' ? p.state.variables : p.state.relationships) as unknown as Record<string, PropertyDef>
}

/** Definitions whose technical names must be unique together with `def`. */
function siblingsOf(p: Draft<Project>, scope: DefScope, def: PropertyDef): PropertyDef[] {
  const all = Object.values(defsOf(p, scope) ?? {}).filter((d) => d.id !== def.id)
  if (scope.kind === 'variable') {
    const ns = (def as unknown as StateVariable).namespace
    return all.filter((d) => (d as unknown as StateVariable).namespace === ns)
  }
  if (scope.kind === 'relationship') {
    const r = def as unknown as RelationshipDef
    return all.filter((d) => {
      const o = d as unknown as RelationshipDef
      return o.fromTemplateId === r.fromTemplateId && o.toTemplateId === r.toTemplateId
    })
  }
  return all
}

/** Rewrite expressions that refer to `def` by its old technical name. */
function followRename(p: Draft<Project>, scope: DefScope, def: PropertyDef, next: { technicalName: string; namespace?: string }): void {
  if (scope.kind === 'template') {
    applyRename(p, { kind: 'property', templateId: scope.templateId, from: def.technicalName, to: next.technicalName })
  } else if (scope.kind === 'relationship') {
    const r = def as unknown as RelationshipDef
    applyRename(p, { kind: 'relationship', fromTemplateId: r.fromTemplateId, toTemplateId: r.toTemplateId, from: def.technicalName, to: next.technicalName })
  } else {
    const v = def as unknown as StateVariable
    applyRename(p, {
      kind: 'variable',
      fromNamespace: v.namespace,
      fromName: v.technicalName,
      toNamespace: next.namespace ?? v.namespace,
      toName: next.technicalName
    })
  }
}

function newDefName(existing: PropertyDef[], type: PropertyType): { name: string; technicalName: string } {
  const baseName = PROPERTY_DEFAULT_NAMES[type]
  const takenNames = new Set(existing.map((x) => x.name.toLowerCase()))
  let name = baseName
  for (let i = 2; takenNames.has(name.toLowerCase()); i++) name = `${baseName} ${i}`
  return { name, technicalName: uniqueTechnicalName(toTechnicalName(name), existing.map((x) => x.technicalName)) }
}

export function addProperty(templateId: string, type: PropertyType): string | null {
  const id = newId()
  const ok = edit('Add property', (p) => {
    const t = p.templates[templateId]
    if (!t) return
    const props = Object.values(t.properties)
    const { name, technicalName } = newDefName(props, type)
    t.properties[id] = makeProperty(id, name, technicalName, type, nextOrder(props))
  })
  return ok ? id : null
}

/** Patch fields of a definition. A field set to `undefined` is removed. */
export type PropertyPatch = Partial<
  Pick<
    PropertyDef,
    'name' | 'technicalName' | 'description' | 'defaultValue' | 'referenceTemplateId' | 'min' | 'max' | 'integer' | 'mutable'
  >
> & { namespace?: string; showInPlay?: boolean }

export function updateDef(scope: DefScope, id: string, patch: PropertyPatch): void {
  edit('Edit definition', (p) => {
    const defs = defsOf(p, scope)
    const def = defs?.[id]
    if (!def) return
    const target = def as Record<string, unknown>

    // Work out the new identity first, so references can be rewritten from old to new.
    let technicalName = def.technicalName
    let namespace = scope.kind === 'variable' ? (def as unknown as StateVariable).namespace : undefined
    const name = patch.name?.trim()
    if (name && name !== def.name && patch.technicalName === undefined && isDerivedTechnicalName(def.technicalName, def.name)) {
      technicalName = uniqueTechnicalName(toTechnicalName(name), siblingsOf(p, scope, def).map((x) => x.technicalName))
    }
    if (patch.technicalName !== undefined) technicalName = patch.technicalName.trim()
    if (patch.namespace !== undefined && scope.kind === 'variable') namespace = patch.namespace.trim() || 'World'
    const identityChanged =
      technicalName !== def.technicalName || (scope.kind === 'variable' && namespace !== (def as unknown as StateVariable).namespace)
    if (identityChanged && technicalName) followRename(p, scope, def, { technicalName, namespace })
    if (name && name !== def.name) def.name = name
    if (technicalName !== def.technicalName) def.technicalName = technicalName
    if (scope.kind === 'variable' && namespace !== undefined && target.namespace !== namespace) target.namespace = namespace

    for (const [k, v] of Object.entries(patch)) {
      if (k === 'name' || k === 'technicalName' || k === 'namespace') continue
      if (v === undefined) delete target[k]
      else if (target[k] !== v) target[k] = v
    }
  })
}

export function updateProperty(templateId: string, propertyId: string, patch: PropertyPatch): void {
  updateDef({ kind: 'template', templateId }, propertyId, patch)
}

/** Values that would be lost if a definition changed type. */
export function countLossOnDefType(project: Project, scope: DefScope, id: string, type: PropertyType): number {
  if (scope.kind === 'template') return countLossOnTypeChange(project, scope.templateId, id, type)
  if (scope.kind === 'variable') return 0
  let lost = 0
  for (const e of Object.values(project.entities)) {
    for (const v of Object.values(e.relations?.[id] ?? {})) if (v !== null && coerceValue(v, type) === undefined) lost++
  }
  return lost
}

export function setDefType(scope: DefScope, id: string, type: PropertyType): void {
  edit('Change type', (p) => {
    if (scope.kind === 'template') return changePropertyType(p, scope.templateId, id, type)
    const def = defsOf(p, scope)?.[id]
    if (!def || def.type === type) return
    def.type = type
    if (type === 'enum') def.options = def.options ?? {}
    else delete def.options
    if (type !== 'reference') delete def.referenceTemplateId
    if (type !== 'number') {
      delete def.min
      delete def.max
      delete def.integer
    }
    if (def.defaultValue !== undefined) {
      const c = coerceValue(def.defaultValue, type)
      if (c === undefined) delete def.defaultValue
      else def.defaultValue = c
    }
    if (scope.kind === 'relationship') {
      for (const e of Object.values(p.entities)) {
        const values = e.relations?.[id]
        if (!values) continue
        for (const [target, v] of Object.entries(values)) {
          const c = coerceValue(v, type)
          if (c === undefined) delete values[target]
          else values[target] = c
        }
      }
    }
  })
}

export function setPropertyType(templateId: string, propertyId: string, type: PropertyType): void {
  setDefType({ kind: 'template', templateId }, propertyId, type)
}

export function removeDef(scope: DefScope, id: string): void {
  edit('Delete definition', (p) => {
    if (scope.kind === 'template') removePropertyMutation(p, scope.templateId, id)
    else if (scope.kind === 'relationship') deleteRelationship(p, id)
    else delete p.state.variables[id]
  })
}

export function removeProperty(templateId: string, propertyId: string): void {
  removeDef({ kind: 'template', templateId }, propertyId)
}

/** Persist a new order (ids top to bottom). Only changed orders are written. */
export function reorderDefs(scope: DefScope, orderedIds: string[]): void {
  edit('Reorder', (p) => {
    const defs = defsOf(p, scope)
    if (!defs) return
    orderedIds.forEach((id, index) => {
      if (defs[id] && defs[id].order !== index) defs[id].order = index
    })
  })
}

export function reorderProperties(templateId: string, orderedIds: string[]): void {
  reorderDefs({ kind: 'template', templateId }, orderedIds)
}

export function addEnumOption(scopeOrTemplate: DefScope | string, defId: string, label: string): string | null {
  const scope = typeof scopeOrTemplate === 'string' ? ({ kind: 'template', templateId: scopeOrTemplate } as const) : scopeOrTemplate
  const trimmed = label.trim()
  if (!trimmed) return null
  const id = newId()
  const ok = edit('Add option', (p) => {
    const def = defsOf(p, scope)?.[defId]
    if (!def || def.type !== 'enum') return
    def.options = def.options ?? {}
    def.options[id] = { id, label: trimmed, order: nextOrder(Object.values(def.options)) }
  })
  return ok ? id : null
}

export function renameEnumOption(scope: DefScope, defId: string, optionId: string, label: string): void {
  const trimmed = label.trim()
  if (!trimmed) return
  edit('Rename option', (p) => {
    const option = defsOf(p, scope)?.[defId]?.options?.[optionId]
    if (option && option.label !== trimmed) option.label = trimmed
  })
}

export function removeEnumOption(scope: DefScope, defId: string, optionId: string): void {
  edit('Delete option', (p) => {
    if (scope.kind === 'template') return removeEnumOptionMutation(p, scope.templateId, defId, optionId)
    const def = defsOf(p, scope)?.[defId]
    if (!def?.options) return
    delete def.options[optionId]
    if (def.defaultValue === optionId) delete def.defaultValue
    if (scope.kind === 'relationship') {
      for (const e of Object.values(p.entities)) {
        const values = e.relations?.[defId]
        if (!values) continue
        for (const [t, v] of Object.entries(values)) if (v === optionId) delete values[t]
      }
    }
  })
}

export function reorderEnumOptions(scope: DefScope, defId: string, orderedIds: string[]): void {
  edit('Reorder options', (p) => {
    const options = defsOf(p, scope)?.[defId]?.options
    if (!options) return
    orderedIds.forEach((id, index) => {
      if (options[id] && options[id].order !== index) options[id].order = index
    })
  })
}

// ---------------------------------------------------------------------------
// State: world variables, relationships, time, rules

export function addStateVariable(namespace: string, type: PropertyType): string | null {
  const id = newId()
  const ok = edit('Add variable', (p) => {
    const all = Object.values(p.state.variables)
    const { name, technicalName } = newDefName(all.filter((v) => v.namespace === namespace), type)
    p.state.variables[id] = makeStateVariable(id, namespace, name, technicalName, type, nextOrder(all))
  })
  return ok ? id : null
}

export function addRelationship(fromTemplateId: string, toTemplateId: string, type: PropertyType): string | null {
  const id = newId()
  const ok = edit('Add relationship', (p) => {
    const all = Object.values(p.state.relationships)
    const pair = all.filter((r) => r.fromTemplateId === fromTemplateId && r.toTemplateId === toTemplateId)
    const base = type === 'number' ? 'Trust' : type === 'boolean' ? 'Knows' : type === 'enum' ? 'Attitude' : 'Note'
    const takenNames = new Set(pair.map((r) => r.name.toLowerCase()))
    let name = base
    for (let i = 2; takenNames.has(name.toLowerCase()); i++) name = `${base} ${i}`
    const technicalName = uniqueTechnicalName(toTechnicalName(name), pair.map((r) => r.technicalName))
    const rel = makeRelationship(id, name, technicalName, fromTemplateId, toTemplateId, type, nextOrder(all))
    if (type === 'number') Object.assign(rel, { min: -5, max: 5, integer: true, defaultValue: 0 })
    p.state.relationships[id] = rel
  })
  return ok ? id : null
}

/** Set a relationship's starting value from one entity to another (null value = reset to default). */
export function setRelationValue(fromEntityId: string, relId: string, toEntityId: string, value: PropertyValue | undefined): void {
  edit(value === undefined ? 'Reset relationship' : 'Edit relationship', (p) => {
    const e = p.entities[fromEntityId]
    if (!e) return
    if (value === undefined) {
      if (!e.relations?.[relId] || !(toEntityId in e.relations[relId])) return
      delete e.relations[relId][toEntityId]
      if (Object.keys(e.relations[relId]).length === 0) delete e.relations[relId]
      if (Object.keys(e.relations).length === 0) delete e.relations
      return
    }
    e.relations = e.relations ?? {}
    e.relations[relId] = e.relations[relId] ?? {}
    if (e.relations[relId][toEntityId] !== value) e.relations[relId][toEntityId] = value
  })
}

export function addPhase(label: string): string | null {
  const trimmed = label.trim()
  if (!trimmed) return null
  const id = newId()
  const ok = edit('Add time phase', (p) => {
    const phases = Object.values(p.state.time.phases)
    const technicalName = uniqueTechnicalName(toTechnicalName(trimmed), phases.map((x) => x.technicalName))
    p.state.time.phases[id] = makePhase(id, trimmed, technicalName, nextOrder(phases))
    if (!p.state.time.startPhaseId) p.state.time.startPhaseId = id
  })
  return ok ? id : null
}

export function renamePhase(id: string, label: string): void {
  const trimmed = label.trim()
  if (!trimmed) return
  edit('Rename time phase', (p) => {
    const phase = p.state.time.phases[id]
    if (!phase || phase.label === trimmed) return
    if (isDerivedTechnicalName(phase.technicalName, phase.label)) {
      const taken = Object.values(p.state.time.phases)
        .filter((x) => x.id !== id)
        .map((x) => x.technicalName)
      phase.technicalName = uniqueTechnicalName(toTechnicalName(trimmed), taken)
    }
    phase.label = trimmed
  })
}

export function removePhase(id: string): void {
  edit('Delete time phase', (p) => deletePhase(p, id))
}

export function reorderPhases(orderedIds: string[]): void {
  edit('Reorder time phases', (p) => {
    orderedIds.forEach((id, index) => {
      const phase = p.state.time.phases[id]
      if (phase && phase.order !== index) phase.order = index
    })
  })
}

export function setTimeStart(patch: { startDay?: number; startPhaseId?: string | null }): void {
  edit('Edit starting time', (p) => {
    const time = p.state.time
    if (patch.startDay !== undefined && Number.isInteger(patch.startDay) && time.startDay !== patch.startDay) time.startDay = patch.startDay
    if (patch.startPhaseId !== undefined && time.startPhaseId !== patch.startPhaseId) time.startPhaseId = patch.startPhaseId
  })
}

/** The clock: a phase's length, when the day starts, when the game starts within its phase, speaking rate. */
export function setPhaseMinutes(id: string, minutes: number | null): void {
  edit('Edit phase length', (p) => {
    const phase = p.state.time.phases[id]
    if (!phase) return
    if (minutes === null || !(minutes > 0)) delete phase.minutes
    else if (phase.minutes !== minutes) phase.minutes = minutes
  })
}

export function setClock(patch: { dayStart?: number | null; startMinute?: number | null; speakingRate?: number | null }): void {
  edit('Edit clock', (p) => {
    const t = p.state.time as Record<string, unknown>
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue
      if (v === null || (k !== 'speakingRate' && v === 0)) delete t[k]
      else if (t[k] !== v) t[k] = v
    }
  })
}

export function addActivity(name: string, minutes: number): string | null {
  const trimmed = name.trim()
  if (!trimmed) return null
  const id = newId()
  const ok = edit('Add activity', (p) => {
    const t = p.state.time
    t.activities ??= {}
    t.activities[id] = { id, name: trimmed, minutes: Math.max(0, minutes), order: nextOrder(Object.values(t.activities)) }
  })
  return ok ? id : null
}

export function updateActivity(id: string, patch: { name?: string; minutes?: number }): void {
  edit('Edit activity', (p) => {
    const a = p.state.time.activities?.[id]
    if (!a) return
    if (patch.name !== undefined && patch.name.trim() && a.name !== patch.name.trim()) a.name = patch.name.trim()
    if (patch.minutes !== undefined && patch.minutes >= 0 && a.minutes !== patch.minutes) a.minutes = patch.minutes
  })
}

/** Delete an activity; nodes that used it lose it (and take no time unless they set their own). */
export function removeActivity(id: string): void {
  edit('Delete activity', (p) => {
    delete p.state.time.activities?.[id]
    if (p.state.time.activities && !Object.keys(p.state.time.activities).length) delete p.state.time.activities
    for (const f of Object.values(p.flows)) for (const n of Object.values(f.nodes)) if (n.data.activityId === id) delete n.data.activityId
  })
}

export function reorderActivities(orderedIds: string[]): void {
  edit('Reorder activities', (p) => {
    orderedIds.forEach((id, index) => {
      const a = p.state.time.activities?.[id]
      if (a && a.order !== index) a.order = index
    })
  })
}

export function addRule(): string | null {
  const id = newId()
  const ok = edit('Add rule', (p) => {
    const rules = Object.values(p.state.rules)
    p.state.rules[id] = makeRule(id, `Rule ${rules.length + 1}`, nextOrder(rules))
  })
  return ok ? id : null
}

export type RulePatch = Partial<Pick<Rule, 'name' | 'enabled' | 'trigger' | 'phaseId' | 'forEachTemplateId' | 'condition' | 'effects' | 'flowId'>>

export function updateRule(id: string, patch: RulePatch): void {
  edit('Edit rule', (p) => {
    const rule = p.state.rules[id] as Record<string, unknown> | undefined
    if (!rule) return
    for (const [k, v] of Object.entries(patch)) {
      // Clearing the flow scope removes the field, so unscoped rules stay as they were in the file.
      if (k === 'flowId' && v === null) delete rule.flowId
      else if (v !== undefined && rule[k] !== v) rule[k] = v
    }
  })
}

export function removeRule(id: string): void {
  edit('Delete rule', (p) => {
    delete p.state.rules[id]
  })
}

export function reorderRules(orderedIds: string[]): void {
  edit('Reorder rules', (p) => {
    orderedIds.forEach((id, index) => {
      const rule = p.state.rules[id]
      if (rule && rule.order !== index) rule.order = index
    })
  })
}

// ---------------------------------------------------------------------------
// Entities

export function updateEntityTechnicalName(id: string, technicalName: string): void {
  edit('Edit technical name', (p) => {
    const e = p.entities[id]
    if (!e || e.technicalName === technicalName) return
    applyRename(p, { kind: 'entity', from: e.technicalName, to: technicalName })
    e.technicalName = technicalName
  })
}

export function setEntityValue(entityId: string, propertyId: string, value: PropertyValue): void {
  edit('Edit value', (p) => {
    const e = p.entities[entityId]
    if (e && e.values[propertyId] !== value) e.values[propertyId] = value
  })
}

/** Remove the entity's own value so it inherits the template default again. */
export function resetEntityValue(entityId: string, propertyId: string): void {
  edit('Reset value', (p) => {
    const e = p.entities[entityId]
    if (e && propertyId in e.values) delete e.values[propertyId]
  })
}

// ---------------------------------------------------------------------------
// Line IDs

/** Set a flow's line prefix (null: made from its name). With `rename`, existing lines move to it too. */
export function setLinePrefix(flowId: string, prefix: string | null, rename: boolean): void {
  edit(rename ? 'Rename line IDs' : 'Edit line prefix', (p) => {
    const flow = p.flows[flowId]
    if (!flow) return
    if (prefix) flow.linePrefix = prefix
    else delete flow.linePrefix
    if (rename) reprefixLines(p as Project, flow)
  })
}

// ---------------------------------------------------------------------------
// Comments on nodes

/** Start a thread on a node, or reply to one (`parentId`: the thread's first comment). */
export function addComment(flowId: string, nodeId: string, text: string, author: string, parentId?: string): string | null {
  const body = text.trim()
  if (!body) return null
  const id = newId()
  const ok = edit(parentId ? 'Reply' : 'Comment', (p) => {
    const flow = p.flows[flowId]
    if (!flow?.nodes[nodeId]) return
    flow.comments = flow.comments ?? {}
    flow.comments[id] = { id, nodeId, author, text: body, createdAt: new Date().toISOString(), ...(parentId ? { parentId } : {}) }
  })
  return ok ? id : null
}

export function editComment(flowId: string, commentId: string, text: string): void {
  const body = text.trim()
  if (!body) return
  edit('Edit comment', (p) => {
    const c = p.flows[flowId]?.comments?.[commentId]
    if (c && c.text !== body) c.text = body
  })
}

/** Resolve or reopen a thread. */
export function resolveThread(flowId: string, rootId: string, resolved: boolean): void {
  edit(resolved ? 'Resolve comment' : 'Reopen comment', (p) => {
    const c = p.flows[flowId]?.comments?.[rootId]
    if (!c) return
    if (resolved) c.resolved = true
    else delete c.resolved
  })
}

/** Delete a comment; deleting a thread's first comment deletes its replies too. */
export function deleteComment(flowId: string, commentId: string): void {
  edit('Delete comment', (p) => {
    const flow = p.flows[flowId]
    if (!flow?.comments?.[commentId]) return
    for (const c of Object.values(flow.comments)) if (c.parentId === commentId) delete flow.comments[c.id]
    delete flow.comments[commentId]
    if (Object.keys(flow.comments).length === 0) delete flow.comments
  })
}

// ---------------------------------------------------------------------------
// Scenarios and story tests

export type ScenarioPatch = Partial<Pick<Scenario, 'name' | 'day' | 'phaseId' | 'seed' | 'setup'>>

/** Save a new scenario. Fields left undefined start from the project's own starting state. */
export function addScenario(fields: ScenarioPatch & { name: string }): string | null {
  const id = newId()
  const ok = edit('Save scenario', (p) => {
    const list = Object.values(p.scenarios ?? {})
    p.scenarios = p.scenarios ?? {}
    p.scenarios[id] = { id, order: nextOrder(list), setup: '', ...clean(fields), name: fields.name }
  })
  return ok ? id : null
}

/** `undefined` leaves a field alone; `null` for day, phase or seed goes back to the project's own. */
export function updateScenario(id: string, patch: { [K in keyof ScenarioPatch]?: ScenarioPatch[K] | null }): void {
  edit('Edit scenario', (p) => {
    const sc = p.scenarios?.[id] as Record<string, unknown> | undefined
    if (!sc) return
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue
      if (v === null) delete sc[k]
      else if (sc[k] !== v) sc[k] = v
    }
  })
}

/** Delete a scenario. Tests that start from it are reported as broken until they're pointed elsewhere. */
export function removeScenario(id: string): void {
  edit('Delete scenario', (p) => {
    if (!p.scenarios?.[id]) return
    delete p.scenarios[id]
    if (Object.keys(p.scenarios).length === 0) delete p.scenarios
  })
}

export type TestFields = Omit<StoryTest, 'id' | 'order'>

export function addTest(fields: TestFields): string | null {
  const id = newId()
  const ok = edit('Save test', (p) => {
    const list = Object.values(p.tests ?? {})
    p.tests = p.tests ?? {}
    p.tests[id] = { ...clean(fields), id, order: nextOrder(list) } as StoryTest
  })
  return ok ? id : null
}

export type TestPatch = Partial<Pick<StoryTest, 'name' | 'scenarioId' | 'checks' | 'allEnd' | 'allReached' | 'reach' | 'route' | 'stopsAt' | 'ends'>>

export function updateTest(id: string, patch: TestPatch): void {
  edit('Edit test', (p) => {
    const t = p.tests?.[id] as Record<string, unknown> | undefined
    if (!t) return
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue
      // Off switches and empty lists leave the file, so tests stay small and diffs quiet.
      if ((k === 'allEnd' || k === 'allReached') && v === false) delete t[k]
      else if (k === 'reach' && Array.isArray(v)) {
        if (v.length) t[k] = [...v].sort()
        else delete t[k]
      } else t[k] = v
    }
  })
}

export function removeTest(id: string): void {
  edit('Delete test', (p) => {
    if (!p.tests?.[id]) return
    delete p.tests[id]
    if (Object.keys(p.tests).length === 0) delete p.tests
  })
}

/** Drop undefined fields, so they're absent from the file rather than stored. */
function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

// ---------------------------------------------------------------------------
// Read helpers

export function sortedProperties(template: Template): PropertyDef[] {
  return Object.values(template.properties).sort(compareOrder)
}
