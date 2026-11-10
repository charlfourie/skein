import dagre from '@dagrejs/dagre'
import type { Draft } from 'immer'
import { analyzeFlow } from '@shared/flowAnalysis'
import { compareEdges, nextEdgeOrder, nextStartOrder, normalizeOrders, outgoingEdges, startNodes } from '@shared/flowOrder'
import { newId } from '@shared/ids'
import { deleteFlowElements } from '@shared/mutations'
import { canConnect, INPUT_HANDLE, isExclusiveHandle, isUnsetValue, outputHandles, type ConnectionLike, type NodeType } from '@shared/nodes'
import type { Flow, Position, Project } from '@shared/schema'
import { useProjectStore } from './projectStore'

/** Canvas edits. Each call is one undoable step. */

const store = () => useProjectStore.getState()

function editFlow(label: string, flowId: string, recipe: (flow: Draft<Flow>, project: Draft<Project>) => void): boolean {
  return store().edit(label, (p) => {
    const flow = p.flows[flowId]
    if (flow) recipe(flow, p)
  })
}

/** Positions are stored as whole pixels so dragging doesn't produce float noise in diffs. */
export function roundPosition(p: Position): Position {
  return { x: Math.round(p.x), y: Math.round(p.y) }
}

export const NODE_LABELS: Record<NodeType, string> = {
  dialogue: 'Dialogue',
  condition: 'Condition',
  instruction: 'Instruction',
  hub: 'Hub',
  jump: 'Jump'
}

export function addNode(
  flowId: string,
  type: NodeType,
  position: Position,
  connectFrom?: { source: string; sourceHandle: string | null }
): string | null {
  const id = newId()
  const ok = editFlow(`Add ${NODE_LABELS[type].toLowerCase()}`, flowId, (flow) => {
    // The first node of an empty flow is where it starts.
    const data: Record<string, unknown> = Object.keys(flow.nodes).length === 0 ? { isStart: true, startOrder: 0 } : {}
    flow.nodes[id] = { id, type, position: roundPosition(position), data }
    if (connectFrom) {
      const conn = { source: connectFrom.source, sourceHandle: connectFrom.sourceHandle, target: id, targetHandle: INPUT_HANDLE }
      if (canConnect(flow, conn).ok) addEdgeInPlace(flow, conn)
    }
  })
  if (!ok) return null
  store().select({ kind: 'node', flowId, id })
  return id
}

export function moveNodes(flowId: string, positions: Record<string, Position>): void {
  editFlow('Move', flowId, (flow) => {
    for (const [id, pos] of Object.entries(positions)) {
      const node = flow.nodes[id]
      if (!node) continue
      const next = roundPosition(pos)
      if (node.position.x !== next.x || node.position.y !== next.y) node.position = next
    }
  })
}

/** Patch node data. Empty strings, false and null remove the field. */
export function updateNodeData(flowId: string, nodeId: string, patch: Record<string, unknown>): void {
  editFlow('Edit node', flowId, (flow) => {
    const node = flow.nodes[nodeId]
    if (!node) return
    const wasStart = node.data.isStart === true
    for (const [key, value] of Object.entries(patch)) {
      if (isUnsetValue(value)) {
        if (key in node.data) delete node.data[key]
      } else if (node.data[key] !== value) {
        node.data[key] = value
      }
    }
    // A new start node goes last in priority; one that stops being a start drops its place.
    const isStart = node.data.isStart === true
    if (isStart && !wasStart) node.data.startOrder = nextStartOrder(flow)
    if (!isStart && 'startOrder' in node.data) delete node.data.startOrder
  })
}

function addEdgeInPlace(flow: Draft<Flow>, c: ConnectionLike): string {
  const source = flow.nodes[c.source as string]
  const sourceHandle = c.sourceHandle ?? outputHandles(source.type)[0]
  if (isExclusiveHandle(source.type, sourceHandle)) {
    for (const [id, e] of Object.entries(flow.edges)) {
      if (e.source === source.id && e.sourceHandle === sourceHandle) delete flow.edges[id]
    }
  }
  const id = newId()
  const order = nextEdgeOrder(flow, source.id, sourceHandle)
  flow.edges[id] = { id, source: source.id, sourceHandle, target: c.target as string, targetHandle: INPUT_HANDLE, order }
  return id
}

export function connect(flowId: string, c: ConnectionLike): string | null {
  const flow = store().project?.flows[flowId]
  if (!flow || !canConnect(flow, c).ok) return null
  let id: string | null = null
  editFlow('Connect', flowId, (f) => {
    id = addEdgeInPlace(f, c)
  })
  return id
}

/** Move an existing connection's end(s), keeping its id. */
export function reconnect(flowId: string, edgeId: string, c: ConnectionLike): boolean {
  const flow = store().project?.flows[flowId]
  const edge = flow?.edges[edgeId]
  if (!flow || !edge) return false
  // Check against the flow without this edge, so "reconnect to the same place" is allowed.
  const { [edgeId]: _omit, ...others } = flow.edges
  void _omit
  if (!canConnect({ nodes: flow.nodes, edges: others }, c).ok) return false
  return editFlow('Reconnect', flowId, (f) => {
    const source = f.nodes[c.source as string]
    const sourceHandle = c.sourceHandle ?? outputHandles(source.type)[0]
    if (isExclusiveHandle(source.type, sourceHandle)) {
      for (const [id, e] of Object.entries(f.edges)) {
        if (id !== edgeId && e.source === source.id && e.sourceHandle === sourceHandle) delete f.edges[id]
      }
    }
    const e = f.edges[edgeId]
    const sameOutput = e.source === source.id && (e.sourceHandle ?? 'out') === sourceHandle
    // Changing only the target keeps the choice's place; moving it to another output puts it last there.
    if (!sameOutput) e.order = nextEdgeOrder({ nodes: f.nodes, edges: Object.fromEntries(Object.entries(f.edges).filter(([id]) => id !== edgeId)) }, source.id, sourceHandle)
    e.source = source.id
    e.sourceHandle = sourceHandle
    e.target = c.target as string
    e.targetHandle = INPUT_HANDLE
  })
}

export function deleteElements(flowId: string, nodeIds: string[], edgeIds: string[]): void {
  if (nodeIds.length === 0 && edgeIds.length === 0) return
  editFlow(nodeIds.length ? 'Delete nodes' : 'Delete connections', flowId, (flow) =>
    deleteFlowElements(flow, nodeIds, edgeIds)
  )
  store().select({ kind: 'flow', id: flowId })
}

/** Copy nodes (and the connections between them) slightly offset. Returns the new ids. */
export function duplicateNodes(flowId: string, nodeIds: string[]): string[] {
  const flow = store().project?.flows[flowId]
  if (!flow || nodeIds.length === 0) return []
  const map = new Map(nodeIds.filter((id) => flow.nodes[id]).map((id) => [id, newId()]))
  editFlow('Duplicate nodes', flowId, (f) => {
    for (const [oldId, id] of map) {
      const src = flow.nodes[oldId]
      const data = { ...src.data }
      delete data.isStart // a copy is never a second entry point
      delete data.startOrder
      if (typeof data.targetId === 'string' && map.has(data.targetId)) data.targetId = map.get(data.targetId)
      f.nodes[id] = { ...src, id, position: roundPosition({ x: src.position.x + 40, y: src.position.y + 40 }), data }
    }
    for (const e of Object.values(flow.edges)) {
      const s = map.get(e.source)
      const t = map.get(e.target)
      if (s && t) {
        const id = newId()
        f.edges[id] = { ...e, id, source: s, target: t }
      }
    }
  })
  return [...map.values()]
}

/**
 * Move a connection one place earlier (-1) or later (+1) among the connections
 * leaving the same output: this is the order the player sees the choices in.
 */
export function moveChoice(flowId: string, edgeId: string, delta: -1 | 1): boolean {
  const flow = store().project?.flows[flowId]
  const edge = flow?.edges[edgeId]
  if (!flow || !edge) return false
  const siblings = outgoingEdges(flow, edge.source, edge.sourceHandle ?? 'out')
  const i = siblings.findIndex((e) => e.id === edgeId)
  const j = i + delta
  if (i < 0 || j < 0 || j >= siblings.length) return false
  const ids = siblings.map((e) => e.id)
  ;[ids[i], ids[j]] = [ids[j], ids[i]]
  return editFlow(delta < 0 ? 'Move choice up' : 'Move choice down', flowId, (f) => {
    ids.forEach((id, order) => {
      if (f.edges[id] && f.edges[id].order !== order) f.edges[id].order = order
    })
  })
}

/** Move a start node one place earlier (-1) or later (+1) in priority. */
export function moveStart(flowId: string, nodeId: string, delta: -1 | 1): boolean {
  const flow = store().project?.flows[flowId]
  if (!flow?.nodes[nodeId]) return false
  const ids = startNodes(flow).map((n) => n.id)
  const i = ids.indexOf(nodeId)
  const j = i + delta
  if (i < 0 || j < 0 || j >= ids.length) return false
  ;[ids[i], ids[j]] = [ids[j], ids[i]]
  return editFlow(delta < 0 ? 'Raise start priority' : 'Lower start priority', flowId, (f) => {
    ids.forEach((id, order) => {
      if (f.nodes[id] && f.nodes[id].data.startOrder !== order) f.nodes[id].data.startOrder = order
    })
  })
}

/** Renumber orders 0..n-1 (keeping the current play order). Used after bulk edits. */
export function tidyOrders(flowId: string): void {
  editFlow('Tidy order', flowId, (f) => {
    normalizeOrders(f)
  })
}

/**
 * Lay the flow out top-to-bottom with dagre. Loop-back edges are left out of
 * the layout graph so loops don't drag their targets downwards.
 */
export function autoLayout(flowId: string, sizes: Record<string, { width: number; height: number }>): void {
  const flow = store().project?.flows[flowId]
  if (!flow) return
  const positions = computeLayout(flow, sizes)
  editFlow('Auto-layout', flowId, (f) => {
    for (const [id, pos] of Object.entries(positions)) {
      const node = f.nodes[id]
      if (node && (node.position.x !== pos.x || node.position.y !== pos.y)) node.position = pos
    }
  })
}

export function computeLayout(
  flow: Pick<Flow, 'nodes' | 'edges'>,
  sizes: Record<string, { width: number; height: number }>
): Record<string, Position> {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 48, ranksep: 72, marginx: 0, marginy: 0 })
  g.setDefaultEdgeLabel(() => ({}))
  const loops = analyzeFlow(flow).loopEdges
  const ids = Object.keys(flow.nodes).sort()
  for (const id of ids) {
    const size = sizes[id] ?? { width: 240, height: 96 }
    g.setNode(id, { width: size.width, height: size.height })
  }
  // Edges go in per source in play order, so dagre tends to lay choices out left to right in that order.
  const edges = Object.values(flow.edges).sort(
    (a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0) || compareEdges(flow, a, b)
  )
  for (const e of edges) {
    if (!loops.has(e.id) && flow.nodes[e.source] && flow.nodes[e.target]) g.setEdge(e.source, e.target)
  }
  dagre.layout(g)
  const out: Record<string, Position> = {}
  for (const id of ids) {
    const n = g.node(id)
    out[id] = roundPosition({ x: n.x - n.width / 2, y: n.y - n.height / 2 })
  }
  return out
}
