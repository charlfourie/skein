import { compile } from './expr/check'
import { FIELD_LABELS, forEachSite } from './expr/sites'
import { analyzeFlow } from './flowAnalysis'
import { dataRef, dataString } from './nodes'
import type { Project } from './schema'
import { TECHNICAL_NAME_RE } from './technicalName'
import { ruleValueProblem, structuralValueProblem } from './values'

/**
 * Live validation: problems the designer should see but that don't stop the
 * project from loading or saving. (Things that would corrupt data are repaired
 * on load instead, in parse.ts.) Phase 3 adds flow checks here.
 */

export type IssueLevel = 'error' | 'warning'

export interface Issue {
  level: IssueLevel
  message: string
  /** The property the issue concerns, for template and entity issues. */
  propertyId?: string
  /** The field the issue concerns, e.g. "technicalName". */
  field?: string
}

export type IssueMap = Map<string, Issue[]>

const cache = new WeakMap<Project, IssueMap>()

export function validateProject(project: Project): IssueMap {
  const cached = cache.get(project)
  if (cached) return cached

  const issues: IssueMap = new Map()
  const add = (id: string, issue: Issue) => {
    const list = issues.get(id)
    if (list) list.push(issue)
    else issues.set(id, [issue])
  }

  checkTechnicalNames(
    Object.values(project.templates).map((t) => ({ ownerId: t.id, name: t.name, technicalName: t.technicalName })),
    add
  )
  checkTechnicalNames(
    Object.values(project.entities).map((e) => ({ ownerId: e.id, name: e.name, technicalName: e.technicalName })),
    add
  )

  for (const template of Object.values(project.templates)) {
    const props = Object.values(template.properties)
    checkTechnicalNames(
      props.map((p) => ({ ownerId: template.id, propertyId: p.id, name: p.name, technicalName: p.technicalName })),
      add
    )
    for (const prop of props) {
      if (prop.type === 'enum' && Object.keys(prop.options ?? {}).length === 0) {
        add(template.id, { level: 'warning', propertyId: prop.id, message: `“${prop.name}” has no options yet.` })
      }
      if (prop.type === 'number' && prop.min !== undefined && prop.max !== undefined && prop.min > prop.max) {
        add(template.id, { level: 'warning', propertyId: prop.id, message: `“${prop.name}”: minimum is above maximum.` })
      }
      if (prop.defaultValue !== undefined) {
        const problem =
          structuralValueProblem(project, prop, prop.defaultValue) ?? ruleValueProblem(project, prop, prop.defaultValue)
        if (problem) add(template.id, { level: 'warning', propertyId: prop.id, message: `Default ${problem}.` })
      }
    }
  }

  for (const entity of Object.values(project.entities)) {
    const template = project.templates[entity.templateId]
    if (!template) {
      add(entity.id, { level: 'error', message: 'Its template no longer exists.' })
      continue
    }
    for (const [propertyId, value] of Object.entries(entity.values)) {
      const prop = template.properties[propertyId]
      if (!prop) continue
      const problem = ruleValueProblem(project, prop, value)
      if (problem) add(entity.id, { level: 'warning', propertyId, message: `“${prop.name}” ${problem}.` })
    }
  }

  // --- State definitions ---------------------------------------------------
  const vars = Object.values(project.state.variables)
  const entityNames = new Set(Object.values(project.entities).map((e) => e.technicalName))
  for (const v of vars) {
    if (!TECHNICAL_NAME_RE.test(v.namespace)) {
      add(v.id, { level: 'error', field: 'namespace', message: 'Namespace must start with a letter or _ and use only letters, digits and _.' })
    } else if (v.namespace === 'Time' || v.namespace === 'self') {
      add(v.id, { level: 'error', field: 'namespace', message: `“${v.namespace}” is reserved.` })
    } else if (entityNames.has(v.namespace)) {
      add(v.id, { level: 'warning', field: 'namespace', message: `An entity is also called “${v.namespace}”; in expressions the namespace wins and hides that entity.` })
    }
  }
  const byNamespace = new Map<string, typeof vars>()
  for (const v of vars) byNamespace.set(v.namespace, [...(byNamespace.get(v.namespace) ?? []), v])
  for (const group of byNamespace.values()) {
    checkTechnicalNames(group.map((v) => ({ ownerId: v.id, name: v.name, technicalName: v.technicalName })), add)
  }
  const rels = Object.values(project.state.relationships)
  const byPair = new Map<string, typeof rels>()
  for (const r of rels) byPair.set(`${r.fromTemplateId}>${r.toTemplateId}`, [...(byPair.get(`${r.fromTemplateId}>${r.toTemplateId}`) ?? []), r])
  for (const group of byPair.values()) {
    checkTechnicalNames(group.map((r) => ({ ownerId: r.id, name: r.name, technicalName: r.technicalName })), add)
  }
  for (const def of [...vars, ...rels]) {
    if (def.type === 'enum' && Object.keys(def.options ?? {}).length === 0) add(def.id, { level: 'warning', message: `“${def.name}” has no options yet.` })
  }
  const phases = Object.values(project.state.time.phases)
  if (phases.length === 0) add('state:time', { level: 'warning', message: 'No time phases: time can’t advance.' })
  checkTechnicalNames(phases.map((p) => ({ ownerId: p.id, name: p.label, technicalName: p.technicalName })), add)

  // --- Expressions ----------------------------------------------------------
  forEachSite(project, (site) => {
    const result = compile(project, site.source, site.mode, site.ctx)
    const ownerId = site.owner.kind === 'node' ? site.owner.nodeId : site.owner.ruleId
    for (const d of result.diagnostics) {
      add(ownerId, { level: d.level, field: site.field, message: `${FIELD_LABELS[site.field] ?? site.field}: ${d.message}` })
    }
  })

  for (const flow of Object.values(project.flows)) {
    const nodes = Object.values(flow.nodes)
    if (nodes.length === 0) continue
    const a = analyzeFlow(flow)
    let warnings = 0
    let errors = 0
    const node = (id: string, issue: Issue) => {
      add(id, issue)
      if (issue.level === 'error') errors++
      else warnings++
    }
    for (const n of nodes) {
      if (a.orphans.has(n.id)) node(n.id, { level: 'warning', message: 'Orphan: nothing leads here, and it isn’t marked as a start.' })
      if (a.deadEnds.has(n.id) && !a.brokenJumps.has(n.id)) {
        node(n.id, { level: 'warning', message: 'Dead end: nothing follows, and it isn’t marked as an end.' })
      }
      for (const branch of a.openBranches.get(n.id) ?? []) {
        node(n.id, { level: 'warning', message: `The “${branch}” branch isn’t connected.` })
      }
      if (n.type === 'jump' && a.brokenJumps.has(n.id)) {
        node(n.id, { level: 'error', message: dataRef(n, 'targetId') ? 'Jump target is not in this flow.' : 'Jump has no target.' })
      }
      if (n.type === 'condition' && !dataString(n, 'expression').trim()) {
        node(n.id, { level: 'warning', message: 'Condition has no expression yet.' })
      }
    }
    if (a.startNodes.length === 0) add(flow.id, { level: 'warning', message: 'No start node: mark where this flow begins.' })
    // Roll up everything on this flow's nodes, including expression problems found above.
    errors = 0
    warnings = 0
    for (const n of nodes) for (const i of issues.get(n.id) ?? []) i.level === 'error' ? errors++ : warnings++
    if (errors || warnings) {
      add(flow.id, {
        level: errors ? 'error' : 'warning',
        message: `${errors + warnings} issue${errors + warnings === 1 ? '' : 's'} in nodes.`
      })
    }
  }

  cache.set(project, issues)
  return issues
}

interface Named {
  ownerId: string
  propertyId?: string
  name: string
  technicalName: string
}

function checkTechnicalNames(items: Named[], add: (id: string, issue: Issue) => void): void {
  const byName = new Map<string, Named[]>()
  for (const item of items) {
    const base = { propertyId: item.propertyId, field: 'technicalName' }
    const label = item.propertyId ? `“${item.name}”: technical name` : 'Technical name'
    if (!item.technicalName) {
      add(item.ownerId, { ...base, level: 'error', message: `${label} is empty.` })
      continue
    }
    if (!TECHNICAL_NAME_RE.test(item.technicalName)) {
      add(item.ownerId, {
        ...base,
        level: 'error',
        message: `${label} must start with a letter or _ and use only letters, digits and _.`
      })
    }
    const key = item.technicalName.toLowerCase()
    const list = byName.get(key)
    if (list) list.push(item)
    else byName.set(key, [item])
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue
    for (const item of group) {
      const others = group.filter((g) => g !== item).map((g) => `“${g.name}”`)
      const label = item.propertyId ? `“${item.name}”: technical name` : 'Technical name'
      add(item.ownerId, {
        level: 'error',
        propertyId: item.propertyId,
        field: 'technicalName',
        message: `${label} “${item.technicalName}” is also used by ${others.join(', ')}.`
      })
    }
  }
}

/** Highest severity in a list, for badges. */
export function worstLevel(list: Issue[] | undefined): IssueLevel | null {
  if (!list?.length) return null
  return list.some((i) => i.level === 'error') ? 'error' : 'warning'
}
