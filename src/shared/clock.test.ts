import { describe, expect, it } from 'vitest'
import { compile } from './expr/check'
import { execute, initialState, read } from './expr/runtime'
import { buildExport } from './export/build'
import { SkeinStory, SkeinWorld } from './export/runtime'
import { createEmptyProject, createFlow, createRule, createStateVariable } from './factory'
import type { Project } from './schema'
import { clockOf, formatDuration, nodeTakes, parseDuration, timeOfDay } from './time'
import { validateProject } from './validate'

/**
 * Default clock (Dawn 05:00 2h, Day 07:00 11h, Dusk 18:00 2h, Night 20:00 9h), starting Day at 07:00.
 * Flow: a 10-word line → "Repair the radio" (activity, 2h) / "Nap" (takes 12h) → End.
 * Rule: when Dusk begins, World.Dusks += 1.
 */
function project(): Project {
  const p = createEmptyProject('Clock')
  p.flows = {}
  const t = p.state.time
  const phase = (name: string) => Object.values(t.phases).find((x) => x.technicalName === name)!.id
  t.startPhaseId = phase('Day')
  t.activities = { repair: { id: 'repair', name: 'Repair the radio', minutes: 120, order: 0 } }
  const v = { ...createStateVariable('v1', 'World', 'Dusks', 'Dusks', 'number', 0), defaultValue: 0 }
  p.state.variables[v.id] = v
  const rule = { ...createRule('r', 'Count dusks', 0), trigger: 'phase' as const, phaseId: phase('Dusk'), effects: 'World.Dusks += 1' }
  p.state.rules[rule.id] = rule
  const f = createFlow('f', 'Workshop', null, 0)
  const node = (id: string, data: Record<string, unknown>) => (f.nodes[id] = { id, type: 'dialogue', position: { x: 0, y: 0 }, data })
  node('a', { isStart: true, startOrder: 0, text: 'The radio has been dead for three days now, Michael.' }) // 10 words
  node('repair', { menuText: 'Fix it', text: 'You work on it.', activityId: 'repair', isEnd: true })
  node('nap', { menuText: 'Nap', text: 'You sleep.', takes: 720, isEnd: true })
  f.edges.e1 = { id: 'e1', source: 'a', target: 'repair', sourceHandle: 'out', targetHandle: 'in', order: 0 }
  f.edges.e2 = { id: 'e2', source: 'a', target: 'nap', sourceHandle: 'out', targetHandle: 'in', order: 1 }
  p.flows[f.id] = f
  return p
}

describe('the clock', () => {
  it('reads and writes durations the way people say them', () => {
    expect(parseDuration('45m')).toBe(45)
    expect(parseDuration('2h')).toBe(120)
    expect(parseDuration('1h 30m')).toBe(90)
    expect(parseDuration('1.5 hours')).toBe(90)
    expect(parseDuration('90')).toBe(90)
    expect(parseDuration('20s')).toBeCloseTo(1 / 3)
    expect(parseDuration('soon')).toBeNull()
    expect(formatDuration(90)).toBe('1h 30m')
    expect(formatDuration(4 / 60)).toBe('4s')
    expect(formatDuration(1500)).toBe('1d 1h')
  })

  it('new projects get a 24-hour day starting at dawn', () => {
    const p = project()
    expect(clockOf(p)).toEqual({ lengths: [120, 660, 120, 540], dayStart: 300 })
    expect(timeOfDay(clockOf(p), 3, 30)).toEqual({ hour: 20, minute: 30 })
    expect(validateProject(p).get('state:time') ?? []).toEqual([])
    const q = project()
    Object.values(q.state.time.phases)[0].minutes = 60
    expect(validateProject(q).get('state:time')?.[0].message).toMatch(/add up to 23h/)
  })

  it('works out how long a node takes: its own length, its activity, or the time to say the line', () => {
    const p = project()
    const n = p.flows.f.nodes
    expect(nodeTakes(p, n.repair)).toEqual({ minutes: 120, source: 'activity', activity: 'Repair the radio' })
    expect(nodeTakes(p, n.nap)).toEqual({ minutes: 720, source: 'override' })
    expect(nodeTakes(p, n.a)).toEqual({ minutes: 4 / 60, source: 'speech' }) // 10 words at 150 a minute
    n.repair.data.takes = 0
    expect(nodeTakes(p, n.repair)).toBeNull() // an own 0 means none
  })

  it('compiles pass and Time.Hour, and keeps them out of rules', () => {
    const p = project()
    expect(compile(p, 'pass 1h 30m', 'action').ok).toBe(true)
    expect(compile(p, 'pass soon', 'action').diagnostics[0].message).toMatch(/pass 30m/)
    expect(compile(p, 'pass 30m', 'action', { allowAdvance: false }).ok).toBe(false)
    expect(compile(p, 'Time.Hour >= 22 or Time.Minute == 0', 'condition').ok).toBe(true)
  })

  it('the editor preview passes time and rolls into the next phase, running its rules', () => {
    const p = project()
    const ctx = { project: p, state: initialState(p) }
    const c = compile(p, 'pass 10h 30m\npass 45m', 'action')
    execute(ctx, c.actions)
    expect(read(ctx, { kind: 'time', field: 'hour' })).toBe(18) // 07:00 + 11h15m = 18:15, in Dusk
    expect(read(ctx, { kind: 'time', field: 'minute' })).toBe(15)
    expect(ctx.state.phase).toBe(2)
  })

  it('exports takes and the clock as v3, and the runtime spends the time', () => {
    const { file, problems } = buildExport(project())
    expect(problems).toEqual([])
    expect(file.version).toBe(3)
    expect(file.state.time).toMatchObject({ minutes: [120, 660, 120, 540], dayStart: 300 })
    expect(file.flows.f.nodes.repair).toMatchObject({ takes: 120, activity: 'Repair the radio' })

    const play = (pick: number) => {
      const world = new SkeinWorld(file)
      const story = new SkeinStory(world, 'f')
      story.start()
      story.choose(pick)
      return { world, at: `Day ${world.day} ${world.phase} ${String(world.clock.hour).padStart(2, '0')}:${String(world.clock.minute).padStart(2, '0')}` }
    }
    expect(play(0).at).toBe('Day 1 Day 09:00') // 4s of talk + 2h of repairs
    const nap = play(1) // 12h nap from 07:00:04: into Dusk (its rule runs), 19:00
    expect(nap.at).toBe('Day 1 Dusk 19:00')
    expect(nap.world.read({ get: 'var', var: 'World.Dusks' })).toBe(1)
    const saved = new SkeinWorld(file, JSON.parse(JSON.stringify(nap.world.save())))
    expect(saved.clock).toEqual(nap.world.clock)
  })

  it('a long pass crosses days, running day rules once per new day', () => {
    const { file } = buildExport(project())
    const w = new SkeinWorld(file)
    w.pass(3 * 24 * 60)
    expect([w.day, w.phase, w.clock.hour]).toEqual([4, 'Day', 7])
    expect(w.read({ get: 'var', var: 'World.Dusks' })).toBe(3)
  })
})
