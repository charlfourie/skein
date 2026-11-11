import type { Entity, Project, PropertyDef, StateVariable, Template, TimePhase } from '../schema'
import { toTechnicalName } from '../technicalName'
import { parseActions, parseCondition, type Diagnostic, type Expr, type NameExpr, type Seg, type Statement } from './syntax'

/**
 * Name resolution and type checking. Turns a syntax tree into a "bound" tree
 * whose names point at concrete state (by id), ready to evaluate, and reports
 * problems in plain language with a suggestion where one is likely.
 */

export type VType =
  | { t: 'number'; integer?: boolean; min?: number; max?: number }
  | { t: 'bool' }
  | { t: 'text' }
  | { t: 'enum'; options: Array<{ id: string; label: string; technicalName: string }>; ordered?: boolean }
  | { t: 'ref'; templateId: string | null }
  | { t: 'color' }
  | { t: 'symbol'; name: string }

/** A piece of readable/writable state. `self` stands for the entity a rule is running for. */
export type StateRef =
  | { kind: 'world'; varId: string }
  | { kind: 'prop'; entity: string; propId: string }
  | { kind: 'rel'; relId: string; from: string; to: string }
  | { kind: 'time'; field: 'day' | 'phase' | 'hour' | 'minute' }
  /** How many times the story has entered a tagged node (Visits.Tag; Seen.Tag is Visits.Tag > 0). */
  | { kind: 'visit'; nodeId: string }

export type Value = number | boolean | string | null

export type Bound =
  | { k: 'lit'; v: Value }
  | { k: 'read'; ref: StateRef }
  | { k: 'un'; op: 'not' | 'neg'; e: Bound }
  | { k: 'bin'; op: string; l: Bound; r: Bound }
  /** chance(p): true p% of the time. roll(min, max): a whole number from min to max. */
  | { k: 'rand'; fn: 'chance'; p: number }
  | { k: 'rand'; fn: 'roll'; min: number; max: number }

export type BoundStatement =
  | { k: 'set'; ref: StateRef; op: '=' | '+=' | '-='; value: Bound }
  | { k: 'advance'; count: number; toPhaseId?: string; /** `advance until`: do nothing if already in that phase. */ stay?: true }
  /** `pass 45m`: let minutes go by on the clock. */
  | { k: 'pass'; minutes: number }

/** condition: true/false. action: statements. value: any value, shown in a line (`{Player.Coins}`). */
export type Mode = 'condition' | 'action' | 'value'

export interface CompileContext {
  /** Inside a rule that runs for each entity of a template: `self` refers to that entity. */
  selfTemplateId?: string | null
  /** Rules can't advance time (it would trigger more rules). */
  allowAdvance?: boolean
  /**
   * Conditions may only use chance()/roll() where they are evaluated exactly once
   * (Condition nodes). Requirements are checked whenever choices are listed, so a
   * roll there would change under the player. Actions always allow it.
   */
  allowRandom?: boolean
}

export interface CompileResult {
  ok: boolean
  /** Bound condition (mode 'condition'). Null for an empty source. */
  condition: Bound | null
  /** Bound statements (mode 'action'). */
  actions: BoundStatement[]
  diagnostics: Diagnostic[]
  /** Every piece of state this source reads or writes (for "used in" look-ups). */
  refs: StateRef[]
  empty: boolean
}

// ---------------------------------------------------------------------------
// Environment: the names available in a project

export interface Env {
  project: Project
  namespaces: Map<string, Map<string, StateVariable>>
  entities: Map<string, Entity>
  phases: TimePhase[]
  phaseType: VType
  /** Node tags (for Seen.Tag / Visits.Tag): tag → the node carrying it. The first one wins if a tag is reused. */
  tags: Map<string, { flowId: string; nodeId: string }>
  cache: Map<string, CompileResult>
}

/** A node's tag, when it has a valid one. */
export function nodeTag(data: Record<string, unknown>): string | null {
  const t = data.tag
  return typeof t === 'string' && t ? t : null
}

const envCache = new WeakMap<Project, Env>()

export function getEnv(project: Project): Env {
  const cached = envCache.get(project)
  if (cached) return cached
  const namespaces = new Map<string, Map<string, StateVariable>>()
  for (const v of Object.values(project.state.variables)) {
    const ns = namespaces.get(v.namespace) ?? new Map()
    ns.set(v.technicalName, v)
    namespaces.set(v.namespace, ns)
  }
  const entities = new Map<string, Entity>()
  for (const e of Object.values(project.entities)) if (e.technicalName) entities.set(e.technicalName, e)
  const phases = Object.values(project.state.time.phases).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))
  const tags = new Map<string, { flowId: string; nodeId: string }>()
  for (const flow of Object.values(project.flows).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    for (const node of Object.values(flow.nodes).sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const tag = nodeTag(node.data)
      if (tag && !tags.has(tag)) tags.set(tag, { flowId: flow.id, nodeId: node.id })
    }
  }
  const env: Env = {
    project,
    namespaces,
    entities,
    phases,
    phaseType: {
      t: 'enum',
      ordered: true,
      options: phases.map((p) => ({ id: p.id, label: p.label, technicalName: p.technicalName || toTechnicalName(p.label) }))
    },
    tags,
    cache: new Map()
  }
  envCache.set(project, env)
  return env
}

export function propType(prop: PropertyDef): VType {
  switch (prop.type) {
    case 'number':
      return { t: 'number', integer: prop.integer, min: prop.min, max: prop.max }
    case 'boolean':
      return { t: 'bool' }
    case 'text':
    case 'longText':
      return { t: 'text' }
    case 'color':
      return { t: 'color' }
    case 'reference':
      return { t: 'ref', templateId: prop.referenceTemplateId ?? null }
    case 'enum':
      return {
        t: 'enum',
        options: Object.values(prop.options ?? {})
          .sort((a, b) => a.order - b.order)
          .map((o) => ({ id: o.id, label: o.label, technicalName: toTechnicalName(o.label) }))
      }
  }
}

export function typeLabel(t: VType): string {
  switch (t.t) {
    case 'number':
      return 'a number'
    case 'bool':
      return 'true / false'
    case 'text':
      return 'text'
    case 'color':
      return 'a colour'
    case 'ref':
      return 'an entity'
    case 'enum':
      return `one of ${t.options.slice(0, 4).map((o) => o.technicalName).join(', ')}${t.options.length > 4 ? '…' : ''}`
    case 'symbol':
      return `“${t.name}”`
  }
}

// ---------------------------------------------------------------------------

class CheckError extends Error {
  constructor(
    message: string,
    readonly start: number,
    readonly end: number
  ) {
    super(message)
  }
}

function distance(a: string, b: string): number {
  a = a.toLowerCase()
  b = b.toLowerCase()
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[b.length]
}

function suggest(name: string, candidates: Iterable<string>): string {
  const list = [...candidates]
  const lower = name.toLowerCase()
  // A name that starts with or contains what was typed is the likeliest intent ("Storm" → "StormRaging").
  const partial = list.filter((c) => c.toLowerCase().startsWith(lower) || c.toLowerCase().includes(lower)).sort((a, b) => a.length - b.length)
  if (lower.length >= 3 && partial.length) return ` Did you mean “${partial[0]}”?`
  let best: string | null = null
  let bestD = Infinity
  for (const c of list) {
    const d = distance(name, c)
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best && bestD <= Math.max(2, Math.floor(name.length / 3)) ? ` Did you mean “${best}”?` : ''
}

interface Resolved {
  ref: StateRef
  type: VType
  writable: boolean
  /** Why it isn't writable, for the error message. */
  readonlyReason?: string
  label: string
}

class Checker {
  readonly refs: StateRef[] = []
  readonly warnings: Diagnostic[] = []
  constructor(
    private readonly env: Env,
    private readonly ctx: CompileContext,
    private readonly mode: Mode
  ) {}

  private selfTemplate(): Template | undefined {
    return this.ctx.selfTemplateId ? this.env.project.templates[this.ctx.selfTemplateId] : undefined
  }

  /** An entity (or `self`) named by a segment. */
  private entityOf(seg: Seg): { id: string; template: Template | undefined; label: string } {
    if (seg.name === 'self') {
      const t = this.selfTemplate()
      if (!t) throw new CheckError('“self” only works in a rule that runs for each entity of a template.', seg.start, seg.end)
      return { id: 'self', template: t, label: 'self' }
    }
    const e = this.env.entities.get(seg.name)
    if (!e) {
      const candidates = [...this.env.entities.keys(), ...this.env.namespaces.keys(), 'Time', 'Seen', 'Visits']
      throw new CheckError(`There’s nothing called “${seg.name}”.${suggest(seg.name, candidates)}`, seg.start, seg.end)
    }
    return { id: e.id, template: this.env.project.templates[e.templateId], label: e.technicalName }
  }

  resolve(n: NameExpr): Resolved {
    const { head, to, member } = n
    if (!member) {
      throw new CheckError(`“${head.name}” on its own isn’t a value. Write it as Name.Property, e.g. ${head.name}.Something.`, head.start, head.end)
    }

    // Relationship: A->B.rel
    if (to) {
      const from = this.entityOf(head)
      const target = this.entityOf(to)
      const rels = Object.values(this.env.project.state.relationships).filter(
        (r) => r.fromTemplateId === from.template?.id && r.toTemplateId === target.template?.id
      )
      const rel = rels.find((r) => r.technicalName === member.name)
      if (!rel) {
        const hint = rels.length
          ? suggest(member.name, rels.map((r) => r.technicalName)) || ` Available: ${rels.map((r) => r.technicalName).join(', ')}.`
          : ` Define one under State › Relationships (from ${from.template?.name ?? '?'} to ${target.template?.name ?? '?'}).`
        throw new CheckError(`No relationship “${member.name}” from ${from.label} to ${target.label}.${hint}`, member.start, member.end)
      }
      const ref: StateRef = { kind: 'rel', relId: rel.id, from: from.id, to: target.id }
      return { ref, type: propType(rel), writable: true, label: `${from.label}->${target.label}.${rel.technicalName}` }
    }

    // Visits.Tag: how many times the story has entered the node tagged Tag
    if (head.name === 'Visits' || head.name === 'Seen') {
      const hit = this.env.tags.get(member.name)
      if (!hit) {
        const known = [...this.env.tags.keys()]
        const hint = known.length ? suggest(member.name, known) || ` Tags in this project: ${known.slice(0, 6).join(', ')}${known.length > 6 ? '…' : ''}.` : ' Give a node a tag in its inspector first.'
        throw new CheckError(`No node is tagged “${member.name}”.${hint}`, member.start, member.end)
      }
      return {
        ref: { kind: 'visit', nodeId: hit.nodeId },
        type: head.name === 'Seen' ? { t: 'bool' } : { t: 'number', integer: true, min: 0 },
        writable: false,
        readonlyReason: 'visit',
        label: `${head.name}.${member.name}`
      }
    }

    // Time
    if (head.name === 'Time') {
      if (member.name === 'Day') return { ref: { kind: 'time', field: 'day' }, type: { t: 'number', integer: true }, writable: false, readonlyReason: 'time', label: 'Time.Day' }
      if (member.name === 'Phase') return { ref: { kind: 'time', field: 'phase' }, type: this.env.phaseType, writable: false, readonlyReason: 'time', label: 'Time.Phase' }
      if (member.name === 'Hour') return { ref: { kind: 'time', field: 'hour' }, type: { t: 'number', integer: true }, writable: false, readonlyReason: 'time', label: 'Time.Hour' }
      if (member.name === 'Minute') return { ref: { kind: 'time', field: 'minute' }, type: { t: 'number', integer: true }, writable: false, readonlyReason: 'time', label: 'Time.Minute' }
      throw new CheckError(`Time has “Day”, “Phase”, “Hour” and “Minute”.${suggest(member.name, ['Day', 'Phase', 'Hour', 'Minute'])}`, member.start, member.end)
    }

    // World variable: Namespace.Name (namespaces win over entity names)
    const ns = this.env.namespaces.get(head.name)
    if (ns) {
      const v = ns.get(member.name)
      if (!v) throw new CheckError(`No variable “${member.name}” in ${head.name}.${suggest(member.name, ns.keys())}`, member.start, member.end)
      return { ref: { kind: 'world', varId: v.id }, type: propType(v), writable: true, label: `${head.name}.${v.technicalName}` }
    }

    // Entity property: Entity.Prop or self.Prop
    const owner = this.entityOf(head)
    const props = Object.values(owner.template?.properties ?? {})
    const prop = props.find((p) => p.technicalName === member.name)
    if (!prop) {
      throw new CheckError(
        `${owner.label} (${owner.template?.name ?? 'no template'}) has no property “${member.name}”.${suggest(member.name, props.map((p) => p.technicalName))}`,
        member.start,
        member.end
      )
    }
    return {
      ref: { kind: 'prop', entity: owner.id, propId: prop.id },
      type: propType(prop),
      writable: prop.mutable === true,
      readonlyReason: prop.mutable ? undefined : `prop:${owner.template?.name ?? ''}`,
      label: `${owner.label}.${prop.technicalName}`
    }
  }

  private random(e: Extract<Expr, { kind: 'random' }>): { b: Bound; type: VType } {
    if (this.mode === 'value') {
      throw new CheckError(`${e.fn}() can’t be used inside a line: the line would show a different number each time it’s read. Roll in an action and show the variable instead.`, e.start, e.end)
    }
    if (this.mode === 'condition' && !this.ctx.allowRandom) {
      throw new CheckError(
        `${e.fn}() can’t be used in a requirement or a rule’s “only if”: those are checked again and again, so the result would keep changing. Roll in an action (World.Lucky = ${e.fn === 'chance' ? 'chance(30)' : 'roll(1, 6)'}) or branch with a Condition node.`,
        e.start,
        e.end
      )
    }
    const whole = (a: { value: number; start: number; end: number }, what: string) => {
      if (!Number.isInteger(a.value)) throw new CheckError(`${what} must be a whole number.`, a.start, a.end)
      return a.value
    }
    if (e.fn === 'chance') {
      if (e.args.length !== 1) throw new CheckError('chance takes one number: the percent chance of true, e.g. chance(30).', e.start, e.end)
      const p = whole(e.args[0], 'The percent chance')
      if (p < 0 || p > 100) throw new CheckError('The chance is a percent, from 0 to 100.', e.args[0].start, e.args[0].end)
      if (p === 0 || p === 100) this.warnings.push({ level: 'warning', message: `chance(${p}) is always ${p === 100}.`, start: e.start, end: e.end })
      return { b: { k: 'rand', fn: 'chance', p }, type: { t: 'bool' } }
    }
    if (e.args.length !== 2) throw new CheckError('roll takes two numbers, the lowest and highest result, e.g. roll(1, 6).', e.start, e.end)
    const min = whole(e.args[0], 'The lowest result')
    const max = whole(e.args[1], 'The highest result')
    if (max < min) throw new CheckError(`The highest result (${max}) is below the lowest (${min}).`, e.args[1].start, e.args[1].end)
    if (max - min >= 100) throw new CheckError('roll can have at most 100 different results, so Play can try every one.', e.start, e.end)
    return { b: { k: 'rand', fn: 'roll', min, max }, type: { t: 'number' } }
  }

  expr(e: Expr): { b: Bound; type: VType } {
    switch (e.kind) {
      case 'number':
        return { b: { k: 'lit', v: e.value }, type: { t: 'number' } }
      case 'string':
        return { b: { k: 'lit', v: e.value }, type: { t: 'text' } }
      case 'bool':
        return { b: { k: 'lit', v: e.value }, type: { t: 'bool' } }
      case 'random':
        return this.random(e)
      case 'name': {
        if (!e.member && !e.to) return { b: { k: 'lit', v: e.head.name }, type: { t: 'symbol', name: e.head.name } }
        const r = this.resolve(e)
        this.refs.push(r.ref)
        if (e.head.name === 'Seen' && r.ref.kind === 'visit') {
          return { b: { k: 'bin', op: '>', l: { k: 'read', ref: r.ref }, r: { k: 'lit', v: 0 } }, type: { t: 'bool' } }
        }
        return { b: { k: 'read', ref: r.ref }, type: r.type }
      }
      case 'unary': {
        const a = this.expr(e.arg)
        if (e.op === 'not') {
          this.expectBool(a.type, e.arg)
          return { b: { k: 'un', op: 'not', e: a.b }, type: { t: 'bool' } }
        }
        this.expectNumber(a.type, e.arg)
        return { b: { k: 'un', op: 'neg', e: a.b }, type: { t: 'number' } }
      }
      case 'binary': {
        const l = this.expr(e.left)
        const r = this.expr(e.right)
        switch (e.op) {
          case 'and':
          case 'or':
            this.expectBool(l.type, e.left)
            this.expectBool(r.type, e.right)
            return { b: { k: 'bin', op: e.op, l: l.b, r: r.b }, type: { t: 'bool' } }
          case '+':
          case '-':
          case '*':
          case '/':
            this.expectNumber(l.type, e.left)
            this.expectNumber(r.type, e.right)
            return { b: { k: 'bin', op: e.op, l: l.b, r: r.b }, type: { t: 'number' } }
          case '==':
          case '!=': {
            const [lb, rb] = this.unify(l, r, e)
            return { b: { k: 'bin', op: e.op, l: lb, r: rb }, type: { t: 'bool' } }
          }
          default: {
            // < <= > >= : numbers, or time phases (Time.Phase >= Dusk)
            if (l.type.t === 'enum' && l.type.ordered) {
              const [lb, rb] = this.unify(l, r, e)
              return { b: { k: 'bin', op: `phase${e.op}`, l: lb, r: rb }, type: { t: 'bool' } }
            }
            this.expectNumber(l.type, e.left)
            this.expectNumber(r.type, e.right)
            return { b: { k: 'bin', op: e.op, l: l.b, r: r.b }, type: { t: 'bool' } }
          }
        }
      }
    }
  }

  /** Make two sides comparable, turning bare names and text into enum options / entities as needed. */
  unify(l: { b: Bound; type: VType }, r: { b: Bound; type: VType }, e: Extract<Expr, { kind: 'binary' }>): [Bound, Bound] {
    if (l.type.t === 'symbol' && r.type.t === 'symbol') {
      throw new CheckError(`“${l.type.name}” on its own isn’t a value.`, e.left.start, e.left.end)
    }
    const leftIsLooseName = l.type.t === 'symbol' || (l.type.t === 'text' && l.b.k === 'lit' && (r.type.t === 'enum' || r.type.t === 'ref'))
    if (leftIsLooseName) return [this.coerce(l, r.type, e.left), r.b]
    return [l.b, this.coerce(r, l.type, e.right)]
  }

  /** Check a value fits `target`, converting names/text where that's meaningful. */
  coerce(v: { b: Bound; type: VType }, target: VType, at: { start: number; end: number }): Bound {
    const name = v.type.t === 'symbol' ? v.type.name : v.type.t === 'text' && v.b.k === 'lit' ? String(v.b.v) : null
    if (target.t === 'enum' && name !== null) {
      const opt = target.options.find((o) => o.technicalName === name || o.label === name || o.label.toLowerCase() === name.toLowerCase())
      if (!opt) {
        throw new CheckError(`“${name}” isn’t one of the options.${suggest(name, target.options.map((o) => o.technicalName))} Options: ${target.options.map((o) => o.technicalName).join(', ') || '(none yet)'}.`, at.start, at.end)
      }
      return { k: 'lit', v: opt.id }
    }
    if (target.t === 'ref' && v.type.t === 'symbol') {
      const ent = this.env.entities.get(v.type.name)
      if (!ent) throw new CheckError(`There’s no entity called “${v.type.name}”.${suggest(v.type.name, this.env.entities.keys())}`, at.start, at.end)
      if (target.templateId && ent.templateId !== target.templateId) {
        const want = this.env.project.templates[target.templateId]?.name
        throw new CheckError(`“${v.type.name}” isn’t a ${want ?? 'matching entity'}.`, at.start, at.end)
      }
      return { k: 'lit', v: ent.id }
    }
    if (v.type.t === 'symbol') {
      throw new CheckError(`“${v.type.name}” on its own isn’t a value.${suggest(v.type.name, [...this.env.namespaces.keys(), ...this.env.entities.keys(), 'Time'])}`, at.start, at.end)
    }
    const compatible =
      v.type.t === target.t ||
      (v.type.t === 'text' && target.t === 'color') ||
      (v.type.t === 'color' && target.t === 'text') ||
      (v.type.t === 'ref' && target.t === 'ref')
    if (!compatible) throw new CheckError(`Expected ${typeLabel(target)}, but this is ${typeLabel(v.type)}.`, at.start, at.end)
    return v.b
  }

  expectBool(t: VType, at: Expr): void {
    if (t.t !== 'bool') throw new CheckError(`Expected true / false, but this is ${typeLabel(t)}. Compare it, e.g. “… > 2” or “… == Something”.`, at.start, at.end)
  }

  expectNumber(t: VType, at: Expr): void {
    if (t.t !== 'number') throw new CheckError(`Expected a number, but this is ${typeLabel(t)}.`, at.start, at.end)
  }

  statement(s: Statement): BoundStatement {
    if (s.kind === 'pass') {
      if (this.ctx.allowAdvance === false) throw new CheckError('Rules can’t pass time (that would trigger more rules).', s.start, s.end)
      this.refs.push({ kind: 'time', field: 'phase' })
      return { k: 'pass', minutes: s.minutes }
    }
    if (s.kind === 'advance') {
      if (this.ctx.allowAdvance === false) throw new CheckError('Rules can’t advance time (that would trigger more rules).', s.start, s.end)
      if (s.toPhase) {
        const name = s.toPhase.name
        const phase = this.env.phaseType.t === 'enum' ? this.env.phaseType.options.find((o) => o.technicalName === name || o.label === name) : undefined
        if (!phase) {
          const names = this.env.phaseType.t === 'enum' ? this.env.phaseType.options.map((o) => o.technicalName) : []
          throw new CheckError(`There’s no time phase “${name}”.${suggest(name, names)}`, s.toPhase.start, s.toPhase.end)
        }
        this.refs.push({ kind: 'time', field: 'phase' })
        return { k: 'advance', count: 1, toPhaseId: phase.id, ...(s.stay ? { stay: true as const } : {}) }
      }
      this.refs.push({ kind: 'time', field: 'phase' })
      return { k: 'advance', count: s.count }
    }
    const target = this.resolve(s.target)
    this.refs.push(target.ref)
    if (!target.writable) {
      const msg =
        target.readonlyReason === 'time'
          ? 'Time can’t be set directly; use “pass 30m”, “advance”, or “advance until Night”.'
          : target.readonlyReason === 'visit'
            ? `${target.label} counts itself: the story adds one each time it enters that node.`
          : `${target.label} is fixed design data. Mark the property as “Changes during play” in the ${target.readonlyReason?.slice(5) || ''} template to change it.`
      throw new CheckError(msg, s.target.start, s.target.end)
    }
    const value = this.expr(s.value)
    if (s.op !== '=') {
      if (target.type.t !== 'number') throw new CheckError(`“${s.op}” only works on numbers; ${target.label} is ${typeLabel(target.type)}.`, s.target.start, s.target.end)
      this.expectNumber(value.type, s.value)
      return { k: 'set', ref: target.ref, op: s.op, value: value.b }
    }
    const bound = this.coerce(value, target.type, s.value)
    if (target.type.t === 'number' && bound.k === 'lit' && typeof bound.v === 'number') {
      const t = target.type
      const problem =
        t.integer && !Number.isInteger(bound.v)
          ? 'must be a whole number'
          : t.min !== undefined && bound.v < t.min
            ? `is below its minimum (${t.min})`
            : t.max !== undefined && bound.v > t.max
              ? `is above its maximum (${t.max})`
              : null
      if (problem) this.warnings.push({ level: 'warning', message: `${target.label} ${problem}.`, start: s.value.start, end: s.value.end })
    }
    return { k: 'set', ref: target.ref, op: '=', value: bound }
  }
}

// ---------------------------------------------------------------------------

export function compile(project: Project, source: string, mode: Mode, ctx: CompileContext = {}): CompileResult {
  const env = getEnv(project)
  const key = `${mode}\u0001${ctx.selfTemplateId ?? ''}\u0001${ctx.allowAdvance === false ? 0 : 1}${ctx.allowRandom ? 1 : 0}\u0001${source}`
  const cached = env.cache.get(key)
  if (cached) return cached

  let result: CompileResult
  if (!source.trim()) {
    result = { ok: true, condition: null, actions: [], diagnostics: [], refs: [], empty: true }
  } else if (mode === 'condition' || mode === 'value') {
    const parsed = parseCondition(source)
    if (!parsed.ast) result = fail(parsed.diagnostics)
    else {
      const checker = new Checker(env, ctx, mode)
      try {
        const { b, type } = checker.expr(parsed.ast)
        if (mode === 'condition') checker.expectBool(type, parsed.ast)
        result = { ok: true, condition: b, actions: [], diagnostics: checker.warnings, refs: checker.refs, empty: false }
      } catch (e) {
        if (!(e instanceof CheckError)) throw e
        result = fail([{ level: 'error', message: e.message, start: e.start, end: e.end }])
      }
    }
  } else {
    const parsed = parseActions(source)
    if (!parsed.ast) result = fail(parsed.diagnostics)
    else {
      const checker = new Checker(env, ctx, mode)
      const actions: BoundStatement[] = []
      const errors: Diagnostic[] = []
      for (const s of parsed.ast) {
        try {
          actions.push(checker.statement(s))
        } catch (e) {
          if (!(e instanceof CheckError)) throw e
          errors.push({ level: 'error', message: e.message, start: e.start, end: e.end })
        }
      }
      result = errors.length
        ? fail([...errors, ...checker.warnings])
        : { ok: true, condition: null, actions, diagnostics: checker.warnings, refs: checker.refs, empty: false }
    }
  }
  env.cache.set(key, result)
  return result
}

function fail(diagnostics: Diagnostic[]): CompileResult {
  return { ok: false, condition: null, actions: [], diagnostics, refs: [], empty: false }
}

