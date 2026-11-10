import { newId } from './ids'
import {
  PROJECT_FORMAT,
  SCHEMA_VERSION,
  type Entity,
  type Flow,
  type Folder,
  type Project,
  type ProjectState,
  type PropertyDef,
  type PropertyType,
  type RelationshipDef,
  type Rule,
  type SectionId,
  type StateVariable,
  type Template,
  type TimePhase
} from './schema'

export const DEFAULT_PHASES = ['Dawn', 'Day', 'Dusk', 'Night'] as const

export function createPhase(id: string, label: string, technicalName: string, order: number): TimePhase {
  return { id, label, technicalName, order }
}

/** A fresh state section: no variables or rules yet, and a four-phase day starting at Dawn of day 1. */
export function createDefaultState(): ProjectState {
  const phases: Record<string, TimePhase> = {}
  DEFAULT_PHASES.forEach((label, order) => {
    const id = newId()
    phases[id] = createPhase(id, label, label, order)
  })
  const first = Object.values(phases)[0]
  return { variables: {}, relationships: {}, time: { phases, startDay: 1, startPhaseId: first.id }, rules: {} }
}

export function createStateVariable(
  id: string,
  namespace: string,
  name: string,
  technicalName: string,
  type: PropertyType,
  order: number
): StateVariable {
  return { ...createProperty(id, name, technicalName, type, order), namespace }
}

export function createRelationship(
  id: string,
  name: string,
  technicalName: string,
  fromTemplateId: string,
  toTemplateId: string,
  type: PropertyType,
  order: number
): RelationshipDef {
  return { ...createProperty(id, name, technicalName, type, order), fromTemplateId, toTemplateId }
}

export function createRule(id: string, name: string, order: number): Rule {
  return {
    id,
    name,
    order,
    enabled: true,
    trigger: 'phase',
    phaseId: null,
    forEachTemplateId: null,
    condition: '',
    effects: ''
  }
}

/** Template colours, cycled through as new templates are created. */
export const TEMPLATE_COLORS = [
  '#818cf8',
  '#f472b6',
  '#34d399',
  '#fbbf24',
  '#60a5fa',
  '#f87171',
  '#c084fc',
  '#2dd4bf',
  '#fb923c',
  '#a3e635'
] as const

export function createTemplate(
  id: string,
  name: string,
  technicalName: string,
  folderId: string | null,
  order: number,
  color: string = TEMPLATE_COLORS[0],
  icon = 'box'
): Template {
  return { id, name, technicalName, folderId, order, description: '', color, icon, properties: {} }
}

export function createProperty(
  id: string,
  name: string,
  technicalName: string,
  type: PropertyType,
  order: number
): PropertyDef {
  const prop: PropertyDef = { id, name, technicalName, type, order, description: '' }
  if (type === 'enum') prop.options = {}
  return prop
}

export function createEntity(
  id: string,
  name: string,
  technicalName: string,
  templateId: string,
  folderId: string | null,
  order: number
): Entity {
  return { id, name, technicalName, templateId, folderId, order, values: {} }
}

export function createFlow(id: string, name: string, folderId: string | null, order: number): Flow {
  return { id, name, folderId, order, nodes: {}, edges: {} }
}

export function createFolder(
  id: string,
  name: string,
  section: SectionId,
  parentId: string | null,
  order: number
): Folder {
  return { id, name, section, parentId, order }
}

export function createEmptyProject(name = 'Untitled Project'): Project {
  const flowId = newId()
  return {
    format: PROJECT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    meta: {
      id: newId(),
      name,
      description: '',
      // Set once at creation; never rewritten (a per-save timestamp would conflict on every merge).
      createdAt: new Date().toISOString()
    },
    folders: {},
    flows: { [flowId]: createFlow(flowId, 'Main', null, 0) },
    templates: {},
    entities: {},
    state: createDefaultState()
  }
}
