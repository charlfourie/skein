import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { parseProject } from '../parse'
import { stateUsage } from './usage'

describe('state usage by entity', () => {
  it('lists every place an entity’s state or relationships are used', () => {
    const r = parseProject(readFileSync('src/renderer/src/demos/museum-heist.skein.json', 'utf8'))
    if (!r.ok) throw new Error(r.error)
    const p = r.project
    const used = Object.values(p.entities)
      .map((e) => ({ name: e.name, n: stateUsage(p).count.get(`entity:${e.id}`) ?? 0 }))
      .filter((x) => x.n > 0)
    expect(used.length).toBeGreaterThan(0)
    // Every listed place is a real node or rule.
    for (const e of Object.values(p.entities)) {
      for (const o of stateUsage(p).sites.get(`entity:${e.id}`) ?? []) {
        if (o.kind === 'node') expect(p.flows[o.flowId]?.nodes[o.nodeId]).toBeDefined()
        else if (o.kind === 'rule') expect(p.state.rules[o.ruleId]).toBeDefined()
      }
    }
  })
})
