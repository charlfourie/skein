import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { buildExport } from '../export/build'
import type { ExportFile } from '../export/types'
import { parseProject } from '../parse'
import { explore, labelForKey, pathFromKey } from './explore'

function lighthouse(): ExportFile {
  const r = parseProject(readFileSync('examples/lighthouse-v2.skein.json', 'utf8'))
  if (!r.ok) throw new Error(r.error)
  return buildExport(r.project).file
}
const flowId = (f: ExportFile, name: string) => Object.values(f.flows).find((x) => x.name === name)!.id

/** A hand-built export exercising each kind of finding. */
function crafted(): ExportFile {
  const base = lighthouse()
  const line = (id: string, next: string[], extra: Record<string, unknown> = {}) => ({ id, type: 'dialogue', speaker: null, text: id, next, ...extra })
  base.state.variables['Test.Score'] = { type: 'number', default: 0, min: 0, max: 3, integer: true }
  base.state.variables['Test.Open'] = { type: 'boolean', default: false }
  base.flows.t = {
    id: 't',
    name: 'Test',
    start: ['s'],
    nodes: {
      s: line('s', ['a', 'b', 'gated']) as never,
      a: line('a', ['done'], { menuText: 'A', effects: { do: [{ set: { get: 'var', var: 'Test.Score' }, op: '+=', value: { lit: 5 } }] } }) as never,
      b: line('b', [], { menuText: 'B' }) as never, // stops without being marked End
      gated: line('gated', ['done'], { menuText: 'Gated', requires: { expr: { get: 'var', var: 'Test.Open' } } }) as never,
      done: line('done', [], { end: true }) as never,
      orphan: line('orphan', []) as never,
      loopy: { id: 'loopy', type: 'jump', jumpTo: 'loopy' } as never
    }
  }
  base.flows.spin = { id: 'spin', name: 'Spin', start: ['h'], nodes: { h: { id: 'h', type: 'hub', label: 'h', next: ['x', 'y'] } as never, x: line('x', ['h'], { menuText: 'X' }) as never, y: line('y', ['h'], { menuText: 'Y' }) as never } }
  base.flows.auto = { id: 'auto', name: 'Auto', start: ['j'], nodes: { j: { id: 'j', type: 'jump', jumpTo: 'k' } as never, k: { id: 'k', type: 'jump', jumpTo: 'j' } as never } }
  return base
}

describe('path explorer', () => {
  it('finds a line the sample can never play from its default start, and reaches it when the start varies', () => {
    const file = lighthouse()
    const id = flowId(file, 'Arrival')
    const plain = explore(file, { flowId: id, maxBeats: 30 })
    expect(plain.errors).toEqual([])
    // The Keeper only welcomes the Stranger with Trust >= 1 or Reputation >= 2, and nothing in Arrival raises either.
    expect(plain.unreached.map((n) => (file.flows[id].nodes[n] as { text?: string }).text)).toEqual(['Come in, then. Mind the stairs.'])
    const varied = explore(file, { flowId: id, maxBeats: 30, vary: [{ key: 'var:Player.Reputation', values: [1, 2] }] })
    expect(varied.unreached).toEqual([])
    expect(varied.starts).toBe(2)
  })

  it('reports endings, unmarked stops, unreached nodes and number ranges', () => {
    const r = explore(crafted(), { flowId: 't' })
    expect(r.paths).toBe(2) // A or B; Gated is never available
    const done = r.endings.find((e) => e.nodeId === 'done')!
    expect(done.marked).toBe(true)
    expect(done.example.choices).toEqual(['A'])
    const stop = r.endings.find((e) => e.nodeId === 'b')!
    expect(stop.marked).toBe(false)
    expect(r.unreached).toEqual(['gated', 'loopy', 'orphan'])
    const score = r.ranges.find((x) => x.key === 'var:Test.Score')!
    expect([score.min, score.max, score.defMin, score.defMax]).toEqual([0, 3, 0, 3]) // +5 clamped to max 3
  })

  it('varies the starting state: every combination is a separate start', () => {
    const r = explore(crafted(), { flowId: 't', vary: [{ key: 'var:Test.Open', values: [false, true] }] })
    expect(r.starts).toBe(2)
    expect(r.paths).toBe(5) // 2 without the gate, 3 with it
    expect(r.unreached).toEqual(['loopy', 'orphan'])
    const viaGate = r.endings.find((e) => e.nodeId === 'done')!
    expect(viaGate.count).toBe(3) // via A in both starts, via Gated once
  })

  it('catches player loops that never end, and automatic loops', () => {
    const spin = explore(crafted(), { flowId: 'spin', maxBeats: 20, maxPaths: 50 })
    expect(spin.stuck?.count).toBeGreaterThan(0)
    expect(spin.capped).toBe(true)
    const auto = explore(crafted(), { flowId: 'auto' })
    expect(auto.errors[0].message).toMatch(/10,000 automatic steps/)
  })

  it('stops at maxPaths and says so', () => {
    const r = explore(crafted(), { flowId: 't', maxPaths: 1 })
    expect(r.paths).toBe(1)
    expect(r.capped).toBe(true)
  })

  it('parses and labels state keys', () => {
    expect(pathFromKey('var:World.Storm')).toEqual({ get: 'var', var: 'World.Storm' })
    expect(pathFromKey('prop:Keeper.Mood')).toEqual({ get: 'prop', entity: 'Keeper', prop: 'Mood' })
    expect(pathFromKey('rel:Character->Character.Trust:Keeper:Stranger')).toEqual({ get: 'rel', rel: 'Character->Character.Trust', from: 'Keeper', to: 'Stranger' })
    expect(labelForKey('rel:Character->Character.Trust:Keeper:Stranger')).toBe('Keeper → Stranger Trust')
  })
})
