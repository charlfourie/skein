import { dataRef, isEndNode, isStartNode, outputHandles } from './nodes'
import type { Flow, FlowNode } from './schema'

/**
 * Structural analysis of a flow, recomputed whenever the flow changes
 * (memoised per immutable flow snapshot).
 *
 *  - Orphan:   nothing leads into the node, and it isn't marked as a start.
 *  - Dead end: nothing follows the node, and it isn't marked as an end.
 *  - Loop:     a connection (or jump) that leads back to a node already on the
 *              current path, i.e. the narrative can return to where it was.
 *
 * Loops are found with a depth-first search that starts from start nodes and
 * visits nodes in a fixed order (top-to-bottom, left-to-right), so the same
 * flow always marks the same edges as loop-backs.
 */
export interface FlowAnalysis {
  incoming: Map<string, number>
  outgoing: Map<string, number>
  orphans: Set<string>
  deadEnds: Set<string>
  /** Edges that close a loop. */
  loopEdges: Set<string>
  /** Jump nodes whose target closes a loop. */
  loopJumps: Set<string>
  /** Condition branches with nothing connected: nodeId → missing handle ids. */
  openBranches: Map<string, string[]>
  /** Jump nodes with no target, or a target that isn't in this flow. */
  brokenJumps: Set<string>
  startNodes: string[]
}

const cache = new WeakMap<object, FlowAnalysis>()

function byPosition(a: FlowNode, b: FlowNode): number {
  return a.position.y - b.position.y || a.position.x - b.position.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

export function analyzeFlow(flow: Pick<Flow, 'nodes' | 'edges'>): FlowAnalysis {
  const cached = cache.get(flow)
  if (cached) return cached

  const nodes = Object.values(flow.nodes)
  const incoming = new Map<string, number>()
  const outgoing = new Map<string, number>()
  const bump = (m: Map<string, number>, id: string) => m.set(id, (m.get(id) ?? 0) + 1)

  // Adjacency, in a deterministic order: edges sorted by id, then the jump link.
  type Link = { to: string; edgeId?: string; jumpFrom?: string }
  const links = new Map<string, Link[]>()
  const usedHandles = new Map<string, Set<string>>()
  for (const edge of Object.values(flow.edges).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!flow.nodes[edge.source] || !flow.nodes[edge.target]) continue
    bump(outgoing, edge.source)
    bump(incoming, edge.target)
    const list = links.get(edge.source) ?? []
    list.push({ to: edge.target, edgeId: edge.id })
    links.set(edge.source, list)
    const handles = usedHandles.get(edge.source) ?? new Set<string>()
    handles.add(edge.sourceHandle ?? 'out')
    usedHandles.set(edge.source, handles)
  }

  const brokenJumps = new Set<string>()
  for (const node of nodes) {
    if (node.type !== 'jump') continue
    if (dataRef(node, 'targetFlowId')) {
      bump(outgoing, node.id) // a hand-off to another flow (validation checks that it exists)
      continue
    }
    const target = dataRef(node, 'targetId')
    if (!target || !flow.nodes[target] || target === node.id) {
      brokenJumps.add(node.id)
      continue
    }
    bump(outgoing, node.id)
    bump(incoming, target)
    const list = links.get(node.id) ?? []
    list.push({ to: target, jumpFrom: node.id })
    links.set(node.id, list)
  }

  const orphans = new Set<string>()
  const deadEnds = new Set<string>()
  const openBranches = new Map<string, string[]>()
  for (const node of nodes) {
    if (!incoming.get(node.id) && !isStartNode(node)) orphans.add(node.id)
    if (!outgoing.get(node.id) && !isEndNode(node)) deadEnds.add(node.id)
    if (node.type === 'condition' && !isEndNode(node)) {
      const used = usedHandles.get(node.id) ?? new Set()
      const missing = outputHandles('condition').filter((h) => !used.has(h))
      if (missing.length > 0 && missing.length < 2) openBranches.set(node.id, missing)
    }
  }

  // Loop detection: iterative DFS with an explicit "on current path" set.
  const sorted = nodes.slice().sort(byPosition)
  const startNodes = sorted.filter(isStartNode).map((n) => n.id)
  const roots = [...startNodes, ...sorted.map((n) => n.id)]
  const state = new Map<string, 1 | 2>() // 1 = on path, 2 = done
  const loopEdges = new Set<string>()
  const loopJumps = new Set<string>()

  for (const root of roots) {
    if (state.has(root)) continue
    const stack: Array<{ id: string; i: number }> = [{ id: root, i: 0 }]
    state.set(root, 1)
    while (stack.length) {
      const frame = stack[stack.length - 1]
      const next = links.get(frame.id)?.[frame.i++]
      if (!next) {
        state.set(frame.id, 2)
        stack.pop()
        continue
      }
      const s = state.get(next.to)
      if (s === 1) {
        if (next.edgeId) loopEdges.add(next.edgeId)
        if (next.jumpFrom) loopJumps.add(next.jumpFrom)
      } else if (s === undefined) {
        state.set(next.to, 1)
        stack.push({ id: next.to, i: 0 })
      }
    }
  }

  const result: FlowAnalysis = {
    incoming,
    outgoing,
    orphans,
    deadEnds,
    loopEdges,
    loopJumps,
    openBranches,
    brokenJumps,
    startNodes
  }
  cache.set(flow, result)
  return result
}
