import { describe, expect, it } from 'vitest'
import { PlaySession } from './playSession'
import { compile } from '@shared/expr/check'
import { CONDITION_NODE_CTX } from '@shared/expr/sites'
import { buildExport } from '@shared/export/build'
import { SkeinWorld } from '@shared/export/runtime'
import { createEmptyProject, createFlow, createStateVariable } from '@shared/factory'
import { explore } from '@shared/play/explore'
import type { Project } from '@shared/schema'
import { validateProject } from '@shared/validate'

/**
 * A Condition node that's true 30% of the time, then a line that rolls a die into World.Die.
 *   start → cond: chance(30) → "Lucky." (End) / "Unlucky." → roll
 */
function project(): Project {
  const p = createEmptyProject('Dice test')
  p.flows = {}
  const die = { ...createStateVariable('v1', 'World', 'Die', 'Die', 'number', 0), defaultValue: 0 }
  p.state.variables[die.id] = die
  const f = createFlow('f1', 'Dice', null, 0)
  const node = (id: string, type: string, data: Record<string, unknown>) => (f.nodes[id] = { id, type, position: { x: 0, y: 0 }, data })
  node('a', 'dialogue', { isStart: true, startOrder: 0, text: 'You flip a coin.' })
  node('c', 'condition', { expression: 'chance(30)' })
  node('yes', 'dialogue', { text: 'Lucky.', isEnd: true })
  node('no', 'dialogue', { text: 'Unlucky.', effects: 'World.Die = roll(1, 3)', isEnd: true })
  f.edges.e1 = { id: 'e1', source: 'a', target: 'c', sourceHandle: 'out', targetHandle: 'in', order: 0 }
  f.edges.e2 = { id: 'e2', source: 'c', target: 'yes', sourceHandle: 'true', targetHandle: 'in', order: 0 }
  f.edges.e3 = { id: 'e3', source: 'c', target: 'no', sourceHandle: 'false', targetHandle: 'in', order: 0 }
  p.flows[f.id] = f
  return p
}

describe('chance() and roll()', () => {
  it('are allowed in actions and Condition nodes, not in requirements', () => {
    const p = project()
    expect(compile(p, 'World.Die = roll(1, 6)', 'action').ok).toBe(true)
    expect(compile(p, 'chance(30) and World.Die > 2', 'condition', CONDITION_NODE_CTX).ok).toBe(true)
    const req = compile(p, 'chance(30)', 'condition')
    expect(req.ok).toBe(false)
    expect(req.diagnostics[0].message).toMatch(/can’t be used in a requirement/)
    expect(compile(p, 'World.Die = roll(6, 1)', 'action').diagnostics[0].message).toMatch(/below the lowest/)
    expect(compile(p, 'World.Die = chance(130)', 'action').ok).toBe(false)
    expect(compile(p, 'World.Die = roll(1.5, 3)', 'action').ok).toBe(false)
    expect(compile(p, 'World.Die = roll(1, 1000)', 'action').ok).toBe(false)
    expect(compile(p, 'World.Die = chance(30)', 'action').ok).toBe(false) // true/false into a number
    expect(compile(p, 'World.Die = roll(-2, 2) + 1', 'action').ok).toBe(true)
  })

  it('validation flags dice in a requirement but not in a Condition node', () => {
    const p = project()
    expect([...validateProject(p).values()].flat().filter((i) => i.level === 'error')).toEqual([])
    const q = project()
    q.flows.f1.nodes.yes.data.requires = 'chance(50)'
    expect(validateProject(q).get('yes')?.some((i) => /requirement/.test(i.message))).toBe(true)
  })

  it('exports as { chance } and { roll }, format v2', () => {
    const { file, problems } = buildExport(project())
    expect(problems).toEqual([])
    expect(file.version).toBe(2)
    const c = file.flows.f1.nodes.c
    expect(c.type === 'condition' && c.condition?.expr).toEqual({ chance: 30 })
    expect(file.flows.f1.nodes.no.effects?.do[0]).toMatchObject({ value: { roll: [1, 3] } })
  })

  it('rolls deterministically from a seed, and a save carries the dice on', () => {
    const { file } = buildExport(project())
    const seq = (w: SkeinWorld) => Array.from({ length: 20 }, () => w.evaluate({ roll: [1, 6] }))
    expect(seq(new SkeinWorld(file, undefined, { seed: 42 }))).toEqual(seq(new SkeinWorld(file, undefined, { seed: 42 })))
    expect(seq(new SkeinWorld(file, undefined, { seed: 42 }))).not.toEqual(seq(new SkeinWorld(file, undefined, { seed: 43 })))
    const a = new SkeinWorld(file, undefined, { seed: 7 })
    seq(a)
    const b = new SkeinWorld(file, JSON.parse(JSON.stringify(a.save())))
    expect(seq(b)).toEqual(seq(a))
  })

  it('has the odds it says', () => {
    const { file } = buildExport(project())
    const w = new SkeinWorld(file, undefined, { seed: 1 })
    let yes = 0
    const faces = new Map<number, number>()
    for (let i = 0; i < 20000; i++) {
      if (w.evaluate({ chance: 30 })) yes++
      const f = w.evaluate({ roll: [1, 6] }) as number
      faces.set(f, (faces.get(f) ?? 0) + 1)
    }
    expect(yes / 20000).toBeGreaterThan(0.28)
    expect(yes / 20000).toBeLessThan(0.32)
    expect([...faces.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6])
    for (const n of faces.values()) expect(n / 20000).toBeGreaterThan(0.15)
    expect(w.evaluate({ chance: 0 })).toBe(false)
    expect(w.evaluate({ chance: 100 })).toBe(true)
  })

  it('the explorer tries every outcome and weights endings by the odds', () => {
    const { file } = buildExport(project())
    const r = explore(file, { flowId: 'f1' })
    expect(r.random).toBe(true)
    expect(r.paths).toBe(4) // lucky, or unlucky × 3 faces
    const share = Object.fromEntries(r.endings.map((e) => [e.text, Math.round((e.weight / r.weight) * 100)]))
    expect(share).toEqual({ 'Lucky.': 30, 'Unlucky.': 70 })
    expect(r.ranges.find((x) => x.key === 'var:World.Die')).toMatchObject({ min: 0, max: 3 })
    const unlucky = r.endings.find((e) => e.text === 'Unlucky.')!
    expect(unlucky.example.choices[0]).toMatch(/chance 30% → no/)
  })

  it('Play replays an explored path with the same dice, and logs every roll', () => {
    const { file } = buildExport(project())
    const r = explore(file, { flowId: 'f1' })
    const unlucky = r.endings.find((e) => e.text === 'Unlucky.')!
    const s = new PlaySession(file, 'f1', {}, unlucky.example.start, unlucky.example.picks)
    s.replay()
    expect(s.ended).toBe(true)
    expect(s.entries.filter((e) => e.kind === 'dice').map((e) => (e as { text: string }).text)[0]).toBe('chance 30% → no')
    expect(s.entries.some((e) => e.kind === 'line' && e.text === 'Unlucky.')).toBe(true)
    // Without a recorded path, the same seed gives the same story.
    const t = (seed: number) => {
      const p = new PlaySession(file, 'f1', { seed })
      p.choose(0)
      return p.entries.filter((e) => e.kind === 'dice' || e.kind === 'line').map((e) => JSON.stringify(e)).join()
    }
    expect(t(5)).toBe(t(5))
  })
})
