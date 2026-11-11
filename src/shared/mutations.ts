import type { Flow, Project, PropertyType, TreeItem } from './schema'
import { coerceValue } from './values'

/**
 * Pure, in-place mutations that keep the project referentially consistent.
 * They work on plain objects and on Immer drafts alike, and are shared by the
 * editor and the tests.
 */

/** The folder and every folder beneath it. */
export function collectFolderSubtree(project: Pick<Project, 'folders'>, rootId: string): Set<string> {
  const result = new Set<string>([rootId])
  const queue = [rootId]
  const all = Object.values(project.folders)
  while (queue.length) {
    const current = queue.shift() as string
    for (const f of all) {
      if (f.parentId === current && !result.has(f.id)) {
        result.add(f.id)
        queue.push(f.id)
      }
    }
  }
  return result
}

/** Entities whose reference properties point at `entityId`. */
export function findEntityReferences(
  project: Project,
  entityId: string
): Array<{ entityId: string; propertyId: string }> {
  const refs: Array<{ entityId: string; propertyId: string }> = []
  for (const entity of Object.values(project.entities)) {
    const template = project.templates[entity.templateId]
    if (!template) continue
    for (const [propertyId, value] of Object.entries(entity.values)) {
      if (value === entityId && template.properties[propertyId]?.type === 'reference') {
        refs.push({ entityId: entity.id, propertyId })
      }
    }
  }
  return refs
}

/** Delete entities and clear every reference to them. */
export function deleteEntities(project: Project, ids: Iterable<string>): void {
  const doomed = new Set(ids)
  if (doomed.size === 0) return
  for (const id of doomed) delete project.entities[id]
  for (const entity of Object.values(project.entities)) {
    const template = project.templates[entity.templateId]
    for (const [propertyId, value] of Object.entries(entity.values)) {
      const isReference = template ? template.properties[propertyId]?.type === 'reference' : true
      if (isReference && typeof value === 'string' && doomed.has(value)) delete entity.values[propertyId]
    }
  }
  for (const template of Object.values(project.templates)) {
    for (const prop of Object.values(template.properties)) {
      if (prop.type === 'reference' && typeof prop.defaultValue === 'string' && doomed.has(prop.defaultValue)) {
        delete prop.defaultValue
      }
    }
  }
  for (const flow of Object.values(project.flows)) {
    for (const node of Object.values(flow.nodes)) {
      if (typeof node.data.speakerId === 'string' && doomed.has(node.data.speakerId)) delete node.data.speakerId
    }
  }
  for (const entity of Object.values(project.entities)) {
    if (!entity.relations) continue
    for (const [relId, targets] of Object.entries(entity.relations)) {
      for (const targetId of Object.keys(targets)) if (doomed.has(targetId)) delete targets[targetId]
      if (Object.keys(targets).length === 0) delete entity.relations[relId]
    }
    if (Object.keys(entity.relations).length === 0) delete entity.relations
  }
  for (const v of Object.values(project.state.variables)) {
    if (v.type === 'reference' && typeof v.defaultValue === 'string' && doomed.has(v.defaultValue)) delete v.defaultValue
  }
}

/** Dialogue lines spoken by an entity. */
export function findSpeakerLines(project: Project, entityId: string): Array<{ flowId: string; nodeId: string }> {
  const lines: Array<{ flowId: string; nodeId: string }> = []
  for (const flow of Object.values(project.flows)) {
    for (const node of Object.values(flow.nodes)) {
      if (node.data.speakerId === entityId) lines.push({ flowId: flow.id, nodeId: node.id })
    }
  }
  return lines
}

/** Delete nodes and edges from a flow, with every edge and jump that pointed at a deleted node. */
export function deleteFlowElements(flow: Flow, nodeIds: Iterable<string>, edgeIds: Iterable<string> = []): void {
  const nodes = new Set(nodeIds)
  for (const id of nodes) delete flow.nodes[id]
  for (const id of edgeIds) delete flow.edges[id]
  for (const [id, edge] of Object.entries(flow.edges)) {
    if (nodes.has(edge.source) || nodes.has(edge.target)) delete flow.edges[id]
  }
  for (const node of Object.values(flow.nodes)) {
    if (typeof node.data.targetId === 'string' && nodes.has(node.data.targetId)) delete node.data.targetId
  }
}

/** Entities that are instances of any of the given templates. */
export function instancesOf(project: Project, templateIds: Set<string>): string[] {
  return Object.values(project.entities)
    .filter((e) => templateIds.has(e.templateId))
    .map((e) => e.id)
}

/** Delete templates, their instances, and any reference filters that pointed at them. */
export function deleteTemplates(project: Project, ids: Iterable<string>): void {
  const doomed = new Set(ids)
  if (doomed.size === 0) return
  deleteEntities(project, instancesOf(project, doomed))
  for (const id of doomed) delete project.templates[id]
  for (const template of Object.values(project.templates)) {
    for (const prop of Object.values(template.properties)) {
      if (prop.referenceTemplateId && doomed.has(prop.referenceTemplateId)) prop.referenceTemplateId = null
    }
  }
  const state = project.state
  for (const rel of Object.values(state.relationships)) {
    if (doomed.has(rel.fromTemplateId) || doomed.has(rel.toTemplateId)) deleteRelationship(project, rel.id)
  }
  for (const v of Object.values(state.variables)) {
    if (v.referenceTemplateId && doomed.has(v.referenceTemplateId)) v.referenceTemplateId = null
  }
  for (const rule of Object.values(state.rules)) {
    if (rule.forEachTemplateId && doomed.has(rule.forEachTemplateId)) rule.forEachTemplateId = null
  }
}

/** Remove a relationship definition and every starting value set for it. */
export function deleteRelationship(project: Project, relId: string): void {
  delete project.state.relationships[relId]
  for (const entity of Object.values(project.entities)) {
    if (entity.relations?.[relId]) {
      delete entity.relations[relId]
      if (Object.keys(entity.relations).length === 0) delete entity.relations
    }
  }
}

/** Remove a time phase; rules tied to it run every phase, and the start moves to the first phase. */
export function deletePhase(project: Project, phaseId: string): void {
  const time = project.state.time
  delete time.phases[phaseId]
  for (const rule of Object.values(project.state.rules)) if (rule.phaseId === phaseId) rule.phaseId = null
  if (time.startPhaseId === phaseId) {
    time.startPhaseId = Object.values(time.phases).sort((a, b) => a.order - b.order)[0]?.id ?? null
  }
}

/** Delete a folder, everything inside it, and everything that depended on that. Returns all removed ids. */
export function deleteFolderTree(project: Project, rootId: string): Set<string> {
  const folders = collectFolderSubtree(project, rootId)
  const removed = new Set<string>(folders)
  const inside = (item: TreeItem) => item.folderId !== null && folders.has(item.folderId)

  for (const flow of Object.values(project.flows)) {
    if (inside(flow)) {
      removed.add(flow.id)
      delete project.flows[flow.id]
    }
  }
  deleteTestsOfFlows(project, removed)
  const templateIds = Object.values(project.templates).filter(inside).map((t) => t.id)
  const entityIds = [
    ...Object.values(project.entities).filter(inside).map((e) => e.id),
    ...instancesOf(project, new Set(templateIds))
  ]
  for (const id of [...templateIds, ...entityIds]) removed.add(id)
  deleteEntities(project, entityIds)
  deleteTemplates(project, templateIds)
  for (const id of folders) delete project.folders[id]
  return removed
}

/** Story tests of flows that are being deleted go with them (a test can't outlive its flow). */
export function deleteTestsOfFlows(project: Project, flowIds: ReadonlySet<string>): number {
  let n = 0
  for (const t of Object.values(project.tests ?? {})) {
    if (!flowIds.has(t.flowId)) continue
    delete project.tests![t.id]
    n++
  }
  if (project.tests && Object.keys(project.tests).length === 0) delete project.tests
  return n
}

/** Remove a property and every entity value set for it. */
export function removeProperty(project: Project, templateId: string, propertyId: string): void {
  const template = project.templates[templateId]
  if (!template) return
  delete template.properties[propertyId]
  for (const entity of Object.values(project.entities)) {
    if (entity.templateId === templateId) delete entity.values[propertyId]
  }
}

/** How many entity values would be lost if the property changed to `type`. */
export function countLossOnTypeChange(project: Project, templateId: string, propertyId: string, type: PropertyType): number {
  let lost = 0
  for (const entity of Object.values(project.entities)) {
    if (entity.templateId !== templateId) continue
    const v = entity.values[propertyId]
    if (v !== undefined && v !== null && coerceValue(v, type) === undefined) lost++
  }
  return lost
}

/** Change a property's type, converting values where possible and dropping the rest. */
export function changePropertyType(project: Project, templateId: string, propertyId: string, type: PropertyType): void {
  const template = project.templates[templateId]
  const prop = template?.properties[propertyId]
  if (!template || !prop || prop.type === type) return
  prop.type = type

  if (type === 'enum') prop.options = prop.options ?? {}
  else delete prop.options
  if (type !== 'reference') delete prop.referenceTemplateId
  if (type !== 'number') {
    delete prop.min
    delete prop.max
    delete prop.integer
  }

  if (prop.defaultValue !== undefined) {
    const converted = coerceValue(prop.defaultValue, type)
    if (converted === undefined) delete prop.defaultValue
    else prop.defaultValue = converted
  }
  for (const entity of Object.values(project.entities)) {
    if (entity.templateId !== templateId) continue
    const v = entity.values[propertyId]
    if (v === undefined) continue
    const converted = coerceValue(v, type)
    if (converted === undefined) delete entity.values[propertyId]
    else entity.values[propertyId] = converted
  }
}

/** Remove an enum option; entities and defaults that used it fall back to "none". */
export function removeEnumOption(project: Project, templateId: string, propertyId: string, optionId: string): void {
  const template = project.templates[templateId]
  const prop = template?.properties[propertyId]
  if (!template || !prop?.options) return
  delete prop.options[optionId]
  if (prop.defaultValue === optionId) delete prop.defaultValue
  for (const entity of Object.values(project.entities)) {
    if (entity.templateId === templateId && entity.values[propertyId] === optionId) delete entity.values[propertyId]
  }
}
