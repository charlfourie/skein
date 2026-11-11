import { compile, nodeTag, type Bound, type BoundStatement, type CompileContext, type StateRef } from '../expr/check'
import { CONDITION_NODE_CTX } from '../expr/sites'
import { clockOf, nodeTakes, wholeSeconds } from '../time'
import { dataRef, dataString, isEndNode, isKnownNodeType, isStartNode } from '../nodes'
import { orderedTargets, startNodes } from '../flowOrder'
import type { Flow, FlowNode, Project, PropertyDef, PropertyValue } from '../schema'
import { serializeCanonical } from '../serialize'
import { toTechnicalName } from '../technicalName'
import { defaultOf, effectiveValue } from '../values'
import {
  EXPORT_FORMAT,
  type ExportCondition,
  type ExportDef,
  type ExportEffects,
  type ExportEntity,
  type ExportFile,
  type ExportFlow,
  type ExportNode,
  type ExportRelationship,
  type ExportRule,
  type ExportTemplate,
  type ExportValue,
  type ExprNode,
  type StatePath,
  type Statement
} from './types'

export interface ExportOptions {
  /** Keep each expression's source text next to its compiled form (handy for debugging). Default true. */
  includeSource?: boolean
}

export interface ExportProblem {
  level: 'error' | 'warning'
  message: string
  /** Where in the project, for the UI to link to. */
  at?: { kind: 'node'; flowId: string; nodeId: string } | { kind: 'rule'; ruleId: string }
}

export interface ExportResult {
  file: ExportFile
  problems: ExportProblem[]
}

/**
 * Build the game-ready export. Pure and deterministic: the same project
 * always produces the same file, so exports diff cleanly in version control.
 */
export function buildExport(project: Project, options: ExportOptions = {}): ExportResult {
  const includeSource = options.includeSource !== false
  const problems: ExportProblem[] = []
  /** The lowest format version that can express everything this file uses. */
  let level = 1
  const need = (v: number) => {
    if (v > level) level = v
  }
  /** A rule's flow scope, if it points at a flow that exists. */
  const flowScope = (r: { flowId?: string | null; name: string; id: string }): string | null => {
    if (!r.flowId) return null
    if (!project.flows[r.flowId]) {
      problems.push({ level: 'warning', message: `Rule “${r.name}” was limited to a flow that no longer exists; it runs everywhere.`, at: { kind: 'rule', ruleId: r.id } })
      return null
    }
    need(2)
    return r.flowId
  }

  // --- Name tables: everything is referred to by technical name ------------
  const templateName = new Map(Object.values(project.templates).map((t) => [t.id, t.technicalName]))
  const entityName = new Map(Object.values(project.entities).map((e) => [e.id, e.technicalName]))
  const phases = Object.values(project.state.time.phases).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))
  const phaseName = new Map(phases.map((p) => [p.id, p.technicalName || toTechnicalName(p.label)]))
  const optionName = new Map<string, string>()
  const allDefs: PropertyDef[] = [
    ...Object.values(project.templates).flatMap((t) => Object.values(t.properties)),
    ...Object.values(project.state.variables),
    ...Object.values(project.state.relationships)
  ]
  for (const def of allDefs) for (const o of Object.values(def.options ?? {})) optionName.set(o.id, toTechnicalName(o.label))
  const varKey = new Map(Object.values(project.state.variables).map((v) => [v.id, `${v.namespace}.${v.technicalName}`]))
  const relKey = new Map(
    Object.values(project.state.relationships).map((r) => [
      r.id,
      `${templateName.get(r.fromTemplateId) ?? '?'}->${templateName.get(r.toTemplateId) ?? '?'}.${r.technicalName}`
    ])
  )

  /** A literal from the compiler: option, entity and phase ids become names. */
  const literal = (v: ExportValue): ExportValue =>
    typeof v === 'string' ? (optionName.get(v) ?? entityName.get(v) ?? phaseName.get(v) ?? v) : v

  const value = (def: PropertyDef, v: PropertyValue): ExportValue => {
    if (v === null) return null
    if (def.type === 'enum' && typeof v === 'string') return optionName.get(v) ?? null
    if (def.type === 'reference' && typeof v === 'string') return entityName.get(v) ?? null
    return v
  }

  const defOf = (def: PropertyDef): ExportDef => {
    const out: ExportDef = { type: TYPE_MAP[def.type], default: value(def, defaultOf(def)) }
    if (def.type === 'enum') {
      const opts = Object.values(def.options ?? {}).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))
      out.options = opts.map((o) => toTechnicalName(o.label))
      out.labels = opts.map((o) => o.label)
    }
    if (def.type === 'reference' && def.referenceTemplateId) out.template = templateName.get(def.referenceTemplateId)
    if (def.type === 'number') {
      if (def.min !== undefined) out.min = def.min
      if (def.max !== undefined) out.max = def.max
      if (def.integer) out.integer = true
    }
    return out
  }

  // --- Expressions -----------------------------------------------------------
  const path = (ref: StateRef): StatePath => {
    const ent = (id: string) => (id === 'self' ? '$self' : (entityName.get(id) ?? id))
    switch (ref.kind) {
      case 'world':
        return { get: 'var', var: varKey.get(ref.varId) ?? ref.varId }
      case 'prop': {
        const entity = ref.entity === 'self' ? undefined : project.entities[ref.entity]
        const template = entity ? project.templates[entity.templateId] : undefined
        const prop =
          template?.properties[ref.propId] ??
          Object.values(project.templates).find((t) => t.properties[ref.propId])?.properties[ref.propId]
        return { get: 'prop', entity: ent(ref.entity), prop: prop?.technicalName ?? ref.propId }
      }
      case 'rel':
        return { get: 'rel', rel: relKey.get(ref.relId) ?? ref.relId, from: ent(ref.from), to: ent(ref.to) }
      case 'time':
        if (ref.field === 'hour' || ref.field === 'minute') need(3)
        return { get: 'time', field: ref.field }
      case 'visit':
        need(2)
        return { get: 'visit', node: ref.nodeId }
    }
  }

  const expr = (b: Bound): ExprNode => {
    switch (b.k) {
      case 'lit':
        return { lit: literal(b.v) }
      case 'read':
        return path(b.ref)
      case 'un':
        return b.op === 'not' ? { not: expr(b.e) } : { neg: expr(b.e) }
      case 'bin':
        return { op: b.op as Extract<ExprNode, { op: string }>['op'], a: expr(b.l), b: expr(b.r) }
      case 'rand':
        need(2)
        return b.fn === 'chance' ? { chance: b.p } : { roll: [b.min, b.max] }
    }
  }

  const statement = (s: BoundStatement): Statement => {
    if (s.k === 'pass') {
      need(3)
      return { pass: wholeSeconds(s.minutes) }
    }
    if (s.k !== 'advance') return { set: path(s.ref), op: s.op, value: expr(s.value) }
    if (!s.toPhaseId) return { advance: s.count }
    const advanceTo = phaseName.get(s.toPhaseId) ?? s.toPhaseId
    if (!s.stay) return { advanceTo }
    need(2)
    return { advanceTo, stay: true }
  }

  const condition = (source: string, ctx: CompileContext, where: string, at?: ExportProblem['at']): ExportCondition | undefined => {
    if (!source.trim()) return undefined
    const c = compile(project, source, 'condition', ctx)
    if (!c.ok || !c.condition) {
      problems.push({ level: 'error', message: `${where}: ${c.diagnostics[0]?.message ?? 'invalid expression'} (exported as “always false”).`, at })
      return { expr: { lit: false }, ...(includeSource ? { source } : {}) }
    }
    return { expr: expr(c.condition), ...(includeSource ? { source } : {}) }
  }

  const effects = (source: string, ctx: CompileContext, where: string, at?: ExportProblem['at']): ExportEffects | undefined => {
    if (!source.trim()) return undefined
    const c = compile(project, source, 'action', ctx)
    if (!c.ok) {
      problems.push({ level: 'error', message: `${where}: ${c.diagnostics[0]?.message ?? 'invalid'} (exported as no changes).`, at })
      return { do: [], ...(includeSource ? { source } : {}) }
    }
    return { do: c.actions.map(statement), ...(includeSource ? { source } : {}) }
  }

  // --- Templates & entities --------------------------------------------------
  const templates: Record<string, ExportTemplate> = {}
  for (const t of Object.values(project.templates)) {
    const properties: ExportTemplate['properties'] = {}
    for (const p of Object.values(t.properties)) properties[p.technicalName] = { ...defOf(p), ...(p.mutable ? { state: true as const } : {}) }
    templates[t.technicalName] = { id: t.id, name: t.name, properties }
  }

  const entities: Record<string, ExportEntity> = {}
  for (const e of Object.values(project.entities)) {
    const t = project.templates[e.templateId]
    if (!t) {
      problems.push({ level: 'warning', message: `Entity “${e.name}” has no template and was left out.` })
      continue
    }
    const values: Record<string, ExportValue> = {}
    for (const p of Object.values(t.properties)) values[p.technicalName] = value(p, effectiveValue(p, e.values).value)
    entities[e.technicalName] = { id: e.id, name: e.name, template: t.technicalName, values }
  }

  // --- State -------------------------------------------------------------------
  const variables: Record<string, ExportDef & { hud?: true }> = {}
  for (const v of Object.values(project.state.variables)) {
    variables[`${v.namespace}.${v.technicalName}`] = { ...defOf(v), ...(v.showInPlay ? { hud: true as const } : {}) }
  }

  const relationships: Record<string, ExportRelationship> = {}
  for (const r of Object.values(project.state.relationships)) {
    const values: ExportRelationship['values'] = {}
    for (const e of Object.values(project.entities)) {
      const own = e.relations?.[r.id]
      if (!own) continue
      for (const [targetId, v] of Object.entries(own)) {
        const from = entityName.get(e.id)
        const to = entityName.get(targetId)
        if (!from || !to) continue
        values[from] = values[from] ?? {}
        values[from][to] = value(r, v)
      }
    }
    relationships[relKey.get(r.id) as string] = {
      ...defOf(r),
      name: r.name,
      from: templateName.get(r.fromTemplateId) ?? '?',
      to: templateName.get(r.toTemplateId) ?? '?',
      values
    }
  }

  const rules: ExportRule[] = Object.values(project.state.rules)
    .filter((r) => r.enabled)
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))
    .map((r) => {
      const ctx = { selfTemplateId: r.forEachTemplateId, allowAdvance: false }
      const at = { kind: 'rule' as const, ruleId: r.id }
      const when = condition(r.condition, ctx, `Rule “${r.name}” condition`, at)
      return {
        id: r.id,
        name: r.name,
        trigger: r.trigger,
        phase: r.trigger === 'phase' && r.phaseId ? (phaseName.get(r.phaseId) ?? null) : null,
        forEach: r.forEachTemplateId ? (templateName.get(r.forEachTemplateId) ?? null) : null,
        ...((scope) => (scope ? { flow: scope } : {}))(flowScope(r)),
        ...(when ? { when } : {}),
        effects: effects(r.effects, ctx, `Rule “${r.name}” effects`, at) ?? { do: [] }
      }
    })

  // --- Flows -----------------------------------------------------------------
  const flows: Record<string, ExportFlow> = {}
  for (const flow of Object.values(project.flows)) flows[flow.id] = exportFlow(flow)

  function exportFlow(flow: Flow): ExportFlow {
    const nodes: Record<string, ExportNode> = {}
    // Choice order is the stored order (edge.order), never the canvas layout.
    const outgoing = (id: string, handle?: string) => orderedTargets(flow, id, handle)

    for (const node of Object.values(flow.nodes)) {
      if (!isKnownNodeType(node.type)) {
        problems.push({ level: 'warning', message: `Flow “${flow.name}”: a node of unknown type “${node.type}” was left out.` })
        continue
      }
      const at = { kind: 'node' as const, flowId: flow.id, nodeId: node.id }
      const label = `Flow “${flow.name}”, ${node.type} node`
      const base = baseOf(node, label, at)
      switch (node.type) {
        case 'dialogue': {
          const speakerId = dataRef(node, 'speakerId')
          const menuText = dataString(node, 'menuText')
          nodes[node.id] = {
            ...base,
            type: 'dialogue',
            speaker: speakerId ? (entityName.get(speakerId) ?? null) : null,
            text: dataString(node, 'text'),
            ...(menuText ? { menuText } : {}),
            next: outgoing(node.id)
          }
          break
        }
        case 'condition':
          nodes[node.id] = {
            ...base,
            type: 'condition',
            condition: condition(dataString(node, 'expression'), CONDITION_NODE_CTX, `${label} condition`, at) ?? null,
            onTrue: outgoing(node.id, 'true')[0] ?? null,
            onFalse: outgoing(node.id, 'false')[0] ?? null
          }
          break
        case 'instruction':
          nodes[node.id] = {
            ...base,
            type: 'instruction',
            instruction: effects(dataString(node, 'script'), {}, `${label} instruction`, at) ?? null,
            next: outgoing(node.id)
          }
          break
        case 'hub':
          nodes[node.id] = { ...base, type: 'hub', label: dataString(node, 'label'), next: outgoing(node.id) }
          break
        case 'jump': {
          const toFlow = dataRef(node, 'targetFlowId')
          if (toFlow) {
            need(2)
            if (!project.flows[toFlow]) {
              problems.push({ level: 'error', message: `${label}: the flow it continues in no longer exists (exported as a dead end).`, at })
              nodes[node.id] = { ...base, type: 'jump', jumpTo: null }
            } else nodes[node.id] = { ...base, type: 'jump', jumpTo: null, jumpFlow: toFlow }
            break
          }
          const target = dataRef(node, 'targetId')
          const ok = target && flow.nodes[target] ? target : null
          if (!ok) problems.push({ level: 'error', message: `${label}: jump has no valid target (exported as a dead end).`, at })
          nodes[node.id] = { ...base, type: 'jump', jumpTo: ok }
          break
        }
        case 'call': {
          need(2)
          const callee = dataRef(node, 'flowId')
          const ok = callee && project.flows[callee] ? callee : null
          if (!ok) problems.push({ level: 'warning', message: `${label}: ${callee ? 'the flow it plays no longer exists' : 'no flow chosen to play'} (exported as a pass-through).`, at })
          nodes[node.id] = { ...base, type: 'call', flow: ok, next: outgoing(node.id) }
          break
        }
      }
    }
    const start = startNodes(flow)
      .filter((n) => nodes[n.id])
      .map((n) => n.id)
    if (start.length === 0 && Object.keys(nodes).length) problems.push({ level: 'warning', message: `Flow “${flow.name}” has no start node.` })
    return { id: flow.id, name: flow.name, start, nodes }
  }

  function baseOf(node: FlowNode, label: string, at: ExportProblem['at']) {
    let requires = condition(dataString(node, 'requires'), {}, `${label} requirement`, at)
    const fx = effects(dataString(node, 'effects'), {}, `${label} effects`, at)
    const tag = nodeTag(node.data)
    const once = node.data.once === true
    // "Only once": available while the story hasn't entered this node yet.
    if (once) {
      const unseen: ExprNode = { op: '==', a: { get: 'visit', node: node.id }, b: { lit: 0 } }
      const src = requires?.source
      requires = {
        expr: requires ? { op: 'and', a: unseen, b: requires.expr } : unseen,
        ...(includeSource ? { source: src ? `only once, and ${src}` : 'only once' } : {})
      }
    }
    const count = once || tag !== null
    if (count) need(2)
    const takes = nodeTakes(project, node)
    if (takes) need(3)
    return {
      id: node.id,
      ...(isStartNode(node) ? { start: true as const } : {}),
      ...(isEndNode(node) ? { end: true as const } : {}),
      ...(requires ? { requires } : {}),
      ...(fx ? { effects: fx } : {}),
      ...(count ? { count: true as const } : {}),
      ...(tag ? { tag } : {}),
      ...(takes ? { takes: takes.minutes, ...(takes.activity ? { activity: takes.activity } : {}) } : {})
    }
  }

  const clock = clockOf(project)
  const startMinute = wholeSeconds(project.state.time.startMinute ?? 0)
  if (startMinute > 0) need(3)

  const file: ExportFile = {
    format: EXPORT_FORMAT,
    // The lowest version that can read this file: older runtimes keep working until a project uses v2 features.
    version: level as ExportFile['version'],
    project: { id: project.meta.id, name: project.meta.name },
    templates,
    entities,
    state: {
      variables,
      relationships,
      time: {
        phases: phases.map((p) => phaseName.get(p.id) as string),
        labels: phases.map((p) => p.label),
        start: {
          day: project.state.time.startDay,
          phase: project.state.time.startPhaseId ? (phaseName.get(project.state.time.startPhaseId) ?? null) : null,
          ...(startMinute > 0 ? { minute: startMinute } : {})
        },
        minutes: clock.lengths,
        dayStart: clock.dayStart
      },
      rules
    },
    flows
  }
  return { file, problems }
}

const TYPE_MAP: Record<PropertyDef['type'], ExportDef['type']> = {
  text: 'text',
  longText: 'text',
  number: 'number',
  boolean: 'boolean',
  enum: 'enum',
  reference: 'entity',
  color: 'color'
}

export function serializeExport(file: ExportFile, compact = false): string {
  return serializeCanonical(file, { compact })
}
