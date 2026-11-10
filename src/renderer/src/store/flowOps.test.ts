import { beforeEach, describe, expect, it } from 'vitest'
import { createEmptyProject } from '@shared/factory'
import { buildExport } from '@shared/export/build'
import { orderedTargets, startNodes } from '@shared/flowOrder'
import { addFrame, addNode, autoLayout, computeLayout, connect, deleteElements, duplicateNodes, moveChoice, moveNodes, moveStart, placeFrame, reconnect, updateFrame, updateNodeData } from './flowOps'
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
    expect(flow().nodes[a].data).toEqual({ isStart: true, startOrder: 0 })
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

  it('new connections go last; moving a choice reorders what the player sees', () => {
    const hub = addNode(flowId, 'hub', { x: 0, y: 0 })!
    // Created right-to-left on purpose: order follows creation, not position.
    const c = addNode(flowId, 'dialogue', { x: 400, y: 200 }, { source: hub, sourceHandle: 'out' })!
    const b = addNode(flowId, 'dialogue', { x: 0, y: 200 }, { source: hub, sourceHandle: 'out' })!
    const a = addNode(flowId, 'dialogue', { x: -400, y: 200 }, { source: hub, sourceHandle: 'out' })!
    expect(orderedTargets(flow(), hub)).toEqual([c, b, a])
    const edgeA = Object.values(flow().edges).find((e) => e.target === a)!.id
    expect(moveChoice(flowId, edgeA, -1)).toBe(true)
    expect(moveChoice(flowId, edgeA, -1)).toBe(true)
    expect(moveChoice(flowId, edgeA, -1)).toBe(false) // already first
    expect(orderedTargets(flow(), hub)).toEqual([a, c, b])
    expect((buildExport(s().project!).file.flows[flowId].nodes[hub] as { next: string[] }).next).toEqual([a, c, b])
    s().undo()
    expect(orderedTargets(flow(), hub)).toEqual([c, a, b])
  })

  it('moving nodes and auto-layout never change choice or start order', () => {
    const s1 = addNode(flowId, 'hub', { x: 0, y: 0 })!
    const s2 = addNode(flowId, 'dialogue', { x: 300, y: -200 })!
    updateNodeData(flowId, s2, { isStart: true })
    const kids = [0, 1, 2, 3].map((i) => addNode(flowId, 'dialogue', { x: i * 50, y: 300 + i * 10 }, { source: s1, sourceHandle: 'out' })!)
    const before = JSON.stringify(buildExport(s().project!).file)
    moveNodes(flowId, { [kids[0]]: { x: 900, y: 900 }, [kids[3]]: { x: -900, y: -900 }, [s2]: { x: 0, y: -999 } })
    autoLayout(flowId, {})
    expect(JSON.stringify(buildExport(s().project!).file)).toBe(before)
  })

  it('reconnecting to another output puts the connection last there; changing only the target keeps its place', () => {
    const h1 = addNode(flowId, 'hub', { x: 0, y: 0 })!
    const h2 = addNode(flowId, 'hub', { x: 500, y: 0 })!
    const x = addNode(flowId, 'dialogue', { x: 0, y: 200 }, { source: h1, sourceHandle: 'out' })!
    const y = addNode(flowId, 'dialogue', { x: 200, y: 200 }, { source: h1, sourceHandle: 'out' })!
    const z = addNode(flowId, 'dialogue', { x: 600, y: 200 }, { source: h2, sourceHandle: 'out' })!
    const w = addNode(flowId, 'dialogue', { x: 800, y: 200 })!
    const ex = Object.values(flow().edges).find((e) => e.target === x)!.id
    expect(reconnect(flowId, ex, { source: h1, sourceHandle: 'out', target: w, targetHandle: 'in' })).toBe(true)
    expect(orderedTargets(flow(), h1)).toEqual([w, y]) // same place
    expect(reconnect(flowId, ex, { source: h2, sourceHandle: 'out', target: w, targetHandle: 'in' })).toBe(true)
    expect(orderedTargets(flow(), h2)).toEqual([z, w]) // last on the new output
  })

  it('start priority: new starts go last, can be reordered, and are dropped when unmarked', () => {
    const a = addNode(flowId, 'dialogue', { x: 0, y: 500 })! // first node: the start
    const b = addNode(flowId, 'dialogue', { x: 0, y: 0 })!
    const c = addNode(flowId, 'dialogue', { x: 0, y: 100 })!
    updateNodeData(flowId, b, { isStart: true })
    updateNodeData(flowId, c, { isStart: true })
    expect(startNodes(flow()).map((n) => n.id)).toEqual([a, b, c]) // not top-to-bottom: priority
    expect(moveStart(flowId, c, -1)).toBe(true)
    expect(startNodes(flow()).map((n) => n.id)).toEqual([a, c, b])
    expect(buildExport(s().project!).file.flows[flowId].start).toEqual([a, c, b])
    updateNodeData(flowId, a, { isStart: false })
    expect(flow().nodes[a].data.startOrder).toBeUndefined()
    expect(startNodes(flow()).map((n) => n.id)).toEqual([c, b])
    const [copy] = duplicateNodes(flowId, [c])
    expect(flow().nodes[copy].data.startOrder).toBeUndefined()
  })

  it('frames: wrap a selection, move with their nodes in one undo, rename, refit on auto-layout, and delete without taking nodes', () => {
    const a = addNode(flowId, 'dialogue', { x: 0, y: 0 })!
    const b = addNode(flowId, 'dialogue', { x: 0, y: 300 }, { source: a, sourceHandle: 'out' })!
    const outside = addNode(flowId, 'dialogue', { x: 3000, y: 0 })!
    const fr = addFrame(flowId, { around: [a, b] })!
    expect(flow().frames?.[fr]).toMatchObject({ label: 'Scene', position: { x: -32, y: -56 }, width: 324, height: 488 })
    updateFrame(flowId, fr, { label: 'Arrival', color: 'teal' })
    expect(flow().frames?.[fr]).toMatchObject({ label: 'Arrival', color: 'teal' })
    placeFrame(flowId, fr, { position: { x: 68, y: 44 } }, { [a]: { x: 100, y: 100 }, [b]: { x: 100, y: 400 } })
    expect(flow().nodes[a].position).toEqual({ x: 100, y: 100 })
    expect(flow().frames?.[fr].position).toEqual({ x: 68, y: 44 })
    s().undo()
    expect(flow().nodes[a].position).toEqual({ x: 0, y: 0 }) // frame and nodes undo together
    expect(flow().frames?.[fr].position).toEqual({ x: -32, y: -56 })
    autoLayout(flowId, {})
    const f = flow().frames![fr]
    const na = flow().nodes[a].position
    expect(na.x - f.position.x).toBe(32) // refit around its nodes
    expect(na.y - f.position.y).toBe(56)
    deleteElements(flowId, [], [], [fr])
    expect(flow().frames).toBeUndefined()
    expect(Object.keys(flow().nodes).sort()).toEqual([a, b, outside].sort())
  })
})
