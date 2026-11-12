import { compile, type StateRef } from './expr/check'
import { FIELD_LABELS, forEachSite, siteOwnerId, TEXT_FIELDS } from './expr/sites'
import { parseTemplate } from './expr/template'
import { analyzeFlow } from './flowAnalysis'
import { dataRef, dataString } from './nodes'
import type { Project } from './schema'
import { TECHNICAL_NAME_RE } from './technicalName'
import { clockOf, formatDuration, MINUTES_PER_DAY } from './time'
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
  /** A flow's summary of its nodes' issues (for its badge); the issues themselves are listed on the nodes. */
  summary?: true
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
  for (const def of [...vars, ...rels]) {
    if (def.type !== 'number') continue
    if (def.min !== undefined && def.max !== undefined && def.min > def.max) add(def.id, { level: 'warning', message: `“${def.name}”: minimum is above maximum.` })
    if (def.defaultValue !== undefined) {
      const problem = ruleValueProblem(project, def, def.defaultValue)
      if (problem) add(def.id, { level: 'warning', message: `“${def.name}”: the starting value ${problem}.` })
    }
  }
  for (const entity of Object.values(project.entities)) {
    for (const [relId, targets] of Object.entries(entity.relations ?? {})) {
      const rel = project.state.relationships[relId]
      if (!rel) continue
      for (const [toId, value] of Object.entries(targets)) {
        const problem = ruleValueProblem(project, rel, value)
        const to = project.entities[toId]?.name ?? 'another entity'
        if (problem) add(entity.id, { level: 'warning', message: `${rel.name} toward ${to} ${problem}.` })
      }
    }
  }
  const phases = Object.values(project.state.time.phases)
  if (phases.length === 0) add('state:time', { level: 'warning', message: 'No time phases: time can’t advance.' })
  else {
    const day = clockOf(project).lengths.reduce((n, m) => n + m, 0)
    if (Math.round(day) !== MINUTES_PER_DAY)
      add('state:time', { level: 'warning', message: `The phases add up to ${formatDuration(day)}, not 24h, so Time.Hour drifts a little each day.` })
  }
  for (const a of Object.values(project.state.time.activities ?? {})) {
    if (!a.name.trim()) add('state:time', { level: 'warning', message: 'An activity has no name.' })
  }
  checkTechnicalNames(phases.map((p) => ({ ownerId: p.id, name: p.label, technicalName: p.technicalName })), add)

  // --- Expressions ----------------------------------------------------------
  // Numbers that actions push both up and down ("meters") should have a range.
  const raised = new Set<string>()
  const lowered = new Set<string>()
  forEachSite(project, (site) => {
    const result = compile(project, site.source, site.mode, site.ctx)
    for (const a of result.actions) {
      if (a.k !== 'set' || a.op === '=') continue
      const id = meterId(project, a.ref, site.ctx.selfTemplateId ?? null)
      if (id) (a.op === '+=' ? raised : lowered).add(id)
    }
    const ownerId = siteOwnerId(site.owner)
    for (const d of result.diagnostics) {
      add(ownerId, { level: d.level, field: site.field, message: `${FIELD_LABELS[site.field] ?? site.field}: ${d.message}` })
    }
  })

  for (const id of raised) {
    if (!lowered.has(id)) continue
    const [kind, ownerId, propId] = id.split('|')
    const def =
      kind === 'prop' ? project.templates[ownerId]?.properties[propId] : kind === 'var' ? project.state.variables[ownerId] : project.state.relationships[ownerId]
    if (!def || def.type !== 'number' || def.min !== undefined || def.max !== undefined) continue
    add(ownerId, {
      level: 'warning',
      ...(kind === 'prop' ? { propertyId: propId } : {}),
      message: `“${def.name}” goes up and down (+= and -=) but has no minimum or maximum, so it can drift past what your conditions test. Set a range; Explore shows where it ends up.`
    })
  }

  // Braces in lines that don't make a placeholder (`{` with no `}`).
  for (const flow of Object.values(project.flows)) {
    for (const node of Object.values(flow.nodes)) {
      if (node.type !== 'dialogue') continue
      for (const field of TEXT_FIELDS) {
        const text = node.data[field]
        if (typeof text !== 'string' || !/[{}]/.test(text)) continue
        for (const p of parseTemplate(text).problems) add(node.id, { level: 'error', field, message: `${FIELD_LABELS[field]}: ${p.message}` })
      }
    }
  }

  // Node tags (Seen.Tag / Visits.Tag) are project-wide names.
  const tagOwners = new Map<string, string[]>()
  for (const flow of Object.values(project.flows)) {
    for (const n of Object.values(flow.nodes)) {
      const tag = n.data.tag
      if (typeof tag !== 'string' || !tag) continue
      tagOwners.set(tag, [...(tagOwners.get(tag) ?? []), n.id])
    }
  }

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
      if (n.type === 'jump' && dataRef(n, 'targetFlowId') && !project.flows[dataRef(n, 'targetFlowId') as string]) {
        node(n.id, { level: 'error', message: 'The flow this jump continues in no longer exists.' })
      }
      if (n.type === 'call') {
        const callee = dataRef(n, 'flowId')
        if (!callee) node(n.id, { level: 'warning', message: 'No flow chosen to play.' })
        else if (!project.flows[callee]) node(n.id, { level: 'error', message: 'The flow it plays no longer exists.' })
        else if (callee === flow.id) node(n.id, { level: 'warning', message: 'Plays its own flow: make sure the repeat has a way out.' })
      }
      if (n.type === 'jump' && a.brokenJumps.has(n.id)) {
        node(n.id, { level: 'error', message: dataRef(n, 'targetId') ? 'Jump target is not in this flow.' : 'Jump has no target.' })
      }
      if (n.type === 'condition' && !dataString(n, 'expression').trim()) {
        node(n.id, { level: 'warning', message: 'Condition has no expression yet.' })
      }
      const tag = dataString(n, 'tag')
      if (tag && !TECHNICAL_NAME_RE.test(tag)) {
        node(n.id, { level: 'error', message: `Tag “${tag}” can only use letters, digits and _, and can't start with a digit.` })
      } else if (tag && (tagOwners.get(tag)?.length ?? 0) > 1) {
        node(n.id, { level: 'error', message: `Tag “${tag}” is used by ${tagOwners.get(tag)!.length} nodes; Seen.${tag} needs it to be unique.` })
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
        message: `${errors + warnings} issue${errors + warnings === 1 ? '' : 's'} in nodes.`,
        summary: true
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

/** A number definition an action changes: "var|<id>", "rel|<id>" or "prop|<template id>|<property id>". */
function meterId(project: Project, ref: StateRef, selfTemplateId: string | null): string | null {
  if (ref.kind === 'world') return `var|${ref.varId}`
  if (ref.kind === 'rel') return `rel|${ref.relId}`
  if (ref.kind === 'prop') {
    const templateId = project.entities[ref.entity]?.templateId ?? (ref.entity === 'self' ? selfTemplateId : null)
    return templateId ? `prop|${templateId}|${ref.propId}` : null
  }
  return null
}
