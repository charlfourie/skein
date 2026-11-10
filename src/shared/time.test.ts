import { describe, expect, it } from 'vitest'
import { compile } from './expr/check'
import { buildExport } from './export/build'
import { SkeinStory, SkeinWorld } from './export/runtime'
import { createEmptyProject, createFlow } from './factory'
import { explore } from './play/explore'
import type { Project } from './schema'

/** One flow: a line, then an instruction with `effects`, then an End line. The game starts at Night. */
function project(effects: string): Project {
  const p = createEmptyProject('Time test')
  p.state.time.speakingRate = 0 // these tests aren't about spoken time
  p.flows = {}
  const phases = Object.values(p.state.time.phases).sort((a, b) => a.order - b.order)
  p.state.time.startPhaseId = phases.find((x) => x.technicalName === 'Night')!.id
  const f = createFlow('f1', 'Night watch', null, 0)
  f.nodes.a = { id: 'a', type: 'dialogue', position: { x: 0, y: 0 }, data: { isStart: true, startOrder: 0, text: 'You keep watch.' } }
  f.nodes.b = { id: 'b', type: 'instruction', position: { x: 0, y: 0 }, data: { script: effects } }
  f.nodes.c = { id: 'c', type: 'dialogue', position: { x: 0, y: 0 }, data: { text: 'Done.', isEnd: true } }
  f.edges.e1 = { id: 'e1', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', order: 0 }
  f.edges.e2 = { id: 'e2', source: 'b', target: 'c', sourceHandle: 'out', targetHandle: 'in', order: 0 }
  p.flows[f.id] = f
  return p
}

function timeAfter(effects: string): string {
  const { file } = buildExport(project(effects))
  const world = new SkeinWorld(file)
  const story = new SkeinStory(world, 'f1')
  story.start()
  story.choose(0)
  return `Day ${world.day}, ${world.phase}`
}

describe('advance to / advance until', () => {
  it('parses “advance until” and checks the phase name', () => {
    const p = project('')
    expect(compile(p, 'advance until Night', 'action').ok).toBe(true)
    const bad = compile(p, 'advance until Nigth', 'action')
    expect(bad.ok).toBe(false)
    expect(bad.diagnostics[0].message).toMatch(/Did you mean/)
  })

  it('“advance to” the current phase moves a whole day; “advance until” stays', () => {
    expect(timeAfter('advance to Night')).toBe('Day 2, Night')
    expect(timeAfter('advance until Night')).toBe('Day 1, Night')
    expect(timeAfter('advance until Dawn')).toBe('Day 2, Dawn') // not there yet: same as “advance to”
    expect(timeAfter('advance to Dawn')).toBe('Day 2, Dawn')
  })

  it('exports “until” as advanceTo with stay, which needs format v2', () => {
    const until = buildExport(project('advance until Night')).file
    expect(until.version).toBe(2)
    expect(until.flows.f1.nodes.b.type === 'instruction' && until.flows.f1.nodes.b.instruction?.do).toEqual([{ advanceTo: 'Night', stay: true }])
    const to = buildExport(project('advance to Night')).file
    expect(to.version).toBe(1)
    expect(to.flows.f1.nodes.b.type === 'instruction' && to.flows.f1.nodes.b.instruction?.do).toEqual([{ advanceTo: 'Night' }])
  })

  it('the explorer reports “advance to” that skips a whole day, with the node', () => {
    const r = explore(buildExport(project('advance to Night')).file, { flowId: 'f1' })
    expect(r.fullDays).toHaveLength(1)
    expect(r.fullDays[0]).toMatchObject({ nodeId: 'b', phase: 'Night', count: 1 })
    expect(explore(buildExport(project('advance until Night')).file, { flowId: 'f1' }).fullDays).toEqual([])
  })

  it('a runtime refuses a file from a newer format', () => {
    const { file } = buildExport(project(''))
    expect(() => new SkeinWorld({ ...file, version: 4 as never })).toThrow(/version 4/)
  })
})
