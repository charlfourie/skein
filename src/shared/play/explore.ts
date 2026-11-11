/**
 * Path explorer: plays every sequence of player choices through a flow, from
 * one or more starting states, with the reference runtime (the same rules the
 * game follows), and reports what can happen.
 *
 *   - endings reached, and where the story stops at a node not marked End
 *   - nodes no path ever reaches
 *   - errors (automatic-step loops) and player loops that never end
 *   - the range every number ends up in, against its definition's min/max
 *
 * Every path is replayed from the start (no snapshotting), which keeps the
 * explorer independent of runtime internals; flows of a few hundred nodes
 * explore tens of thousands of paths per second.
 */
import { outcomesOf, SkeinStory, SkeinWorld, weightOf, type Draw } from '../export/runtime'
import type { ExportFile, ExportNode, ExportValue, StatePath } from '../export/types'

/** A piece of state by its runtime key: "var:World.Storm", "prop:Keeper.Mood", "rel:<rel>:<from>:<to>". */
export type StateKey = string

export interface StartState {
  values?: Record<StateKey, ExportValue>
  day?: number
  /** Phase technical name. */
  phase?: string | null
  /** Seed for chance() and roll() in Play (Explore tries every outcome instead). */
  seed?: number
}

export interface Variation {
  key: StateKey
  values: ExportValue[]
}

export interface ExploreOptions {
  flowId: string
  start?: StartState
  /** Every combination of these values is used as a separate starting state. */
  vary?: Variation[]
  /** Stop after this many complete paths (default 20,000). */
  maxPaths?: number
  /** A path longer than this many beats counts as a loop the player can't leave (default 200). */
  maxBeats?: number
  /** Called every so often with the number of paths explored. */
  onProgress?: (paths: number) => void
  /** Called for every path that reaches an end, with the world as it ended (story tests check it). */
  onEnding?: (world: SkeinWorld, node: ExportNode | null, example: PathExample) => void
}

/** Enough to replay a path: its starting state and the pick at each decision (a choice, or a chance()/roll() outcome, in the order they happened). */
export interface PathExample {
  start: Record<StateKey, ExportValue>
  picks: number[]
  /** What each pick was, for people: a choice's text, or e.g. "🎲 chance 30% → yes". */
  choices: string[]
}

export interface Ending {
  /** The last node reached (null if the flow couldn't start at all). */
  nodeId: string | null
  text: string
  /** The node is marked End. Unmarked stops are usually an oversight. */
  marked: boolean
  count: number
  /** The paths' combined probability: each choice path counts 1, split across chance()/roll() outcomes. */
  weight: number
  example: PathExample
}

export interface NumberRange {
  key: StateKey
  label: string
  /** Lowest and highest value at the end of a path. */
  min: number
  max: number
  /** Lowest and highest value at any point along any path (including the start). */
  low: number
  high: number
  /** Share of paths (by weight) where a change was cut short at the minimum / maximum. */
  cappedLow: number
  cappedHigh: number
  defMin?: number
  defMax?: number
}

export interface ExploreReport {
  flowName: string
  starts: number
  paths: number
  /** Total weight of the paths that ended (see Ending.weight); endings' shares are weight / this. */
  weight: number
  /** Some path rolled dice (chance or roll), so shares are weighted by probability. */
  random: boolean
  capped: boolean
  endings: Ending[]
  errors: { message: string; count: number; example: PathExample }[]
  stuck: { count: number; example: PathExample } | null
  visited: string[]
  unreached: string[]
  ranges: NumberRange[]
  times: { label: string; count: number }[]
  longest: (PathExample & { beats: number }) | null
  /** `advance to X` reached while it was already X, so time jumped a whole day: per node and phase. */
  fullDays: { nodeId: string | null; phase: string; count: number; example: PathExample }[]
}

export function pathFromKey(key: StateKey): StatePath | null {
  const i = key.indexOf(':')
  const kind = key.slice(0, i)
  const rest = key.slice(i + 1)
  if (kind === 'var') return { get: 'var', var: rest }
  if (kind === 'prop') {
    const dot = rest.indexOf('.')
    return dot > 0 ? { get: 'prop', entity: rest.slice(0, dot), prop: rest.slice(dot + 1) } : null
  }
  if (kind === 'rel') {
    // rel:<relationship key>:<from>:<to>; relationship keys contain no ':'.
    const parts = rest.split(':')
    return parts.length === 3 ? { get: 'rel', rel: parts[0], from: parts[1], to: parts[2] } : null
  }
  if (kind === 'visit') return { get: 'visit', node: rest }
  return null
}

/** Node tags in an export, by node id (for labelling visit counts). */
export function tagsOf(file: ExportFile): Map<string, string> {
  const out = new Map<string, string>()
  for (const f of Object.values(file.flows)) for (const n of Object.values(f.nodes)) if (n.tag) out.set(n.id, n.tag)
  return out
}

/** A readable name for a state key, e.g. "Keeper → Stranger Trust". */
export function labelForKey(key: StateKey, tags?: Map<string, string>): string {
  const p = pathFromKey(key)
  if (!p) return key
  if (p.get === 'visit') return `Visits.${tags?.get(p.node) ?? p.node.slice(0, 8)}`
  if (p.get === 'var') return p.var
  if (p.get === 'prop') return `${p.entity}.${p.prop}`
  if (p.get === 'rel') return `${p.from} → ${p.to} ${p.rel.split('.').pop()}`
  return key
}

/** Apply a starting state to a fresh world. */
export function applyStart(world: SkeinWorld, start: StartState | undefined, extra: Record<StateKey, ExportValue> = {}): void {
  if (start?.day !== undefined) world.day = start.day
  if (start?.seed !== undefined) world.rng = start.seed >>> 0
  if (start?.phase) {
    const i = world.data.state.time.phases.indexOf(start.phase)
    if (i >= 0) world.phaseIndex = i
  }
  for (const [key, value] of Object.entries({ ...(start?.values ?? {}), ...extra })) {
    const path = pathFromKey(key)
    if (path) world.write(path, value)
  }
  world.log.length = 0
}

function combinations(vary: Variation[]): Record<StateKey, ExportValue>[] {
  let out: Record<StateKey, ExportValue>[] = [{}]
  for (const v of vary) {
    if (!v.values.length) continue
    const next: Record<StateKey, ExportValue>[] = []
    for (const base of out) for (const value of v.values) next.push({ ...base, [v.key]: value })
    out = next
  }
  return out
}

function nodeText(node: ExportNode | null | undefined): string {
  if (!node) return '(the flow could not start: no start node is available)'
  if (node.type === 'dialogue') return node.text || node.menuText || '(empty line)'
  if (node.type === 'hub') return node.label || '(hub)'
  return `(${node.type})`
}

interface Played {
  branching: number | null
  ending?: { node: ExportNode | null }
  error?: string
  stuck?: boolean
  choices: string[]
  beats: number
  world: SkeinWorld
  fullDays: { nodeId: string | null; phase: string }[]
  weight: number
  random: boolean
  /** Values written along the path, and changes cut short by a min ("low") or max ("high"). */
  seen: Map<StateKey, { low: number; high: number }>
  capped: Set<string>
}

/** Thrown from inside the runtime when a draw needs a pick that isn't in the list yet. */
class NeedPick {
  constructor(readonly outcomes: number) {}
}

/** A readable label for a draw's outcome. */
export function drawLabel(d: Draw, k: number): string {
  return d.kind === 'chance' ? `🎲 chance ${d.p}% → ${k === 0 ? 'yes' : 'no'}` : `🎲 roll ${d.min}–${d.max} → ${d.min + k}`
}

function play(file: ExportFile, opts: ExploreOptions, startExtra: Record<StateKey, ExportValue>, picks: number[], visited: Set<string>): Played {
  const world = new SkeinWorld(file)
  applyStart(world, opts.start, startExtra)
  const story = new SkeinStory(world, opts.flowId)
  story.onEnter = (n) => visited.add(n.id)
  const fullDays: Played['fullDays'] = []
  const seen: Played['seen'] = new Map()
  const capped: Played['capped'] = new Set()
  world.onWrite = (key, stored, asked, before) => {
    if (typeof stored !== 'number') return
    const r = seen.get(key)
    if (!r) {
      const b = typeof before === 'number' ? before : stored
      seen.set(key, { low: Math.min(b, stored), high: Math.max(b, stored) })
    } else {
      if (stored < r.low) r.low = stored
      if (stored > r.high) r.high = stored
    }
    if (typeof asked === 'number' && Math.round(asked * 1e9) !== Math.round(stored * 1e9)) {
      const def = world.definition(pathFromKey(key)!)
      if (def?.min !== undefined && stored === def.min && asked < def.min) capped.add(`${key}|low`)
      if (def?.max !== undefined && stored === def.max && asked > def.max) capped.add(`${key}|high`)
    }
  }
  world.onFullDay = (phase) => fullDays.push({ nodeId: story.current?.id ?? null, phase })
  const choices: string[] = []
  const maxBeats = opts.maxBeats ?? 200
  let beats = 0
  let weight = 1
  let random = false
  let i = 0
  world.decide = (d) => {
    random = true
    if (i >= picks.length) throw new NeedPick(outcomesOf(d))
    const k = picks[i++]
    weight *= weightOf(d, k)
    choices.push(drawLabel(d, k))
    return k
  }
  const done = (r: Omit<Played, 'choices' | 'beats' | 'world' | 'fullDays' | 'weight' | 'random' | 'seen' | 'capped'>): Played => ({
    ...r,
    choices,
    beats,
    world,
    fullDays,
    weight,
    random,
    seen,
    capped
  })
  try {
    let beat = story.start()
    while (beat.kind !== 'end') {
      if (++beats > maxBeats) return done({ branching: null, stuck: true })
      if (beat.choices.length > 1) {
        if (i >= picks.length) return done({ branching: beat.choices.length })
        const c = beat.choices[picks[i++]]
        choices.push(c.text)
        beat = story.choose(c.index)
      } else {
        beat = story.choose(0)
      }
    }
    return done({ branching: null, ending: { node: beat.node } })
  } catch (err) {
    if (err instanceof NeedPick) return done({ branching: err.outcomes })
    return done({ branching: null, error: err instanceof Error ? err.message : String(err) })
  }
}

export function explore(file: ExportFile, opts: ExploreOptions): ExploreReport {
  const flow = file.flows[opts.flowId]
  if (!flow) throw new Error(`No flow ${opts.flowId}`)
  const maxPaths = opts.maxPaths ?? 20000
  const starts = combinations(opts.vary ?? [])
  const visited = new Set<string>()
  const endings = new Map<string, Ending>()
  const errors = new Map<string, { message: string; count: number; example: PathExample }>()
  let stuck: ExploreReport['stuck'] = null
  const times = new Map<string, number>()
  const ranges = new Map<StateKey, { min: number; max: number; low: number; high: number; cappedLow: number; cappedHigh: number }>()
  let longest: ExploreReport['longest'] = null
  const fullDays = new Map<string, ExploreReport['fullDays'][number]>()
  let paths = 0
  let totalWeight = 0
  let anyRandom = false
  let capped = false

  const tags = tagsOf(file)
  const numericVars = Object.entries(file.state.variables)
    .filter(([, d]) => d.type === 'number')
    .map(([k]) => `var:${k}`)

  const record = (startExtra: Record<StateKey, ExportValue>, picks: number[], r: Played) => {
    paths++
    const example: PathExample = { start: startExtra, picks: [...picks], choices: r.choices }
    if (r.random) anyRandom = true
    for (const k of new Set(r.fullDays.map((f) => `${f.nodeId ?? '-'}|${f.phase}`))) {
      const [nodeId, phase] = k.split('|')
      const e = fullDays.get(k) ?? { nodeId: nodeId === '-' ? null : nodeId, phase, count: 0, example }
      e.count++
      fullDays.set(k, e)
    }
    if (r.error) {
      const e = errors.get(r.error) ?? { message: r.error, count: 0, example }
      e.count++
      errors.set(r.error, e)
      return
    }
    if (r.stuck) {
      stuck = stuck ? { ...stuck, count: stuck.count + 1 } : { count: 1, example }
      return
    }
    const node = r.ending?.node ?? null
    opts.onEnding?.(r.world, node, example)
    const key = node?.id ?? '-'
    const ending = endings.get(key) ?? { nodeId: node?.id ?? null, text: nodeText(node), marked: node?.end === true, count: 0, weight: 0, example }
    ending.count++
    ending.weight += r.weight
    totalWeight += r.weight
    endings.set(key, ending)
    const w = r.world
    const t = `Day ${w.day}${w.phase ? `, ${w.phase}` : ''}`
    times.set(t, (times.get(t) ?? 0) + 1)
    const keys = new Set([...numericVars, ...[...w.changes.keys()].filter((k) => typeof w.changes.get(k) === 'number')])
    for (const k of keys) {
      const path = pathFromKey(k)
      if (!path) continue
      const v = w.read(path)
      if (typeof v !== 'number') continue
      const s = r.seen.get(k)
      const low = Math.min(v, s?.low ?? v)
      const high = Math.max(v, s?.high ?? v)
      const range = ranges.get(k)
      const cl = r.capped.has(`${k}|low`) ? r.weight : 0
      const ch = r.capped.has(`${k}|high`) ? r.weight : 0
      if (!range) ranges.set(k, { min: v, max: v, low, high, cappedLow: cl, cappedHigh: ch })
      else {
        if (v < range.min) range.min = v
        if (v > range.max) range.max = v
        if (low < range.low) range.low = low
        if (high > range.high) range.high = high
        range.cappedLow += cl
        range.cappedHigh += ch
      }
    }
    if (!longest || r.beats > longest.beats) longest = { ...example, beats: r.beats }
  }

  outer: for (const startExtra of starts) {
    const stack: number[][] = [[]]
    while (stack.length) {
      const picks = stack.pop()!
      const r = play(file, opts, startExtra, picks, visited)
      if (r.branching !== null) {
        for (let k = r.branching - 1; k >= 0; k--) stack.push([...picks, k])
        continue
      }
      record(startExtra, picks, r)
      if (opts.onProgress && paths % 500 === 0) opts.onProgress(paths)
      if (paths >= maxPaths) {
        capped = stack.length > 0 || startExtra !== starts[starts.length - 1]
        break outer
      }
    }
  }

  const definition = (k: StateKey) => {
    const p = pathFromKey(k)
    if (!p) return undefined
    if (p.get === 'var') return file.state.variables[p.var]
    if (p.get === 'rel') return file.state.relationships[p.rel]
    if (p.get === 'prop') {
      const e = file.entities[p.entity]
      return e ? file.templates[e.template]?.properties[p.prop] : undefined
    }
    return undefined
  }

  return {
    flowName: flow.name,
    starts: starts.length,
    paths,
    weight: totalWeight,
    random: anyRandom,
    capped,
    endings: [...endings.values()].sort((a, b) => b.weight - a.weight || b.count - a.count),
    errors: [...errors.values()].sort((a, b) => b.count - a.count),
    stuck,
    visited: [...visited].sort(),
    unreached: Object.keys(flow.nodes).filter((id) => !visited.has(id)).sort(),
    ranges: [...ranges.entries()]
      .map(([key, r]) => {
        const d = definition(key)
        return {
          key,
          label: labelForKey(key, tags),
          min: r.min,
          max: r.max,
          low: r.low,
          high: r.high,
          cappedLow: totalWeight ? r.cappedLow / totalWeight : 0,
          cappedHigh: totalWeight ? r.cappedHigh / totalWeight : 0,
          ...(d?.min !== undefined ? { defMin: d.min } : {}),
          ...(d?.max !== undefined ? { defMax: d.max } : {})
        }
      })
      .sort((a, b) => a.label.localeCompare(b.label)),
    times: [...times.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    longest,
    fullDays: [...fullDays.values()].sort((a, b) => b.count - a.count)
  }
}
