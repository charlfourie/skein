import type { ExportResult } from '@shared/export/build'
import { SkeinWorld } from '@shared/export/runtime'
import type { ExportFile, ExportValue } from '@shared/export/types'
import { pathFromKey, type StartState, type StateKey } from '@shared/play/explore'
import { playRoute, startFromScenario } from '@shared/play/storyTests'
import type { Project, Scenario } from '@shared/schema'
import { toTechnicalName } from '@shared/technicalName'
import { addScenario, addTest } from '../store/ops'
import { usePlay } from '../store/play'
import type { PlaySession } from './playSession'

/** A state key as it's written in expressions: `World.Storm`, `Keeper.Mood`, `Keeper->Stranger.Trust`. */
export function keyToExpr(key: StateKey): string | null {
  const p = pathFromKey(key)
  if (!p) return null
  if (p.get === 'var') return p.var
  if (p.get === 'prop') return `${p.entity}.${p.prop}`
  if (p.get === 'rel') return `${p.from}->${p.to}.${p.rel.slice(p.rel.lastIndexOf('.') + 1)}`
  return null
}

/** A value as it's written in expressions. Null when the language can't write it (an empty reference). */
export function valueToExpr(file: ExportFile, key: StateKey, value: ExportValue): string | null {
  if (value === null) return null
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  const path = pathFromKey(key)
  const def = path ? new SkeinWorld(file).definition(path) : undefined
  // Options and entities are names; text is quoted.
  if ((def?.type === 'enum' || def?.type === 'entity') && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Setup actions that recreate these starting values, one per line, in a stable order. */
export function valuesToSetup(file: ExportFile, values: Record<StateKey, ExportValue>): { setup: string; skipped: string[] } {
  const lines: string[] = []
  const skipped: string[] = []
  for (const key of Object.keys(values).sort()) {
    const target = keyToExpr(key)
    const value = valueToExpr(file, key, values[key])
    if (target && value !== null) lines.push(`${target} = ${value}`)
    else if (target) skipped.push(target)
  }
  return { setup: lines.join('\n'), skipped }
}

/** Lines that check these values hold, for a new test: `Player.Coins == 1`. */
export function valuesToChecks(file: ExportFile, values: { key: StateKey; to: ExportValue }[], max = 8): string {
  const lines: string[] = []
  for (const { key, to } of values) {
    const target = keyToExpr(key)
    const value = valueToExpr(file, key, to)
    if (target && value !== null) lines.push(`${target} == ${value}`)
    if (lines.length >= max) break
  }
  return lines.join('\n')
}

/** The Start state tab's current settings, as the fields of a scenario. */
export function currentAsScenario(project: Project, file: ExportFile): { day?: number; phaseId?: string; seed?: number; setup: string; skipped: string[] } {
  const s = usePlay.getState()
  const phase = s.startPhase ? Object.values(project.state.time.phases).find((p) => (p.technicalName || toTechnicalName(p.label)) === s.startPhase) : undefined
  return {
    ...(s.startDay !== null ? { day: s.startDay } : {}),
    ...(phase ? { phaseId: phase.id } : {}),
    ...(s.seed !== null ? { seed: s.seed } : {}),
    ...valuesToSetup(file, s.overrides)
  }
}

/** Load a scenario into the Start state tab (null: back to the project's own start). */
export function loadScenario(project: Project, build: ExportResult, id: string | null): string | null {
  const play = usePlay.getState()
  if (!id) {
    play.resetStart()
    return null
  }
  const sc = project.scenarios?.[id]
  if (!sc) return 'That scenario no longer exists.'
  const r = startFromScenario(project, build, sc)
  if (!r.ok) return r.message
  usePlay.setState({
    overrides: r.start.values ?? {},
    startDay: r.start.day ?? null,
    startPhase: r.start.phase ?? null,
    seed: r.start.seed ?? null,
    scenarioId: id
  })
  return null
}

/** Whether the Start state tab still matches a scenario exactly (so a test can point at it). */
export function startMatches(project: Project, build: ExportResult, sc: Scenario, start: StartState): boolean {
  const r = startFromScenario(project, build, sc)
  if (!r.ok) return false
  return sameStart(r.start, start)
}

function sameStart(a: StartState, b: StartState): boolean {
  const va = a.values ?? {}
  const vb = b.values ?? {}
  const keys = new Set([...Object.keys(va), ...Object.keys(vb)])
  for (const k of keys) if (va[k] !== vb[k]) return false
  return (a.day ?? null) === (b.day ?? null) && (a.phase ?? null) === (b.phase ?? null)
}

/**
 * Save the current play-through as a story test: its start (an existing
 * scenario when it matches one, a new scenario when the start was changed, or
 * the project's own start), the route taken, where it stopped and the checks.
 */
export function saveSessionAsTest(
  project: Project,
  build: ExportResult,
  session: PlaySession,
  name: string,
  checks: string
): { ok: true; testId: string; newScenario: string | null } | { ok: false; message: string } {
  const start: StartState = {
    ...session.start,
    values: { ...(session.start.values ?? {}), ...session.extra }
  }
  const changed = Object.keys(start.values ?? {}).length > 0 || start.day !== undefined || start.phase != null
  let scenarioId: string | null = null
  let newScenario: string | null = null
  const active = usePlay.getState().scenarioId
  const activeSc = active ? project.scenarios?.[active] : undefined
  if (activeSc && startMatches(project, build, activeSc, start)) scenarioId = activeSc.id
  else if (changed) {
    const match = Object.values(project.scenarios ?? {}).find((sc) => startMatches(project, build, sc, start))
    if (match) scenarioId = match.id
    else {
      const phase = start.phase ? Object.values(project.state.time.phases).find((p) => (p.technicalName || toTechnicalName(p.label)) === start.phase) : undefined
      const { setup } = valuesToSetup(build.file, start.values ?? {})
      newScenario = `Start of “${name}”`
      scenarioId = addScenario({
        name: newScenario,
        setup,
        ...(start.day !== undefined ? { day: start.day } : {}),
        ...(phase ? { phaseId: phase.id } : {}),
        ...(start.seed !== undefined ? { seed: start.seed } : {})
      })
      if (!scenarioId) return { ok: false, message: "Couldn't save the starting state." }
    }
  }

  // Where the test runner will stop along this route: what the test expects from now on.
  const run = playRoute(build.file, session.startFlowId, start, session.route)
  if (run.failures.length) return { ok: false, message: run.failures[0].message }
  const testId = addTest({
    name,
    flowId: session.startFlowId,
    scenarioId,
    kind: 'play',
    route: [...session.route],
    stopsAt: run.stop.nodeId,
    ends: run.stop.ended,
    checks
  })
  if (!testId) return { ok: false, message: "Couldn't save the test." }
  return { ok: true, testId, newScenario }
}
