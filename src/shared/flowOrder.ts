import type { Flow, FlowEdge } from './schema'

/**
 * Explicit ordering inside a flow (project format v5).
 *
 * Two things in a flow have an order that changes what the player experiences:
 *  - the connections leaving one output: the order choices are offered in
 *    (dialogue lines and hubs), or tried in (instructions follow the first
 *    available one);
 *  - the start nodes: the first available one is where the flow begins.
 *
 * Up to format v4 both were derived from canvas positions, so moving a node or
 * running auto-layout could silently reorder a player's choices. They are now
 * stored: `edge.order` and `node.data.startOrder`. Positions are only a
 * tie-breaker for data that predates v5 (and the migration assigns orders from
 * exactly that, so old projects keep their behaviour).
 */

type Pos = { x: number; y: number }
type LooseNode = { id: string; position?: Pos; data?: Record<string, unknown> }
type LooseEdge = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; order?: number }
type LooseFlow = { nodes: Record<string, LooseNode>; edges: Record<string, LooseEdge> }

const DEFAULT_HANDLE = 'out'
const INPUT = 'in'

function pos(flow: LooseFlow, id: string): Pos {
  const p = flow.nodes[id]?.position
  return { x: typeof p?.x === 'number' ? p.x : 0, y: typeof p?.y === 'number' ? p.y : 0 }
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** The pre-v5 rule: target left to right, then top to bottom, then id. */
function legacyEdgeCompare(flow: LooseFlow, a: LooseEdge, b: LooseEdge): number {
  const pa = pos(flow, a.target)
  const pb = pos(flow, b.target)
  return pa.x - pb.x || pa.y - pb.y || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** Stored order first; anything without one goes after, in the legacy canvas order. */
export function compareEdges(flow: LooseFlow, a: LooseEdge, b: LooseEdge): number {
  const oa = finite(a.order) ? a.order : Infinity
  const ob = finite(b.order) ? b.order : Infinity
  if (oa !== ob) return oa < ob ? -1 : 1
  return legacyEdgeCompare(flow, a, b)
}

/** Connections leaving `nodeId` (optionally from one output handle), in their play order. */
export function outgoingEdges<F extends LooseFlow>(flow: F, nodeId: string, handle?: string): F['edges'][string][] {
  return Object.values(flow.edges)
    .filter(
      (e) =>
        e.source === nodeId &&
        (handle === undefined || (e.sourceHandle ?? DEFAULT_HANDLE) === handle) &&
        (e.targetHandle ?? INPUT) === INPUT &&
        flow.nodes[e.target] !== undefined
    )
    .sort((a, b) => compareEdges(flow, a, b)) as F['edges'][string][]
}

/** Target node ids of `outgoingEdges`, in play order. */
export function orderedTargets(flow: LooseFlow, nodeId: string, handle?: string): string[] {
  return outgoingEdges(flow, nodeId, handle).map((e) => e.target)
}

/**
 * Give every connection on this output a stored order, keeping the order they
 * play in now. Connections without one (hand-written or older data) sort after
 * any that have one, so this must run before a new, ordered connection joins them.
 */
export function settleEdgeOrder(flow: LooseFlow, source: string, handle: string): void {
  const edges = outgoingEdges(flow, source, handle)
  if (edges.every((e) => finite(e.order))) return
  edges.forEach((e, i) => {
    e.order = i
  })
}

/** The order value for a new connection added after the existing ones on that output (settle the order first). */
export function nextEdgeOrder(flow: LooseFlow, source: string, handle: string): number {
  settleEdgeOrder(flow, source, handle)
  let max = -1
  for (const e of Object.values(flow.edges)) {
    if (e.source === source && (e.sourceHandle ?? DEFAULT_HANDLE) === handle && finite(e.order)) max = Math.max(max, e.order)
  }
  return max + 1
}

const startOrderOf = (n: LooseNode) => {
  const v = n.data?.startOrder
  return finite(v) ? v : Infinity
}

function legacyStartCompare(a: LooseNode, b: LooseNode): number {
  const pa = a.position ?? { x: 0, y: 0 }
  const pb = b.position ?? { x: 0, y: 0 }
  return pa.y - pb.y || pa.x - pb.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

export function compareStarts(a: LooseNode, b: LooseNode): number {
  const oa = startOrderOf(a)
  const ob = startOrderOf(b)
  if (oa !== ob) return oa < ob ? -1 : 1
  return legacyStartCompare(a, b)
}

/** Start nodes in priority order: the first available one is where the flow begins. */
export function startNodes<F extends LooseFlow>(flow: F): F['nodes'][string][] {
  return Object.values(flow.nodes)
    .filter((n) => n.data?.isStart === true)
    .sort(compareStarts) as F['nodes'][string][]
}

export function nextStartOrder(flow: LooseFlow): number {
  let max = -1
  for (const n of Object.values(flow.nodes)) {
    if (n.data?.isStart === true && finite(n.data.startOrder)) max = Math.max(max, n.data.startOrder)
  }
  return max + 1
}

/** Output handles with more than one connection, where order is meaningful. */
export function isOrderedHandle(type: string, handle: string): boolean {
  return handle === DEFAULT_HANDLE && (type === 'dialogue' || type === 'hub' || type === 'instruction' || type === 'call')
}

/**
 * For each connection that is one of several on the same ordered output:
 * its 1-based position and the group size. Used to number choices on the canvas.
 */
export function choiceNumbers(flow: Pick<Flow, 'nodes' | 'edges'>): Map<string, { index: number; count: number }> {
  const out = new Map<string, { index: number; count: number }>()
  const groups = new Map<string, FlowEdge[]>()
  for (const e of Object.values(flow.edges)) {
    const source = flow.nodes[e.source]
    const handle = e.sourceHandle ?? DEFAULT_HANDLE
    if (!source || !isOrderedHandle(source.type, handle) || !flow.nodes[e.target]) continue
    const key = `${e.source}\u0000${handle}`
    const list = groups.get(key) ?? []
    list.push(e)
    groups.set(key, list)
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue
    list.sort((a, b) => compareEdges(flow, a, b))
    list.forEach((e, i) => out.set(e.id, { index: i + 1, count: list.length }))
  }
  return out
}

/**
 * Give every connection and start node an explicit order, preserving the order
 * they currently play in. Gaps and missing values are renumbered 0..n-1 per
 * output. Mutates `flow`; returns true if anything changed.
 */
export function normalizeOrders(flow: LooseFlow): boolean {
  let changed = false
  const groups = new Map<string, LooseEdge[]>()
  for (const e of Object.values(flow.edges)) {
    const key = `${e.source}\u0000${e.sourceHandle ?? DEFAULT_HANDLE}`
    const list = groups.get(key) ?? []
    list.push(e)
    groups.set(key, list)
  }
  for (const list of groups.values()) {
    list.sort((a, b) => compareEdges(flow, a, b))
    list.forEach((e, i) => {
      if (e.order !== i) {
        e.order = i
        changed = true
      }
    })
  }
  const starts = Object.values(flow.nodes).filter((n) => n.data?.isStart === true).sort(compareStarts)
  starts.forEach((n, i) => {
    if (n.data!.startOrder !== i) {
      n.data!.startOrder = i
      changed = true
    }
  })
  for (const n of Object.values(flow.nodes)) {
    if (n.data && n.data.isStart !== true && 'startOrder' in n.data) {
      delete n.data.startOrder
      changed = true
    }
  }
  return changed
}

