import { readFileSync } from 'fs'
import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { parseProject } from './parse'
import { runStoryTests } from './play/storyTests'
import { collectProblems } from './problems'
import type { Project } from './schema'

function coffee(): Project {
  const r = parseProject(readFileSync('src/renderer/src/demos/coffee-order.skein.json', 'utf8'))
  if (!r.ok) throw new Error(r.error)
  return r.project
}

describe('problems', () => {
  it('a healthy project has none', () => {
    const p = coffee()
    expect(collectProblems(p, { tests: Object.fromEntries(runStoryTests(p).map((r) => [r.testId, r])) })).toEqual([])
  })

  it('lists node, rule, structure and test problems once each, with where they are', () => {
    const p = produce(coffee(), (d) => {
      const flow = Object.values(d.flows)[0]
      const line = Object.values(flow.nodes).find((n) => String(n.data.text).startsWith('Morning'))!
      line.data.requires = 'Player.Coin > 1'
      flow.nodes.lonely = { id: 'lonely', type: 'dialogue', position: { x: 0, y: 9999 }, data: { text: 'Hello?', lineId: 'ORDER_lonely' } }
      d.state.rules.r1 = { id: 'r1', name: 'Broken', order: 0, enabled: true, trigger: 'day', phaseId: null, forEachTemplateId: null, condition: 'Nope.Nothing', effects: '' }
    })
    const tests = Object.fromEntries(runStoryTests(p).map((r) => [r.testId, r]))
    const list = collectProblems(p, { tests })
    const flowName = Object.values(p.flows)[0].name
    const line = list.find((x) => x.place.kind === 'node' && x.message.startsWith('Requires:'))!
    expect(line).toMatchObject({ level: 'error', group: flowName })
    expect(line.label).toMatch(/^Line: “Morning!/)
    expect(list.filter((x) => x.place.kind === 'node' && x.place.nodeId === 'lonely').map((x) => x.message)).toEqual([
      'Orphan: nothing leads here, and it isn’t marked as a start.',
      'Dead end: nothing follows, and it isn’t marked as an end.'
    ])
    // The rule's broken condition is reported once (not again by the exporter).
    expect(list.filter((x) => x.place.kind === 'rule')).toHaveLength(1)
    // The flow's own "N issues in nodes" summary isn't a problem of its own.
    expect(list.some((x) => /issues? in nodes/.test(x.message))).toBe(false)
    // The broken requirement makes the play-through test fail.
    expect(list.some((x) => x.place.kind === 'test')).toBe(true)
    // Errors come before warnings within a group.
    const inFlow = list.filter((x) => x.group === flowName).map((x) => x.level)
    expect(inFlow).toEqual([...inFlow].sort((a, b) => (a === b ? 0 : a === 'error' ? -1 : 1)))
  })
})
