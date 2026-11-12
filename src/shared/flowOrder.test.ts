import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { buildExport } from './export/build'
import { choiceNumbers, nextEdgeOrder, normalizeOrders, orderedTargets, startNodes } from './flowOrder'
import { parseProject } from './parse'
import type { Project } from './schema'
import { serializeProject } from './serialize'

/**
 * A v4 project with a hub whose choices were drawn in a different order from
 * how they sit on the canvas, a dialogue line with choices stacked vertically,
 * and three start nodes. In v4 the canvas decided the order.
 */
function v4Project(): Record<string, unknown> {
  const node = (id: string, type: string, x: number, y: number, data: Record<string, unknown> = {}) => ({ id, type, position: { x, y }, data })
  const edge = (id: string, source: string, target: string, sourceHandle = 'out') => ({ id, source, target, sourceHandle, targetHandle: 'in' })
  return {
    format: 'skein.project',
    schemaVersion: 4,
    meta: { id: 'p', name: 'Order test', createdAt: '2026-01-01T00:00:00.000Z' },
    folders: {},
    templates: {},
    entities: {},
    flows: {
      f: {
        id: 'f',
        name: 'Order',
        nodes: {
          s3: node('s3', 'dialogue', 500, 0, { isStart: true, text: 'third start (same row, right)' }),
          s1: node('s1', 'dialogue', -300, -80, { isStart: true, text: 'first start (highest)', requires: 'false' }),
          s2: node('s2', 'dialogue', 0, 0, { isStart: true, text: 'second start' }),
          hub: node('hub', 'hub', 0, 200, { label: 'Pick' }),
          c: node('c', 'dialogue', 400, 400, { menuText: 'C (right)' }),
          a: node('a', 'dialogue', -400, 400, { menuText: 'A (left)' }),
          b: node('b', 'dialogue', 0, 400, { menuText: 'B (middle)' }),
          line: node('line', 'dialogue', 0, 600, { text: 'stacked choices' }),
          lo: node('lo', 'dialogue', 0, 900, { menuText: 'Lower' }),
          up: node('up', 'dialogue', 0, 750, { menuText: 'Upper' }),
          cond: node('cond', 'condition', 0, 1100, { expression: 'true' })
        },
        edges: {
          // Created in a different order from the canvas order, with ids that sort differently again.
          e9: edge('e9', 'hub', 'b'),
          e1: edge('e1', 'hub', 'c'),
          e5: edge('e5', 'hub', 'a'),
          e2: edge('e2', 's2', 'hub'),
          e3: edge('e3', 'b', 'line'),
          e8: edge('e8', 'line', 'lo'),
          e7: edge('e7', 'line', 'up'),
          e4: edge('e4', 'lo', 'cond'),
          e6: edge('e6', 'cond', 'a', 'true'),
          e0: edge('e0', 'cond', 'c', 'false')
        }
      }
    },
    state: { variables: {}, relationships: {}, time: { phases: {}, startDay: 1, startPhaseId: null }, rules: {} }
  }
}

function load(raw: unknown): Project {
  const r = parseProject(JSON.stringify(raw))
  if (!r.ok) throw new Error(r.error)
  return r.project
}

describe('explicit choice and start order (format v5)', () => {
  it('migrating a v4 project keeps the order it played in (canvas order)', () => {
    const p = load(v4Project())
    expect(p.schemaVersion).toBeGreaterThanOrEqual(5)
    const f = p.flows.f
    expect(orderedTargets(f, 'hub')).toEqual(['a', 'b', 'c']) // left to right
    expect(orderedTargets(f, 'line')).toEqual(['up', 'lo']) // same x: top to bottom
    expect(startNodes(f).map((n) => n.id)).toEqual(['s1', 's2', 's3']) // top to bottom, then left to right
    // The order is now stored on every connection and start node.
    expect(f.edges.e5.order).toBe(0)
    expect(f.edges.e9.order).toBe(1)
    expect(f.edges.e1.order).toBe(2)
    expect(f.nodes.s1.data.startOrder).toBe(0)
    expect(f.nodes.s3.data.startOrder).toBe(2)
    expect('startOrder' in f.nodes.hub.data).toBe(false)
  })

  it('the export no longer depends on where nodes are on the canvas', () => {
    const p = load(v4Project())
    const before = JSON.stringify(buildExport(p).file)
    // Scatter every node somewhere else, as auto-layout or dragging would.
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2000 - 1000
    for (const n of Object.values(p.flows.f.nodes)) n.position = { x: Math.round(rnd()), y: Math.round(rnd()) }
    expect(JSON.stringify(buildExport(p).file)).toBe(before)
    const ex = buildExport(p).file.flows.f
    expect((ex.nodes.hub as { next: string[] }).next).toEqual(['a', 'b', 'c'])
    expect(ex.start).toEqual(['s1', 's2', 's3'])
  })

  it('a migrated project saves and reloads unchanged', () => {
    const p = load(v4Project())
    const text = serializeProject(p)
    const again = parseProject(text)
    expect(again.ok && again.repairs).toEqual([])
    expect(again.ok && serializeProject(again.project)).toBe(text)
  })

  it('numbers choices only where there are several on an ordered output', () => {
    const f = load(v4Project()).flows.f
    const n = choiceNumbers(f)
    expect(n.get('e5')).toEqual({ index: 1, count: 3 })
    expect(n.get('e1')).toEqual({ index: 3, count: 3 })
    expect(n.get('e7')).toEqual({ index: 1, count: 2 })
    expect(n.has('e2')).toBe(false) // single connection
    expect(n.has('e6')).toBe(false) // condition branches aren't choices
  })

  it('normalizeOrders renumbers gaps without changing the order', () => {
    const f = load(v4Project()).flows.f
    f.edges.e5.order = 10
    f.edges.e9.order = 20
    f.edges.e1.order = 30
    expect(normalizeOrders(f)).toBe(true)
    expect([f.edges.e5.order, f.edges.e9.order, f.edges.e1.order]).toEqual([0, 1, 2])
    expect(normalizeOrders(f)).toBe(false)
  })

  it('connections without a stored order (hand-edited files) fall back to canvas order, after ordered ones', () => {
    const f = load(v4Project()).flows.f
    delete f.edges.e5.order // A, leftmost
    expect(orderedTargets(f, 'hub')).toEqual(['b', 'c', 'a'])
  })

  it('the bundled examples still export exactly as before', () => {
    const r = parseProject(readFileSync('examples/lighthouse-v2.skein.json', 'utf8'))
    if (!r.ok) throw new Error(r.error)
    const expected = JSON.parse(readFileSync('examples/lighthouse-v2.game.json', 'utf8'))
    expect(buildExport(r.project).file).toEqual(expected)
  })
})

describe('adding to connections without a stored order', () => {
  it('settles their current order first, so a new connection comes last', () => {
    const flow = {
      nodes: { a: { id: 'a', position: { x: 0, y: 0 } }, b: { id: 'b', position: { x: 300, y: 100 } }, c: { id: 'c', position: { x: 0, y: 100 } }, d: { id: 'd', position: { x: 600, y: 100 } } },
      edges: {
        e1: { id: 'e1', source: 'a', target: 'b', sourceHandle: 'out' },
        e2: { id: 'e2', source: 'a', target: 'c', sourceHandle: 'out' }
      } as Record<string, { id: string; source: string; target: string; sourceHandle: string; order?: number }>
    }
    expect(orderedTargets(flow, 'a')).toEqual(['c', 'b'])
    flow.edges.e3 = { id: 'e3', source: 'a', target: 'd', sourceHandle: 'out', order: nextEdgeOrder(flow, 'a', 'out') }
    expect(orderedTargets(flow, 'a')).toEqual(['c', 'b', 'd'])
  })
})
