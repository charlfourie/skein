/**
 * Story tests: saved checks that a flow still plays the way the designer meant.
 *
 *   - play: follow a recorded route (choices by the node they lead to, dice by
 *     outcome) from a scenario, and check where the story stops and what's true there.
 *   - explore: play every path from a scenario (with the explorer) and check that
 *     every path ends, every node is reached, given endings are reachable, and
 *     some conditions hold at the end of every path.
 *
 * Tests run on the game export with the reference runtime, so a passing test
 * means the game does what the test says. Everything a test refers to is by id
 * (flows, nodes, scenarios) or by expression (setup, checks): when one of those
 * goes away, the test says so plainly instead of passing or failing obscurely.
 */
import { buildExport, type ExportResult } from '../export/build'
import { SkeinStory, SkeinWorld, outcomesOf, type Beat, type Draw } from '../export/runtime'
import type { ExportFile, ExportNode, ExportValue, ExprNode, StatePath, Statement } from '../export/types'
import { CHECKS_CTX, SETUP_CTX } from '../expr/sites'
import type { Project, RouteStep, Scenario, StoryTest } from '../schema'
import { toTechnicalName } from '../technicalName'
import { applyStart, explore, labelForKey, tagsOf, type PathExample, type StartState } from './explore'

export type TestStatus = 'pass' | 'fail' | 'broken'

export interface TestFailure {
  message: string
  /** The node it concerns, for the editor to show. */
  nodeId?: string
  /** A path that shows the failure (explore tests), for Replay. */
  example?: PathExample
}

export interface TestResult {
  testId: string
  name: string
  flowId: string
  status: TestStatus
  /** Empty when the test passes. `broken`: the test itself can't run as written. */
  failures: TestFailure[]
  /** play: where the story stopped. */
  stop?: Stop
  /** explore: how many paths were played. */
  paths?: number
}

export interface Stop {
  /** The last node reached (null: the flow couldn't start). */
  nodeId: string | null
  /** True when the story ended there; false when it waits at a choice. */
  ended: boolean
}

export interface RunOptions {
  /** Reuse an export already built from this project. */
  build?: ExportResult
  /** Only run these tests. */
  testIds?: string[]
  /** Explore tests stop after this many paths (default 20,000). */
  maxPaths?: number
}

/** Tests in the order they're listed (order, then name, then id). */
export function sortedTests(project: Project): StoryTest[] {
  return Object.values(project.tests ?? {}).sort(byOrder)
}

export function sortedScenarios(project: Project): Scenario[] {
  return Object.values(project.scenarios ?? {}).sort(byOrder)
}

function byOrder<T extends { order: number; name: string; id: string }>(a: T, b: T): number {
  return a.order - b.order || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1)
}

/** Run a project's story tests. Pure and deterministic: same project, same results. */
export function runStoryTests(project: Project, options: RunOptions = {}): TestResult[] {
  const build = options.build ?? buildExport(project, { includeSource: false })
  const only = options.testIds ? new Set(options.testIds) : null
  return sortedTests(project)
    .filter((t) => !only || only.has(t.id))
    .map((t) => runStoryTest(project, build, t, options))
}

export function runStoryTest(project: Project, build: ExportResult, test: StoryTest, options: RunOptions = {}): TestResult {
  const base = { testId: test.id, name: test.name, flowId: test.flowId }
  const broken = (message: string): TestResult => ({ ...base, status: 'broken', failures: [{ message }] })

  if (!build.file.flows[test.flowId]) return broken('The flow it tests no longer exists.')
  const start = scenarioStart(project, build, test.scenarioId)
  if (!start.ok) return broken(start.message)
  const checks = compileChecks(build, test.checks)
  if (!checks.ok) return broken(checks.message)

  if (test.kind === 'play') {
    const run = playRoute(build.file, test.flowId, start.start, test.route ?? [])
    const failures: TestFailure[] = [...run.failures]
    if (!run.failures.length) {
      const expected = { nodeId: test.stopsAt ?? null, ended: test.ends ?? true }
      if (expected.nodeId !== run.stop.nodeId || expected.ended !== run.stop.ended) {
        failures.push({
          message: `It should ${stopText(build.file, expected, false)}, but now it ${stopText(build.file, run.stop, true)}.`,
          ...(run.stop.nodeId ? { nodeId: run.stop.nodeId } : {})
        })
      }
      for (const c of checks.list) {
        const v = run.world.evaluate(c.expr)
        if (v !== true) failures.push({ message: `“${c.source}” is ${describe(v)}${valuesIn(run.world, c.expr)}.` })
      }
    }
    return { ...base, status: failures.length ? 'fail' : 'pass', failures, stop: run.stop }
  }

  // explore
  const failing = checks.list.map(() => ({ count: 0, example: undefined as PathExample | undefined, values: '' }))
  const report = explore(build.file, {
    flowId: test.flowId,
    start: start.start,
    maxPaths: options.maxPaths ?? 20000,
    onEnding: (world, _node, example) => {
      checks.list.forEach((c, i) => {
        if (world.evaluate(c.expr) === true) return
        const f = failing[i]
        if (f.count++ === 0) {
          f.example = example
          f.values = valuesIn(world, c.expr)
        }
      })
    }
  })
  const failures: TestFailure[] = []
  const paths = report.paths
  if (report.capped) {
    failures.push({ message: `The flow has more than ${paths.toLocaleString('en')} paths from this start, so the test can't check them all. Test from a narrower scenario.` })
  }
  if (test.allEnd) {
    for (const e of report.errors) failures.push({ message: `${count(e.count, 'path')} hit an error: ${e.message}`, example: e.example })
    if (report.stuck) failures.push({ message: `${count(report.stuck.count, 'path')} never end (a loop the player can't leave).`, example: report.stuck.example })
    for (const e of report.endings) {
      if (e.marked) continue
      if (e.nodeId === null) failures.push({ message: `${count(e.count, 'path')} can't start: no start node is available.`, example: e.example })
      else failures.push({ message: `${count(e.count, 'path')} stop at ${nodeLabel(build.file, e.nodeId)}, which isn't marked End.`, nodeId: e.nodeId, example: e.example })
    }
  }
  if (test.allReached && !report.capped && report.unreached.length) {
    const shown = report.unreached.slice(0, 3).map((id) => nodeLabel(build.file, id))
    const more = report.unreached.length > shown.length ? ` and ${report.unreached.length - shown.length} more` : ''
    failures.push({ message: `No path reaches ${shown.join(', ')}${more}.`, nodeId: report.unreached[0] })
  }
  let deleted = false
  for (const id of test.reach ?? []) {
    if (!findNode(build.file, id)) {
      deleted = true
      failures.push({ message: 'An ending it expects to reach was deleted. Edit the test.' })
      continue
    }
    if (report.capped) continue
    if (!report.endings.some((e) => e.nodeId === id)) failures.push({ message: `No path ends at ${nodeLabel(build.file, id)}.`, nodeId: id })
  }
  checks.list.forEach((c, i) => {
    const f = failing[i]
    if (f.count) failures.push({ message: `“${c.source}” isn't true at the end of ${f.count.toLocaleString('en')} of ${count(paths, 'path')}${f.values}.`, ...(f.example ? { example: f.example } : {}) })
  })
  if (deleted) return { ...base, status: 'broken', failures, paths }
  return { ...base, status: failures.length ? 'fail' : 'pass', failures, paths }
}

// ---------------------------------------------------------------------------
// Scenarios

/**
 * The starting state a scenario describes: its day and phase, its seed, and
 * the values its setup leaves behind. Null: the project's own starting state.
 */
export function scenarioStart(project: Project, build: ExportResult, scenarioId: string | null | undefined): { ok: true; start: StartState } | { ok: false; message: string } {
  if (!scenarioId) return { ok: true, start: {} }
  const sc = project.scenarios?.[scenarioId]
  if (!sc) return { ok: false, message: 'The scenario it starts from was deleted.' }
  return startFromScenario(project, build, sc)
}

export function startFromScenario(project: Project, build: ExportResult, sc: Scenario): { ok: true; start: StartState } | { ok: false; message: string } {
  const setup = compileSetup(build, sc.setup)
  if (!setup.ok) return { ok: false, message: `Scenario “${sc.name}”: ${setup.message}` }
  const phase = sc.phaseId ? project.state.time.phases[sc.phaseId] : undefined
  const time: StartState = {
    ...(sc.day !== undefined ? { day: sc.day } : {}),
    ...(phase ? { phase: phase.technicalName || toTechnicalName(phase.label) } : {})
  }
  const world = new SkeinWorld(build.file)
  applyStart(world, time)
  try {
    for (const s of setup.statements) world.execute(s)
  } catch (err) {
    return { ok: false, message: `Scenario “${sc.name}”: ${err instanceof Error ? err.message : String(err)}` }
  }
  const values: Record<string, ExportValue> = {}
  for (const [k, v] of world.changes) if (!k.startsWith('visit:')) values[k] = v
  return { ok: true, start: { ...time, values, ...(sc.seed !== undefined ? { seed: sc.seed } : {}) } }
}

export function compileSetup(build: ExportResult, source: string): { ok: true; statements: Statement[] } | { ok: false; message: string } {
  if (!source.trim()) return { ok: true, statements: [] }
  const r = build.compileEffects(source, SETUP_CTX)
  return r.ok ? r : { ok: false, message: `setup: ${r.message}` }
}

export interface CompiledCheck {
  source: string
  expr: ExprNode
}

/** Checks are conditions, one per line. Blank lines and `#` comments are skipped. */
export function compileChecks(build: ExportResult, source: string): { ok: true; list: CompiledCheck[] } | { ok: false; message: string } {
  const list: CompiledCheck[] = []
  for (const raw of source.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const r = build.compileCondition(line, CHECKS_CTX)
    if (!r.ok) return { ok: false, message: `Check “${line}”: ${r.message}` }
    list.push({ source: line, expr: r.expr })
  }
  return { ok: true, list }
}

// ---------------------------------------------------------------------------
// Following a route

export interface RouteRun {
  world: SkeinWorld
  stop: Stop
  /** Why the route couldn't be followed (empty when it could). */
  failures: TestFailure[]
}

class Mismatch extends Error {
  constructor(
    message: string,
    readonly nodeId?: string
  ) {
    super(message)
  }
}

/**
 * Play a flow along a recorded route. Single-choice beats continue on their
 * own (as Explore does); every real choice and every dice roll takes the
 * route's next step. Stops when the story ends, or when it reaches a choice
 * after the route is used up.
 */
export function playRoute(file: ExportFile, flowId: string, start: StartState, route: RouteStep[]): RouteRun {
  const world = new SkeinWorld(file)
  applyStart(world, start)
  const story = new SkeinStory(world, flowId)
  const failures: TestFailure[] = []
  let i = 0
  world.decide = (d: Draw) => {
    const step = route[i]
    if (!step) throw new Mismatch(`The story now rolls dice (${drawText(d)}) after the recorded route ends.`)
    if (!('dice' in step)) throw new Mismatch(`The story now rolls dice (${drawText(d)}) where the test expected the choice ${nodeLabel(file, step.choose)}.`)
    if (step.dice >= outcomesOf(d)) throw new Mismatch(`The dice roll (${drawText(d)}) no longer has the outcome the test recorded.`)
    i++
    return step.dice
  }
  let beat: Beat = { kind: 'end', node: null }
  try {
    beat = story.start()
    for (let guard = 0; guard < 10_000 && beat.kind !== 'end'; guard++) {
      if (beat.choices.length > 1) {
        const step = route[i]
        if (!step) break // route used up: stop at this choice
        if ('dice' in step) throw new Mismatch(`At ${nodeLabel(file, beat.node.id)} the story now offers a choice where the test expected a dice roll.`)
        const choice = beat.choices.find((c) => c.node === step.choose)
        if (!choice) {
          const offered = beat.choices.map((c) => `“${short(c.text)}”`).join(', ')
          const why = !findNode(file, step.choose) ? 'the choice the test picked was deleted' : `${nodeLabel(file, step.choose)} isn't offered any more`
          throw new Mismatch(`At ${nodeLabel(file, beat.node.id)}, ${why}. Offered now: ${offered}.`, beat.node.id)
        }
        i++
        beat = story.choose(choice.index)
      } else beat = story.choose(0)
    }
  } catch (err) {
    const at = story.current?.id
    if (err instanceof Mismatch) failures.push({ message: err.message, ...((err.nodeId ?? at) ? { nodeId: err.nodeId ?? at } : {}) })
    else failures.push({ message: `The story hit an error: ${err instanceof Error ? err.message : String(err)}`, ...(at ? { nodeId: at } : {}) })
    return { world, stop: { nodeId: story.current?.id ?? null, ended: false }, failures }
  }
  world.decide = undefined
  const stop: Stop = { nodeId: beat.node?.id ?? null, ended: beat.kind === 'end' }
  if (i < route.length) {
    const left = route.length - i
    failures.push({
      message: `The story ${stop.ended ? 'now ends' : 'now stops'} at ${nodeLabel(file, stop.nodeId)} before the last ${count(left, 'recorded step')}.`,
      ...(stop.nodeId ? { nodeId: stop.nodeId } : {})
    })
  }
  return { world, stop, failures }
}

// ---------------------------------------------------------------------------
// Wording

function findNode(file: ExportFile, id: string): ExportNode | undefined {
  for (const f of Object.values(file.flows)) if (f.nodes[id]) return f.nodes[id]
  return undefined
}

/** “Line text”, (hub label), or "a deleted node". */
export function nodeLabel(file: ExportFile, id: string | null): string {
  if (!id) return 'the start'
  const n = findNode(file, id)
  if (!n) return 'a node that was deleted'
  if (n.type === 'dialogue') return `“${short(n.menuText || n.text || '(empty line)')}”`
  if (n.type === 'hub') return n.label ? `the hub “${short(n.label)}”` : 'a hub'
  return `a ${n.type} node`
}

/** "end at “…”" (should) or "ends at “…”" (now). */
function stopText(file: ExportFile, s: Stop, now: boolean): string {
  const v = (base: string, third: string) => (now ? third : base)
  if (!s.nodeId) return s.ended ? v("not start at all", "doesn't start at all") : v('stop at the start', 'stops at the start')
  return s.ended ? `${v('end', 'ends')} at ${nodeLabel(file, s.nodeId)}` : `${v('wait', 'waits')} for a choice at ${nodeLabel(file, s.nodeId)}`
}

function short(text: string, max = 60): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function count(n: number, noun: string): string {
  return `${n.toLocaleString('en')} ${noun}${n === 1 ? '' : 's'}`
}

function drawText(d: Draw): string {
  return d.kind === 'chance' ? `chance ${d.p}%` : `roll ${d.min}–${d.max}`
}

function describe(v: ExportValue): string {
  return v === false ? 'false' : `not true/false (it's ${v === null ? 'empty' : JSON.stringify(v)})`
}

/** " (Player.Coins is 3, Time.Day is 2)": the state a check reads, as it was. */
function valuesIn(world: SkeinWorld, e: ExprNode): string {
  const paths: StatePath[] = []
  const walk = (x: ExprNode) => {
    if ('get' in x) paths.push(x)
    else if ('not' in x) walk(x.not)
    else if ('neg' in x) walk(x.neg)
    else if ('op' in x) {
      walk(x.a)
      walk(x.b)
    }
  }
  walk(e)
  const tags = tagsOf(world.data)
  const seen = new Set<string>()
  const parts: string[] = []
  for (const p of paths) {
    const key = SkeinWorld.key(p)
    if (seen.has(key)) continue
    seen.add(key)
    const label = p.get === 'time' ? `Time.${p.field[0].toUpperCase()}${p.field.slice(1)}` : labelForKey(key, tags)
    const v = world.read(p)
    parts.push(`${label} is ${v === null ? 'empty' : typeof v === 'string' ? v || '""' : String(v)}`)
  }
  return parts.length ? ` (${parts.slice(0, 4).join(', ')})` : ''
}
