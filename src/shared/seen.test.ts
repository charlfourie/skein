import { describe, expect, it } from 'vitest'
import { compile } from './expr/check'
import { buildExport } from './export/build'
import { SkeinStory, SkeinWorld } from './export/runtime'
import { createEmptyProject, createFlow, createRule, createStateVariable } from './factory'
import type { Project } from './schema'
import { validateProject } from './validate'

/**
 * A hub that loops back to itself with three options:
 *   "Ask" (only once), "Twice" (requires Visits.Ask >= 1, so only after Ask), "Leave".
 * A second flow reads Seen.Ask. A rule only runs while the first flow is playing.
 */
function project(): Project {
  const p = createEmptyProject('Seen test')
  p.state.time.speakingRate = 0 // these tests aren't about spoken time
  p.flows = {}
  const v = { ...createStateVariable('v1', 'World', 'Ticks', 'Ticks', 'number', 0), defaultValue: 0 }
  p.state.variables[v.id] = v
  const f = createFlow('f1', 'Bar', null, 0)
  const node = (id: string, type: string, data: Record<string, unknown>) => (f.nodes[id] = { id, type, position: { x: 0, y: 0 }, data })
  const edge = (id: string, source: string, target: string, order: number) => (f.edges[id] = { id, source, target, sourceHandle: 'out', targetHandle: 'in', order })
  node('hub', 'hub', { isStart: true, startOrder: 0, label: 'At the bar' })
  node('ask', 'dialogue', { menuText: 'Ask', text: 'You ask.', once: true, tag: 'Ask' })
  node('twice', 'dialogue', { menuText: 'Ask again', text: 'Again?', requires: 'Visits.Ask >= 1' })
  node('leave', 'dialogue', { menuText: 'Leave', text: 'Bye.', isEnd: true, effects: 'advance' })
  node('back', 'jump', { targetId: 'hub' })
  node('back2', 'jump', { targetId: 'hub' })
  edge('e1', 'hub', 'ask', 0)
  edge('e2', 'hub', 'twice', 1)
  edge('e3', 'hub', 'leave', 2)
  edge('e4', 'ask', 'back', 0)
  edge('e5', 'twice', 'back2', 0)
  p.flows[f.id] = f
  const g = createFlow('f2', 'Later', null, 1)
  g.nodes.a = { id: 'a', type: 'dialogue', position: { x: 0, y: 0 }, data: { isStart: true, startOrder: 0, text: 'You asked earlier.', requires: 'Seen.Ask', isEnd: true } }
  g.nodes.b = { id: 'b', type: 'dialogue', position: { x: 0, y: 0 }, data: { isStart: true, startOrder: 1, text: 'Hello stranger.', isEnd: true } }
  p.flows[g.id] = g
  const rule = { ...createRule('r1', 'Tick during the bar', 0), trigger: 'phase' as const, phaseId: null, effects: 'World.Ticks += 1', flowId: 'f1' }
  p.state.rules[rule.id] = rule
  return p
}

describe('Seen, Visits and Only once', () => {
  it('compiles Seen.Tag as a true/false check and Visits.Tag as a count', () => {
    const p = project()
    expect(compile(p, 'Seen.Ask', 'condition').ok).toBe(true)
    expect(compile(p, 'Visits.Ask >= 2', 'condition').ok).toBe(true)
    expect(compile(p, 'Seen.Ask + 1 > 0', 'condition').ok).toBe(false) // Seen is true/false, not a number
    const typo = compile(p, 'Seen.Asks', 'condition')
    expect(typo.ok).toBe(false)
    expect(typo.diagnostics[0].message).toMatch(/No node is tagged “Asks”.*Ask/)
    const write = compile(p, 'Visits.Ask = 3', 'action')
    expect(write.ok).toBe(false)
    expect(write.diagnostics[0].message).toMatch(/counts itself/)
  })

  it('exports counted nodes, "only once" as a requirement, and flow-scoped rules, as format v2 (v5 for the hub that keeps asking)', () => {
    const { file, problems } = buildExport(project())
    expect(problems).toEqual([])
    // The hub offers once-only choices, so it keeps asking while one is left (v5); without that it would be v2.
    expect(file.version).toBe(5)
    const ask = file.flows.f1.nodes.ask
    expect(ask.count).toBe(true)
    expect(ask.tag).toBe('Ask')
    expect(ask.requires?.expr).toEqual({ op: '==', a: { get: 'visit', node: 'ask' }, b: { lit: 0 } })
    expect(ask.requires?.source).toBe('only once')
    expect(file.flows.f1.nodes.twice.count).toBeUndefined() // not tagged, not once: not counted
    expect(file.state.rules[0].flow).toBe('f1')
  })

  it('a project that uses none of it still exports as format v1', () => {
    const p = project()
    for (const f of Object.values(p.flows)) for (const n of Object.values(f.nodes)) {
      delete n.data.once
      delete n.data.tag
      if (n.data.requires) delete n.data.requires
    }
    delete p.state.rules.r1.flowId
    expect(buildExport(p).file.version).toBe(1)
  })

  it('plays as designed: once hides itself, Visits unlocks the follow-up, Seen carries into another flow', () => {
    const { file } = buildExport(project())
    const world = new SkeinWorld(file)
    const story = new SkeinStory(world, 'f1')
    let beat = story.start()
    expect(beat.kind === 'choice' && beat.choices.map((c) => c.text)).toEqual(['Ask', 'Leave']) // "Ask again" needs a visit
    beat = story.choose(0) // Ask
    beat = story.choose(0) // back to the hub
    expect(beat.kind === 'choice' && beat.choices.map((c) => c.text)).toEqual(['Ask again', 'Leave']) // Ask is gone, Ask again appears
    expect(world.read({ get: 'visit', node: 'ask' })).toBe(1)
    const saved = world.save()
    expect(saved.changes['visit:ask']).toBe(1)
    // Another flow, same world: Seen.Ask picks the first start.
    const later = new SkeinStory(new SkeinWorld(file, saved), 'f2').start()
    expect(later.kind === 'line' && later.text).toBe('You asked earlier.')
    const fresh = new SkeinStory(new SkeinWorld(file), 'f2').start()
    expect(fresh.kind === 'line' && fresh.text).toBe('Hello stranger.')
  })

  it('a rule limited to a flow runs only while that flow is playing', () => {
    const { file } = buildExport(project())
    const world = new SkeinWorld(file)
    world.advance(1) // nothing playing
    expect(world.read({ get: 'var', var: 'World.Ticks' })).toBe(0)
    const story = new SkeinStory(world, 'f1')
    story.start()
    world.advance(1) // the bar is playing
    expect(world.read({ get: 'var', var: 'World.Ticks' })).toBe(1)
    story.choose(1) // Leave (its effect advances time: the rule runs once more)
    expect(world.read({ get: 'var', var: 'World.Ticks' })).toBe(2)
    story.choose(0) // the line ends the flow
    expect(world.playing).toBe(null)
    world.advance(1) // over: the rule stops
    expect(world.read({ get: 'var', var: 'World.Ticks' })).toBe(2)
  })

  it('validates tags: unique, and a valid name', () => {
    const p = project()
    p.flows.f2.nodes.b.data.tag = 'Ask'
    p.flows.f2.nodes.a.data.tag = 'not ok'
    const issues = validateProject(p)
    expect(issues.get('b')?.some((i) => /used by 2 nodes/.test(i.message))).toBe(true)
    expect(issues.get('a')?.some((i) => /can only use letters/.test(i.message))).toBe(true)
  })

  it('a rule scoped to a deleted flow runs everywhere, with a warning', () => {
    const p = project()
    p.state.rules.r1.flowId = 'gone'
    const { file, problems } = buildExport(p)
    expect(file.state.rules[0].flow).toBeUndefined()
    expect(problems.some((x) => /no longer exists/.test(x.message))).toBe(true)
  })
})
