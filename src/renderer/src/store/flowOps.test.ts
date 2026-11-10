import { beforeEach, describe, expect, it } from 'vitest'
import { createEmptyProject } from '@shared/factory'
import { addNode, computeLayout, connect, deleteElements, duplicateNodes, moveNodes, reconnect, updateNodeData } from './flowOps'
import { selectDirty, useProjectStore } from './projectStore'

const s = () => useProjectStore.getState()
let flowId = ''
const flow = () => s().project!.flows[flowId]

beforeEach(() => {
  s().loadProject(createEmptyProject('Flows'), null)
  flowId = Object.keys(s().project!.flows)[0]
})

describe('flow operations', () => {
  it('the first node becomes the start; positions are whole pixels', () => {
    const a = addNode(flowId, 'dialogue', { x: 10.6, y: 20.2 })!
    const b = addNode(flowId, 'dialogue', { x: 10, y: 200 })!
    expect(flow().nodes[a].data).toEqual({ isStart: true })
    expect(flow().nodes[b].data).toEqual({})
    expect(flow().nodes[a].position).toEqual({ x: 11, y: 20 })
    moveNodes(flowId, { [b]: { x: 33.3, y: 44.9 } })
    expect(flow().nodes[b].position).toEqual({ x: 33, y: 45 })
  })

  it('connects, rejects invalid connections, and creates connected nodes', () => {
    const a = addNode(flowId, 'dialogue', { x: 0, y: 0 })!
    const b = addNode(flowId, 'dialogue', { x: 0, y: 100 }, { source: a, sourceHandle: 'out' })!
    expect(Object.values(flow().edges)).toHaveLength(1)
    expect(connect(flowId, { source: a, sourceHandle: 'out', target: b, targetHandle: 'in' })).toBeNull() // duplicate
    expect(connect(flowId, { source: a, sourceHandle: 'out', target: a, targetHandle: 'in' })).toBeNull() // self
  })

  it('a condition branch holds one connection; reconnecting replaces it', () => {
    const c = addNode(flowId, 'condition', { x: 0, y: 0 })!
    const x = addNode(flowId, 'dialogue', { x: 0, y: 100 })!
    const y = addNode(flowId, 'dialogue', { x: 200, y: 100 })!
    connect(flowId, { source: c, sourceHandle: 'true', target: x, targetHandle: 'in' })
    const second = connect(flowId, { source: c, sourceHandle: 'true', target: y, targetHandle: 'in' })!
    expect(Object.keys(flow().edges)).toEqual([second])
    const f = connect(flowId, { source: c, sourceHandle: 'false', target: x, targetHandle: 'in' })!
    expect(reconnect(flowId, f, { source: c, sourceHandle: 'true', target: x, targetHandle: 'in' })).toBe(true)
    expect(Object.keys(flow().edges)).toEqual([f]) // the old "true" edge gave way
  })

  it('node data patches drop empty values', () => {
    const a = addNode(flowId, 'dialogue', { x: 0, y: 0 })!
    updateNodeData(flowId, a, { text: 'Hi', isEnd: true })
    updateNodeData(flowId, a, { text: '', isStart: false })
    expect(flow().nodes[a].data).toEqual({ isEnd: true })
  })

  it('delete is one undo step and undo brings edges back', () => {
    const a = addNode(flowId, 'dialogue', { x: 0, y: 0 })!
    addNode(flowId, 'dialogue', { x: 0, y: 100 }, { source: a, sourceHandle: 'out' })
    const before = s().project
    deleteElements(flowId, [a], [])
    expect(Object.keys(flow().edges)).toHaveLength(0)
    s().undo()
    expect(s().project).toBe(before)
  })

  it('duplicates nodes with their internal connections, never as a second start', () => {
    const a = addNode(flowId, 'dialogue', { x: 0, y: 0 })!
    const b = addNode(flowId, 'dialogue', { x: 0, y: 100 }, { source: a, sourceHandle: 'out' })!
    const copies = duplicateNodes(flowId, [a, b])
    expect(copies).toHaveLength(2)
    expect(Object.keys(flow().edges)).toHaveLength(2)
    expect(flow().nodes[copies[0]].data.isStart).toBeUndefined()
  })

  it('auto-layout is deterministic and keeps loops from pulling targets down', () => {
    const a = addNode(flowId, 'dialogue', { x: 500, y: 500 })!
    const b = addNode(flowId, 'dialogue', { x: 0, y: 0 }, { source: a, sourceHandle: 'out' })!
    connect(flowId, { source: b, sourceHandle: 'out', target: a, targetHandle: 'in' }) // loop back
    const sizes = { [a]: { width: 260, height: 100 }, [b]: { width: 260, height: 100 } }
    const one = computeLayout(flow(), sizes)
    const two = computeLayout(flow(), sizes)
    expect(one).toEqual(two)
    expect(one[a].y).toBeLessThan(one[b].y)
    expect(Number.isInteger(one[a].x) && Number.isInteger(one[b].y)).toBe(true)
    expect(selectDirty(s())).toBe(true)
  })
})
