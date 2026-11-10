import type { Project } from '../schema'
import { defaultOf, effectiveValue } from '../values'
import { compile, getEnv, type Bound, type BoundStatement, type StateRef, type Value } from './check'

/**
 * Reference semantics for state, conditions, actions, time and rules. The
 * editor uses it to preview conditions against the starting state; Phase 5's
 * export documents the same rules for game engines.
 *
 * Runtime state only stores what has changed since the start; everything else
 * reads through to the starting values defined in the project.
 */
export interface WorldState {
  changes: Map<string, Value>
  day: number
  /** Index into the ordered phase list. */
  phase: number
}

export function initialState(project: Project): WorldState {
  const env = getEnv(project)
  const start = env.phases.findIndex((p) => p.id === project.state.time.startPhaseId)
  return { changes: new Map(), day: project.state.time.startDay, phase: Math.max(0, start) }
}

function key(ref: StateRef, self: string | null): string {
  const id = (x: string) => (x === 'self' ? (self ?? 'self') : x)
  switch (ref.kind) {
    case 'world':
      return `w:${ref.varId}`
    case 'prop':
      return `p:${id(ref.entity)}:${ref.propId}`
    case 'rel':
      return `r:${ref.relId}:${id(ref.from)}:${id(ref.to)}`
    case 'time':
      return `t:${ref.field}`
    case 'visit':
      return `v:${ref.nodeId}`
  }
}

/** The starting value of a piece of state, as defined in the project. */
export function startingValue(project: Project, ref: StateRef, self: string | null = null): Value {
  const id = (x: string) => (x === 'self' ? self : x)
  switch (ref.kind) {
    case 'world': {
      const v = project.state.variables[ref.varId]
      return v ? defaultOf(v) : null
    }
    case 'prop': {
      const entityId = id(ref.entity)
      const entity = entityId ? project.entities[entityId] : undefined
      const prop = entity && project.templates[entity.templateId]?.properties[ref.propId]
      return entity && prop ? effectiveValue(prop, entity.values).value : null
    }
    case 'rel': {
      const rel = project.state.relationships[ref.relId]
      const from = id(ref.from)
      const to = id(ref.to)
      if (!rel || !from || !to) return null
      const own = project.entities[from]?.relations?.[ref.relId]?.[to]
      return own !== undefined ? own : defaultOf(rel)
    }
    case 'time':
      return null
    case 'visit':
      return 0
  }
}

export interface RunContext {
  project: Project
  state: WorldState
  self?: string | null
}

export function read(ctx: RunContext, ref: StateRef): Value {
  if (ref.kind === 'time') {
    const env = getEnv(ctx.project)
    return ref.field === 'day' ? ctx.state.day : (env.phases[ctx.state.phase]?.id ?? null)
  }
  const k = key(ref, ctx.self ?? null)
  return ctx.state.changes.has(k) ? (ctx.state.changes.get(k) as Value) : startingValue(ctx.project, ref, ctx.self ?? null)
}

function phaseIndex(ctx: RunContext, v: Value): number {
  return getEnv(ctx.project).phases.findIndex((p) => p.id === v)
}

export function evaluate(ctx: RunContext, b: Bound): Value {
  switch (b.k) {
    case 'lit':
      return b.v
    case 'read':
      return read(ctx, b.ref)
    case 'un': {
      const v = evaluate(ctx, b.e)
      return b.op === 'not' ? !v : -(Number(v) || 0)
    }
    case 'bin': {
      if (b.op === 'and') return Boolean(evaluate(ctx, b.l)) && Boolean(evaluate(ctx, b.r))
      if (b.op === 'or') return Boolean(evaluate(ctx, b.l)) || Boolean(evaluate(ctx, b.r))
      const l = evaluate(ctx, b.l)
      const r = evaluate(ctx, b.r)
      const n = (v: Value) => (typeof v === 'number' ? v : Number(v) || 0)
      switch (b.op) {
        case '==':
          return l === r
        case '!=':
          return l !== r
        case '<':
          return n(l) < n(r)
        case '<=':
          return n(l) <= n(r)
        case '>':
          return n(l) > n(r)
        case '>=':
          return n(l) >= n(r)
        case 'phase<':
          return phaseIndex(ctx, l) < phaseIndex(ctx, r)
        case 'phase<=':
          return phaseIndex(ctx, l) <= phaseIndex(ctx, r)
        case 'phase>':
          return phaseIndex(ctx, l) > phaseIndex(ctx, r)
        case 'phase>=':
          return phaseIndex(ctx, l) >= phaseIndex(ctx, r)
        case '+':
          return n(l) + n(r)
        case '-':
          return n(l) - n(r)
        case '*':
          return n(l) * n(r)
        case '/':
          return n(r) === 0 ? 0 : n(l) / n(r)
      }
      return null
    }
  }
}

/** Write respecting the property's limits: numbers are clamped to min/max and rounded if whole-only. */
function write(ctx: RunContext, ref: StateRef, value: Value): void {
  const def =
    ref.kind === 'world'
      ? ctx.project.state.variables[ref.varId]
      : ref.kind === 'rel'
        ? ctx.project.state.relationships[ref.relId]
        : ref.kind === 'prop'
          ? (() => {
              const entityId = ref.entity === 'self' ? ctx.self : ref.entity
              const e = entityId ? ctx.project.entities[entityId] : undefined
              return e ? ctx.project.templates[e.templateId]?.properties[ref.propId] : undefined
            })()
          : undefined
  let v = value
  if (def?.type === 'number' && typeof v === 'number') {
    if (def.integer) v = Math.round(v)
    if (def.min !== undefined) v = Math.max(def.min, v)
    if (def.max !== undefined) v = Math.min(def.max, v)
  }
  ctx.state.changes.set(key(ref, ctx.self ?? null), v)
}

export interface ExecuteLog {
  /** Human-readable trace of what happened, for previews and tests. */
  lines: string[]
}

export function execute(ctx: RunContext, statements: BoundStatement[], log?: ExecuteLog): void {
  for (const s of statements) {
    if (s.k === 'advance') {
      advanceTime(ctx, s.count, s.toPhaseId, log, s.stay)
      continue
    }
    const value = evaluate(ctx, s.value)
    if (s.op === '=') write(ctx, s.ref, value)
    else {
      const cur = Number(read(ctx, s.ref)) || 0
      write(ctx, s.ref, s.op === '+=' ? cur + (Number(value) || 0) : cur - (Number(value) || 0))
    }
  }
}

/**
 * Move time forward one phase at a time. Entering a phase runs that phase's
 * rules; wrapping past the last phase starts a new day and runs day rules
 * first. Rules run in their listed order, once per matching entity for
 * "for each" rules (entities in id order), and only when their condition holds.
 */
export function advanceTime(ctx: RunContext, count: number, toPhaseId?: string, log?: ExecuteLog, stay?: boolean): void {
  const env = getEnv(ctx.project)
  const n = env.phases.length
  if (n === 0) return
  const rules = Object.values(ctx.project.state.rules)
    .filter((r) => r.enabled)
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))
  let steps = toPhaseId ? 0 : count
  if (toPhaseId) {
    const target = env.phases.findIndex((p) => p.id === toPhaseId)
    if (target < 0) return
    // `advance to` always moves at least one phase (a whole day if already there); `advance until` stays put.
    steps = stay && target === ctx.state.phase ? 0 : ((target - ctx.state.phase + n - 1) % n) + 1
  }
  for (let i = 0; i < steps; i++) {
    ctx.state.phase = (ctx.state.phase + 1) % n
    const newDay = ctx.state.phase === 0
    if (newDay) ctx.state.day += 1
    const phaseId = env.phases[ctx.state.phase].id
    log?.lines.push(`Time → Day ${ctx.state.day}, ${env.phases[ctx.state.phase].label}`)
    for (const trigger of newDay ? (['day', 'phase'] as const) : (['phase'] as const)) {
      for (const rule of rules) {
        if (rule.trigger !== trigger) continue
        if (trigger === 'phase' && rule.phaseId && rule.phaseId !== phaseId) continue
        runRule(ctx, rule.id, log)
      }
    }
  }
}

function runRule(ctx: RunContext, ruleId: string, log?: ExecuteLog): void {
  const rule = ctx.project.state.rules[ruleId]
  const opts = { selfTemplateId: rule.forEachTemplateId, allowAdvance: false }
  const cond = compile(ctx.project, rule.condition, 'condition', opts)
  const effects = compile(ctx.project, rule.effects, 'action', opts)
  if (!cond.ok || !effects.ok) return // broken rules are flagged in the editor and skipped
  const selves = rule.forEachTemplateId
    ? Object.values(ctx.project.entities)
        .filter((e) => e.templateId === rule.forEachTemplateId)
        .map((e) => e.id)
        .sort()
    : [null]
  for (const self of selves) {
    const inner: RunContext = { ...ctx, self }
    if (cond.condition && !evaluate(inner, cond.condition)) continue
    execute(inner, effects.actions, log)
    log?.lines.push(`Rule “${rule.name}”${self ? ` for ${ctx.project.entities[self]?.name}` : ''}`)
  }
}

/** Evaluate a condition source against the starting state (null if it doesn't compile or is empty). */
export function evaluateAtStart(project: Project, source: string): boolean | null {
  const c = compile(project, source, 'condition')
  if (!c.ok || !c.condition) return null
  return Boolean(evaluate({ project, state: initialState(project) }, c.condition))
}
