import { describe, expect, it } from 'vitest'
import { align, reachable } from './arrange'

const flow = {
  nodes: Object.fromEntries(['a', 'b', 'c', 'd', 'x', 'j'].map((id) => [id, { id, type: id === 'j' ? 'jump' : 'dialogue', position: { x: 0, y: 0 }, data: id === 'j' ? { targetId: 'a' } : {} }])),
  edges: {
    e1: { id: 'e1', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in' },
    e2: { id: 'e2', source: 'b', target: 'c', sourceHandle: 'out', targetHandle: 'in' },
    e3: { id: 'e3', source: 'b', target: 'd', sourceHandle: 'out', targetHandle: 'in' },
    e4: { id: 'e4', source: 'x', target: 'j', sourceHandle: 'out', targetHandle: 'in' }
  }
} as never

describe('reachable', () => {
  it('follows connections and jumps forward and back', () => {
    expect([...reachable(flow, 'a', 'after')].sort()).toEqual(['b', 'c', 'd'])
    expect([...reachable(flow, 'c', 'before')].sort()).toEqual(['a', 'b', 'j', 'x'])
    expect([...reachable(flow, 'x', 'after')].sort()).toEqual(['a', 'b', 'c', 'd', 'j'])
  })
})

describe('align', () => {
  const boxes = [
    { id: 'a', position: { x: 0, y: 0 }, width: 100, height: 40 },
    { id: 'b', position: { x: 50, y: 300 }, width: 200, height: 60 },
    { id: 'c', position: { x: 400, y: 100 }, width: 100, height: 40 }
  ]
  it('lines up edges and centres on one axis only', () => {
    expect(align(boxes, 'left')).toEqual({ a: { x: 0, y: 0 }, b: { x: 0, y: 300 }, c: { x: 0, y: 100 } })
    expect(align(boxes, 'right').b).toEqual({ x: 300, y: 300 })
    expect(align(boxes, 'center').a).toEqual({ x: 200, y: 0 })
    expect(align(boxes, 'top').b).toEqual({ x: 50, y: 0 })
    expect(align(boxes, 'bottom').a).toEqual({ x: 0, y: 320 })
  })
  it('spreads with equal gaps, keeping the outer two in place', () => {
    const r = align(boxes, 'spreadY') // spans 0..360; heights 40+40+60 = 140; gaps (360-140)/2 = 110
    expect(r).toEqual({ a: { x: 0, y: 0 }, c: { x: 400, y: 150 }, b: { x: 50, y: 300 } })
  })
})
