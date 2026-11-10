/**
 * Skein reference runtime: plays a "skein.export" file.
 *
 * Dependency-free and self-contained (it imports only types), so it can be
 * copied into a JavaScript/TypeScript game as-is, or used as the reference
 * when porting to C#, GDScript or C++. docs/EXPORT.md describes the same
 * rules in prose. The editor's own evaluator implements identical semantics,
 * and the test suite checks that the two agree.
 *
 *   const world = new SkeinWorld(data)
 *   const story = new SkeinStory(world, flowId)
 *   let beat = story.start()
 *   while (beat.kind !== 'end') {
 *     show(beat)
 *     beat = story.choose(pickIndex(beat.choices))
 *   }
 */
import type {
  ExportCondition,
  ExportDef,
  ExportEffects,
  ExportFile,
  ExportFlow,
  ExportNode,
  ExportValue,
  ExprNode,
  StatePath,
  Statement
} from './types'
import { EXPORT_VERSION } from './types'

/** A random draw: chance(p) or roll(min, max). */
export type Draw = { kind: 'chance'; p: number } | { kind: 'roll'; min: number; max: number }

/** The number of outcomes of a draw: chance has 2 (0 = true, 1 = false); roll has one per result (k = min + k). */
export function outcomesOf(d: Draw): number {
  return d.kind === 'chance' ? 2 : d.max - d.min + 1
}

/** The probability of outcome `k` of a draw. */
export function weightOf(d: Draw, k: number): number {
  return d.kind === 'chance' ? (k === 0 ? d.p : 100 - d.p) / 100 : 1 / outcomesOf(d)
}

export interface SkeinSave {
  changes: Record<string, ExportValue>
  day: number
  phase: string | null
  /** v3: seconds into the current phase. */
  seconds?: number
  /** v2: the random generator's state, so a loaded game rolls the same dice. */
  rng?: number
}

/** Round to whole seconds, the same way in every runtime (half up). */
export function toSeconds(minutes: number): number {
  return Math.floor(minutes * 60 + 0.5)
}

/** The seed used when none is given. Pass your own (e.g. from the clock) for different dice each run. */
export const DEFAULT_SEED = 0x5eed

export class SkeinWorld {
  readonly data: ExportFile
  /** Only values that changed since the start; everything else reads through to the export. */
  readonly changes = new Map<string, ExportValue>()
  day: number
  phaseIndex: number
  /** v3: seconds into the current phase. Each phase lasts `time.minutes[i]`; past that, the next phase begins. */
  seconds = 0
  /** Optional trace of time and rule activity. */
  log: string[] = []
  /** v2: the flow being played right now (set by SkeinStory), for rules limited to one flow. */
  playing: string | null = null
  /** Debugging hook: an `advance to` that was already in its phase, so it moves a whole day. */
  onFullDay?: (phase: string) => void
  /** The random generator's state (mulberry32). Same seed, same dice. */
  rng: number
  /** Debugging hook: decide a draw instead of rolling (return the outcome index, see outcomesOf). */
  decide?: (draw: Draw) => number
  /** Debugging hook: every write, with its key, the value stored, the value asked for (they differ when clamped or rounded) and the value before. */
  onWrite?: (key: string, stored: ExportValue, asked: ExportValue, before: ExportValue) => void
  /** Debugging hook: minutes passed on the clock (by an activity, a spoken line or `pass`). */
  onPass?: (minutes: number) => void
  /** Debugging hook: called with every draw and its result. */
  onRandom?: (draw: Draw, result: ExportValue) => void

  constructor(data: ExportFile, saved?: SkeinSave, options: { seed?: number } = {}) {
    if (data.version > EXPORT_VERSION)
      throw new Error(`This export is version ${data.version}, but this runtime reads version ${EXPORT_VERSION}. Update the Skein runtime.`)
    this.data = data
    const phases = data.state.time.phases
    this.day = data.state.time.start.day
    this.phaseIndex = Math.max(0, phases.indexOf(data.state.time.start.phase ?? phases[0]))
    this.seconds = toSeconds(data.state.time.start.minute ?? 0)
    this.rng = (options.seed ?? DEFAULT_SEED) >>> 0
    if (saved) {
      for (const [k, v] of Object.entries(saved.changes)) this.changes.set(k, v)
      this.day = saved.day
      this.phaseIndex = Math.max(0, phases.indexOf(saved.phase ?? phases[0]))
      this.seconds = typeof saved.seconds === 'number' ? saved.seconds : 0
      if (typeof saved.rng === 'number') this.rng = saved.rng >>> 0
    }
  }

  get phase(): string | null {
    return this.data.state.time.phases[this.phaseIndex] ?? null
  }

  /** Everything needed to restore this world later (e.g. in a save game). */
  save(): SkeinSave {
    return {
      changes: Object.fromEntries([...this.changes].sort(([a], [b]) => (a < b ? -1 : 1))),
      day: this.day,
      phase: this.phase,
      seconds: this.seconds,
      rng: this.rng
    }
  }

  // --- The clock -------------------------------------------------------------------

  /** Seconds in phase `i`: from `time.minutes`, or (older files) 24 hours split evenly. */
  phaseSeconds(i: number): number {
    const t = this.data.state.time
    const m = t.minutes?.[i] ?? Math.floor(1440 / Math.max(1, t.phases.length))
    return Math.max(1, toSeconds(m))
  }

  /** Minutes into the current phase. */
  get minute(): number {
    return this.seconds / 60
  }

  /** The time of day: hour 0–23 and minute 0–59. */
  get clock(): { hour: number; minute: number } {
    let total = toSeconds(this.data.state.time.dayStart ?? 0) + this.seconds
    for (let i = 0; i < this.phaseIndex; i++) total += this.phaseSeconds(i)
    const m = Math.floor(total / 60) % 1440
    return { hour: Math.floor(m / 60), minute: m % 60 }
  }

  /** Let minutes go by. Running past the end of a phase begins the next one (and runs its rules), as often as needed. */
  pass(minutes: number): void {
    let s = toSeconds(minutes)
    if (s <= 0 || this.data.state.time.phases.length === 0) return
    this.onPass?.(minutes)
    for (let guard = 0; guard < 100000; guard++) {
      const left = this.phaseSeconds(this.phaseIndex) - this.seconds
      if (s < left) {
        this.seconds += s
        return
      }
      s -= left
      this.advance(1)
    }
  }

  // --- Randomness ----------------------------------------------------------------

  /** The next 32-bit random number (mulberry32; the C# runtime produces the same sequence). */
  nextRandom(): number {
    this.rng = (this.rng + 0x6d2b79f5) >>> 0
    let t = this.rng
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }

  /** Make a draw: chance → true/false, roll → a whole number. Uses `decide` when set. */
  draw(d: Draw): ExportValue {
    const k = this.decide ? this.decide(d) : this.nextRandom() % (d.kind === 'chance' ? 100 : outcomesOf(d))
    const result = d.kind === 'chance' ? (this.decide ? k === 0 : k < d.p) : d.min + k
    this.onRandom?.(d, result)
    return result
  }

  // --- Reading and writing state ----------------------------------------------

  private resolve(p: StatePath, self?: string): StatePath {
    if (p.get === 'prop' && p.entity === '$self') return { ...p, entity: self ?? '$self' }
    if (p.get === 'rel') return { ...p, from: p.from === '$self' ? (self ?? '$self') : p.from, to: p.to === '$self' ? (self ?? '$self') : p.to }
    return p
  }

  /** The key a piece of state is stored under: "var:World.Storm", "prop:Keeper.Mood", "rel:Character->Character.Trust:Keeper:Stranger". */
  static key(p: StatePath): string {
    switch (p.get) {
      case 'var':
        return `var:${p.var}`
      case 'prop':
        return `prop:${p.entity}.${p.prop}`
      case 'rel':
        return `rel:${p.rel}:${p.from}:${p.to}`
      case 'time':
        return `time:${p.field}`
      case 'visit':
        return `visit:${p.node}`
    }
  }

  definition(p: StatePath): ExportDef | undefined {
    const s = this.data.state
    if (p.get === 'var') return s.variables[p.var]
    if (p.get === 'rel') return s.relationships[p.rel]
    if (p.get === 'prop') {
      const e = this.data.entities[p.entity]
      return e ? this.data.templates[e.template]?.properties[p.prop] : undefined
    }
    return undefined
  }

  read(path: StatePath, self?: string): ExportValue {
    const p = this.resolve(path, self)
    if (p.get === 'time') return p.field === 'day' ? this.day : p.field === 'phase' ? this.phase : p.field === 'hour' ? this.clock.hour : this.clock.minute
    if (p.get === 'visit') return (this.changes.get(SkeinWorld.key(p)) as number | undefined) ?? 0
    const k = SkeinWorld.key(p)
    if (this.changes.has(k)) return this.changes.get(k) as ExportValue
    const s = this.data.state
    switch (p.get) {
      case 'var':
        return s.variables[p.var]?.default ?? null
      case 'prop':
        return this.data.entities[p.entity]?.values[p.prop] ?? null
      case 'rel': {
        const r = s.relationships[p.rel]
        return r ? (r.values[p.from]?.[p.to] ?? r.default) : null
      }
    }
  }

  /** v2: the story entered a node with `count: true`. */
  countVisit(nodeId: string): void {
    const k = SkeinWorld.key({ get: 'visit', node: nodeId })
    this.changes.set(k, ((this.changes.get(k) as number | undefined) ?? 0) + 1)
  }

  /** Writes clamp numbers to the definition's min/max and round whole-number values. */
  write(path: StatePath, value: ExportValue, self?: string): void {
    const p = this.resolve(path, self)
    if (p.get === 'time' || p.get === 'visit') return // time moves by advancing; visits count themselves
    const def = this.definition(p)
    let v = value
    if (def?.type === 'number' && typeof v === 'number') {
      if (def.integer) v = Math.round(v)
      if (def.min !== undefined) v = Math.max(def.min, v)
      if (def.max !== undefined) v = Math.min(def.max, v)
    }
    const k = SkeinWorld.key(p)
    const before = this.onWrite ? this.read(p) : null
    this.changes.set(k, v)
    this.onWrite?.(k, v, value, before)
  }

  // --- Expressions -------------------------------------------------------------

  evaluate(e: ExprNode, self?: string): ExportValue {
    if ('lit' in e) return e.lit
    if ('get' in e) return this.read(e, self)
    if ('not' in e) return !this.evaluate(e.not, self)
    if ('neg' in e) return -(Number(this.evaluate(e.neg, self)) || 0)
    if ('chance' in e) return this.draw({ kind: 'chance', p: e.chance })
    if ('roll' in e) return this.draw({ kind: 'roll', min: e.roll[0], max: e.roll[1] })
    if (e.op === 'and') return Boolean(this.evaluate(e.a, self)) && Boolean(this.evaluate(e.b, self))
    if (e.op === 'or') return Boolean(this.evaluate(e.a, self)) || Boolean(this.evaluate(e.b, self))
    const a = this.evaluate(e.a, self)
    const b = this.evaluate(e.b, self)
    const n = (v: ExportValue) => (typeof v === 'number' ? v : Number(v) || 0)
    const ph = (v: ExportValue) => this.data.state.time.phases.indexOf(String(v))
    switch (e.op) {
      case '==':
        return a === b
      case '!=':
        return a !== b
      case '<':
        return n(a) < n(b)
      case '<=':
        return n(a) <= n(b)
      case '>':
        return n(a) > n(b)
      case '>=':
        return n(a) >= n(b)
      case 'phase<':
        return ph(a) < ph(b)
      case 'phase<=':
        return ph(a) <= ph(b)
      case 'phase>':
        return ph(a) > ph(b)
      case 'phase>=':
        return ph(a) >= ph(b)
      case '+':
        return n(a) + n(b)
      case '-':
        return n(a) - n(b)
      case '*':
        return n(a) * n(b)
      case '/':
        return n(b) === 0 ? 0 : n(a) / n(b)
    }
  }

  /** A missing condition always holds. */
  check(c: ExportCondition | null | undefined, self?: string): boolean {
    return c ? Boolean(this.evaluate(c.expr, self)) : true
  }

  run(effects: ExportEffects | null | undefined, self?: string): void {
    for (const s of effects?.do ?? []) this.execute(s, self)
  }

  execute(s: Statement, self?: string): void {
    if ('advance' in s) return this.advance(s.advance)
    if ('advanceTo' in s) return this.advanceTo(s.advanceTo, s.stay === true)
    if ('pass' in s) return this.pass(s.pass)
    const value = this.evaluate(s.value, self)
    if (s.op === '=') return this.write(s.set, value, self)
    const cur = Number(this.read(s.set, self)) || 0
    this.write(s.set, s.op === '+=' ? cur + (Number(value) || 0) : cur - (Number(value) || 0), self)
  }

  // --- Time and rules ------------------------------------------------------------

  /** Move forward `count` phases. Each phase that begins runs its rules; wrapping past the last phase starts a new day. */
  advance(count = 1): void {
    const phases = this.data.state.time.phases
    if (phases.length === 0) return
    for (let i = 0; i < count; i++) {
      this.phaseIndex = (this.phaseIndex + 1) % phases.length
      this.seconds = 0
      const newDay = this.phaseIndex === 0
      if (newDay) this.day += 1
      this.log.push(`Time → Day ${this.day}, ${this.phase}`)
      if (newDay) this.runRules('day')
      this.runRules('phase')
    }
  }

  /**
   * Advance to the next time `phase` begins: always at least one phase forward, so
   * a whole day when it's already that phase. With `stay` (`advance until`), do
   * nothing when it's already that phase.
   */
  advanceTo(phase: string, stay = false): void {
    const phases = this.data.state.time.phases
    const target = phases.indexOf(phase)
    if (target < 0) return
    if (target === this.phaseIndex) {
      if (stay) return
      this.onFullDay?.(phase)
    }
    this.advance(((target - this.phaseIndex + phases.length - 1) % phases.length) + 1)
  }

  private runRules(trigger: 'day' | 'phase'): void {
    for (const rule of this.data.state.rules) {
      if (rule.trigger !== trigger) continue
      if (rule.flow && rule.flow !== this.playing) continue
      if (trigger === 'phase' && rule.phase && rule.phase !== this.phase) continue
      const selves = rule.forEach
        ? Object.keys(this.data.entities)
            .filter((name) => this.data.entities[name].template === rule.forEach)
            .sort((a, b) => (this.data.entities[a].id < this.data.entities[b].id ? -1 : 1))
        : [undefined]
      for (const self of selves) {
        if (!this.check(rule.when, self)) continue
        this.run(rule.effects, self)
        this.log.push(`Rule “${rule.name}”${self ? ` for ${self}` : ''}`)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Flows

export interface Choice {
  index: number
  node: string
  /** What to show the player: the target's choice text, its line, or a hub's label. */
  text: string
}

export type Beat =
  /** A dialogue line. One choice means "continue"; several mean the player picks. */
  | { kind: 'line'; node: ExportNode & { type: 'dialogue' }; speaker: string | null; text: string; choices: Choice[] }
  /** A hub with several available paths: the player picks. */
  | { kind: 'choice'; node: ExportNode; choices: Choice[] }
  | { kind: 'end'; node: ExportNode | null }

const MAX_AUTO_STEPS = 10_000
/** How deeply Call nodes may nest before the story gives up (a flow that calls itself forever). */
export const MAX_CALL_DEPTH = 100

export class SkeinStory {
  /** The flow being played right now: changes when a jump hands off to another flow or a Call node runs one. */
  flow: ExportFlow
  current: ExportNode | null = null
  private pending: Choice[] = []
  /** v2: Call nodes waiting for the flow they started to end: where to come back to. */
  readonly calls: { flow: ExportFlow; node: ExportNode }[] = []
  /** Optional observer: called for every node the story enters, including ones it passes through automatically. */
  onEnter?: (node: ExportNode) => void

  constructor(
    readonly world: SkeinWorld,
    flowId: string
  ) {
    const flow = world.data.flows[flowId] ?? Object.values(world.data.flows).find((f) => f.name === flowId)
    if (!flow) throw new Error(`No flow “${flowId}” in this export.`)
    this.flow = flow
  }

  /** Begin at the first available start node (or a given node). */
  start(nodeId?: string): Beat {
    this.world.playing = this.flow.id
    const id = nodeId ?? this.firstStart()
    return id ? this.enter(id) : this.end(null)
  }

  private firstStart(): string | null {
    return this.flow.start.find((s) => this.available(s)) ?? null
  }

  /** Switch to playing another flow (a hand-off or a call); returns its first available start. */
  private switchTo(flowId: string): string | null {
    const flow = this.world.data.flows[flowId]
    if (!flow) return null
    this.flow = flow
    this.world.playing = flow.id
    return this.firstStart()
  }

  /**
   * The current flow has run out at `node`. Inside a called flow, return to the
   * Call node and continue after it; otherwise the story ends.
   */
  private finish(node: ExportNode | null): { beat: Beat } | { next: string } {
    let last = node
    for (;;) {
      const frame = this.calls.pop()
      if (!frame) return { beat: this.end(last) }
      this.flow = frame.flow
      this.world.playing = frame.flow.id
      const next = (frame.node as { next: string[] }).next.find((n) => this.available(n))
      if (next) return { next }
      last = frame.node
    }
  }

  /** Pick one of the current beat's choices (0 to continue after a single-choice line). */
  choose(index = 0): Beat {
    const choice = this.pending[index]
    if (!choice) {
      // Nothing follows: the flow ends here (or, inside a Call, the story goes back to the caller).
      const f = this.finish(this.current)
      return 'beat' in f ? f.beat : this.enter(f.next)
    }
    this.world.playing = this.flow.id
    return this.enter(choice.node)
  }

  /** A node is available when it exists and its requirement holds. */
  available(id: string | null | undefined): id is string {
    const node = id ? this.flow.nodes[id] : undefined
    return Boolean(node) && this.world.check(node!.requires)
  }

  private choices(ids: string[]): Choice[] {
    return ids.filter((id) => this.available(id)).map((id, index) => ({ index, node: id, text: this.label(id) }))
  }

  private label(id: string): string {
    const n = this.flow.nodes[id]
    if (n.type === 'dialogue') return n.menuText || n.text
    if (n.type === 'hub') return n.label
    return ''
  }

  private end(node: ExportNode | null): Beat {
    this.pending = []
    if (this.world.playing === this.flow.id) this.world.playing = null
    return { kind: 'end', node }
  }

  /**
   * Enter a node: apply its effects, then either stop to show something
   * (a line, or a choice at a hub) or follow it automatically
   * (conditions, instructions, single-path hubs, jumps).
   */
  private enter(start: string): Beat {
    let id: string | null = start
    for (let steps = 0; steps < MAX_AUTO_STEPS; steps++) {
      if (!this.available(id)) {
        const f = this.finish(this.current)
        if ('beat' in f) return f.beat
        id = f.next
        continue
      }
      const node: ExportNode = this.flow.nodes[id]
      this.current = node
      if (node.count) this.world.countVisit(node.id)
      this.onEnter?.(node)
      // v3: the activity takes its time first (rules may run), then its effects apply.
      if (node.takes) this.world.pass(node.takes)
      this.world.run(node.effects)
      switch (node.type) {
        case 'dialogue':
          this.pending = this.choices(node.next)
          return { kind: 'line', node, speaker: node.speaker, text: node.text, choices: this.pending }
        case 'condition':
          id = this.world.check(node.condition) ? node.onTrue : node.onFalse
          break
        case 'instruction':
          this.world.run(node.instruction)
          id = node.next.find((n) => this.available(n)) ?? null
          break
        case 'hub': {
          const options = this.choices(node.next)
          if (options.length > 1) {
            this.pending = options
            return { kind: 'choice', node, choices: options }
          }
          id = options[0]?.node ?? null
          break
        }
        case 'jump':
          id = node.jumpFlow ? this.switchTo(node.jumpFlow) : node.jumpTo
          break
        case 'call':
          if (node.flow && this.world.data.flows[node.flow]) {
            if (this.calls.length >= MAX_CALL_DEPTH) throw new Error(`Call nodes nested ${MAX_CALL_DEPTH} deep: check for flows that call each other in a loop.`)
            this.calls.push({ flow: this.flow, node })
            id = this.switchTo(node.flow)
          } else id = node.next.find((n) => this.available(n)) ?? null
          break
      }
      if (id === null) {
        const f = this.finish(node)
        if ('beat' in f) return f.beat
        id = f.next
      }
    }
    throw new Error('The flow ran 10,000 automatic steps without reaching a line: check for a loop of conditions, jumps or hubs.')
  }
}
