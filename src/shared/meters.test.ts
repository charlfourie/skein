import { describe, expect, it } from 'vitest'
import { buildExport } from './export/build'
import { createEmptyProject, createFlow, createStateVariable } from './factory'
import { explore } from './play/explore'
import type { Project } from './schema'
import { validateProject } from './validate'

/**
 * World.Strain (0 to 3) and World.Drift (no range). Start: Strain += 2, then a choice:
 *   "Push" (Strain += 2: held at 3, then Drift += 1) or "Rest" (Strain -= 1, Drift -= 1).
 */
function project(strainRange = true): Project {
  const p = createEmptyProject('Meters')
  p.flows = {}
  const strain = { ...createStateVariable('v1', 'World', 'Strain', 'Strain', 'number', 0), defaultValue: 0, ...(strainRange ? { min: 0, max: 3 } : {}) }
  const drift = { ...createStateVariable('v2', 'World', 'Drift', 'Drift', 'number', 1), defaultValue: 0 }
  p.state.variables = { v1: strain, v2: drift }
  const f = createFlow('f1', 'Shift', null, 0)
  const node = (id: string, data: Record<string, unknown>) => (f.nodes[id] = { id, type: 'dialogue', position: { x: 0, y: 0 }, data })
  node('a', { isStart: true, startOrder: 0, text: 'A long shift.', effects: 'World.Strain += 2' })
  node('push', { menuText: 'Push', text: 'You push on.', effects: 'World.Strain += 2\nWorld.Drift += 1', isEnd: true })
  node('rest', { menuText: 'Rest', text: 'You rest.', effects: 'World.Strain -= 1\nWorld.Drift -= 1', isEnd: true })
  f.edges.e1 = { id: 'e1', source: 'a', target: 'push', sourceHandle: 'out', targetHandle: 'in', order: 0 }
  f.edges.e2 = { id: 'e2', source: 'a', target: 'rest', sourceHandle: 'out', targetHandle: 'in', order: 1 }
  p.flows[f.id] = f
  return p
}

describe('meters', () => {
  it('warns about a number that goes up and down with no range', () => {
    const issues = validateProject(project())
    expect(issues.get('v2')?.some((i) => /goes up and down/.test(i.message))).toBe(true)
    expect(issues.get('v1')?.some((i) => /goes up and down/.test(i.message)) ?? false).toBe(false) // has a range
    expect(validateProject(project(false)).get('v1')?.some((i) => /goes up and down/.test(i.message))).toBe(true)
  })

  it('warns about a starting value outside the range', () => {
    const p = project()
    p.state.variables.v1.defaultValue = 9
    expect(validateProject(p).get('v1')?.some((i) => /starting value must be at most 3/.test(i.message))).toBe(true)
  })

  it('the explorer reports swings along the way and changes held at a limit', () => {
    const r = explore(buildExport(project()).file, { flowId: 'f1' })
    const strain = r.ranges.find((x) => x.key === 'var:World.Strain')!
    expect(strain).toMatchObject({ min: 1, max: 3, low: 0, high: 3, defMin: 0, defMax: 3 })
    expect(strain.cappedHigh).toBe(0.5) // "Push" hits the max on one of two paths
    expect(strain.cappedLow).toBe(0)
    const drift = r.ranges.find((x) => x.key === 'var:World.Drift')!
    expect(drift).toMatchObject({ min: -1, max: 1, low: -1, high: 1 })
    expect(drift.defMin).toBeUndefined()
  })
})
