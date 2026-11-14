/**
 * Quick line entry: writing a scene from the keyboard.
 *
 *  - the next line goes below the current one, connected to it, spoken by
 *    whoever spoke before (so a two-person exchange alternates by itself);
 *  - another choice goes beside the current one, from the same parent;
 *  - the speaker can be stepped through without reaching for the mouse.
 *
 * Everything here works on plain objects or Immer drafts. Placement never
 * overlaps an existing node: the caller passes the sizes it knows (the canvas
 * measures nodes), and anything unmeasured is estimated.
 */
import { compareOrder } from './order'
import { nextEdgeOrder, outgoingEdges, settleEdgeOrder } from './flowOrder'
import type { Size } from './frames'
import { assignLineId } from './lineIds'
import { branchHandles, canConnect, INPUT_HANDLE, isExclusiveHandle, outputHandles } from './nodes'
import type { Flow, FlowNode, Position, Project } from './schema'

/** What a fresh dialogue node measures on the canvas, roughly. */
export const NEW_LINE_SIZE: Size = { width: 260, height: 96 }
const GAP_Y = 56
const GAP_X = 40
const STEP = 24

export type SizeOf = (nodeId: string) => Size | undefined

const sizeOr = (sizeOf: SizeOf | undefined, node: FlowNode): Size => {
  const known = sizeOf?.(node.id)
  if (known) return known
  return { width: node.type === 'hub' || node.type === 'jump' || node.type === 'call' ? 200 : 260, height: NEW_LINE_SIZE.height }
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width + GAP_X / 2 && b.x < a.x + a.width + GAP_X / 2 && a.y < b.y + b.height + GAP_Y / 2 && b.y < a.y + a.height + GAP_Y / 2

/** The first spot from `start`, stepping down (or right), where a node of `size` overlaps no node (frames are backgrounds). */
export function freeSpot(flow: Flow, start: Position, size: Size, direction: 'down' | 'right', sizeOf?: SizeOf): Position {
  const boxes = Object.values(flow.nodes).map((n) => ({ ...n.position, ...sizeOr(sizeOf, n) }))
  let p = { x: Math.round(start.x), y: Math.round(start.y) }
  for (let i = 0; i < 400; i++) {
    const hit = boxes.find((b) => overlaps({ ...p, ...size }, b))
    if (!hit) return p
    p = direction === 'down' ? { x: p.x, y: Math.max(p.y + STEP, hit.y + hit.height + GAP_Y) } : { x: Math.max(p.x + STEP, hit.x + hit.width + GAP_X), y: p.y }
  }
  return p
}

// ---- Speakers ---------------------------------------------------------------

/** Entities in the order the speaker picker lists them: by template, then their own order. */
export function speakerOrder(project: Project): string[] {
  return Object.values(project.entities)
    .sort((a, b) => {
      const ta = project.templates[a.templateId]?.name ?? ''
      const tb = project.templates[b.templateId]?.name ?? ''
      return ta.localeCompare(tb) || compareOrder(a, b)
    })
    .map((e) => e.id)
}

const speakerOf = (n: FlowNode | undefined): string | undefined => (typeof n?.data.speakerId === 'string' ? n.data.speakerId : undefined)

/**
 * Who speaks the line after `nodeId`: the last speaker before this one along
 * the way the story came (so A, B, A, B…). With no one before, the speaker
 * this flow (then the project) hears most besides the current one.
 */
export function nextSpeaker(project: Project, flow: Flow, nodeId: string): string | undefined {
  const current = speakerOf(flow.nodes[nodeId])
  const incoming = new Map<string, string>()
  for (const e of Object.values(flow.edges)) if (!incoming.has(e.target)) incoming.set(e.target, e.source)
  const seen = new Set([nodeId])
  let at = incoming.get(nodeId)
  while (at && !seen.has(at)) {
    seen.add(at)
    const s = speakerOf(flow.nodes[at])
    if (s && s !== current && project.entities[s]) return s
    at = incoming.get(at)
  }
  const mostHeard = (flows: Flow[]) => {
    const counts = new Map<string, number>()
    for (const f of flows) for (const n of Object.values(f.nodes)) {
      const s = speakerOf(n)
      if (s && s !== current && project.entities[s]) counts.set(s, (counts.get(s) ?? 0) + 1)
    }
    return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0]
  }
  return mostHeard([flow]) ?? mostHeard(Object.values(project.flows)) ?? current
}

/** The speaker one step up or down the picker's list (wrapping, through "no speaker"). */
export function cycleSpeaker(project: Project, current: string | undefined, step: 1 | -1): string | undefined {
  const list: (string | undefined)[] = [undefined, ...speakerOrder(project)]
  const at = Math.max(0, list.indexOf(current && project.entities[current] ? current : undefined))
  return list[(at + step + list.length) % list.length]
}

// ---- Adding lines -----------------------------------------------------------

function newLine(project: Project, flow: Flow, id: string, position: Position, speakerId: string | undefined): FlowNode {
  const node: FlowNode = { id, type: 'dialogue', position, data: speakerId ? { speakerId } : {} }
  flow.nodes[id] = node
  assignLineId(project, flow, flow.nodes[id])
  return flow.nodes[id]
}

/**
 * Add a line after `nodeId`, connected from it. If the node led straight on to
 * one other node, the new line goes in between (and what was below moves down
 * to make room); otherwise it's placed in the first free spot below.
 * Returns the new node's id, or null if nothing can follow that node.
 */
export function insertLineAfter(
  project: Project,
  flowId: string,
  nodeId: string,
  options: { speakerId?: string; newId: () => string; sizeOf?: SizeOf }
): string | null {
  const flow = project.flows[flowId]
  const from = flow?.nodes[nodeId]
  if (!flow || !from) return null
  const handles = branchHandles(from.type)
  if (!handles.length) return null
  // Condition: the first branch still free, else the true branch.
  const handle = handles.find((h) => !outgoingEdges(flow, nodeId, h).length) ?? handles[0]
  const out = outgoingEdges(flow, nodeId, handle)
  const between = handles.length === 1 && out.length === 1 ? out[0] : null

  const fromSize = sizeOr(options.sizeOf, from)
  const below = { x: from.position.x, y: from.position.y + fromSize.height + GAP_Y }
  let position: Position
  if (between) {
    position = below
    makeRoom(flow, position, NEW_LINE_SIZE, options.sizeOf, nodeId)
  } else {
    const start = handles.length > 1 ? { x: from.position.x + (handle === handles[0] ? -140 : 140), y: below.y } : below
    position = freeSpot(flow, start, NEW_LINE_SIZE, 'down', options.sizeOf)
  }

  const id = options.newId()
  const line = newLine(project, flow, id, position, options.speakerId)
  // The scene goes on past a line marked as an end: the end moves to the new last line.
  if (from.data.isEnd === true && !between) {
    delete from.data.isEnd
    line.data.isEnd = true
  }
  if (between) {
    const target = between.target
    between.target = id // keep the connection (and its order); the old target now follows the new line
    const edgeId = options.newId()
    flow.edges[edgeId] = { id: edgeId, source: id, sourceHandle: 'out', target, targetHandle: INPUT_HANDLE, order: 0 }
  } else {
    connectInPlace(flow, { source: nodeId, sourceHandle: handle, target: id }, options.newId)
  }
  return id
}

/**
 * Add another choice beside `nodeId`: a line from the same parent, offered
 * right after it, by the same speaker. Null if the node has no parent.
 */
export function addChoiceBeside(project: Project, flowId: string, nodeId: string, options: { newId: () => string; sizeOf?: SizeOf }): string | null {
  const flow = project.flows[flowId]
  const node = flow?.nodes[nodeId]
  if (!flow || !node) return null
  const edge = Object.values(flow.edges)
    .filter((e) => e.target === nodeId && flow.nodes[e.source])
    .sort((a, b) => (a.id < b.id ? -1 : 1))[0]
  if (!edge) return null
  const parent = flow.nodes[edge.source]
  const handle = edge.sourceHandle ?? outputHandles(parent.type)[0]
  if (isExclusiveHandle(parent.type, handle)) return null // a condition branch holds one connection

  const size = sizeOr(options.sizeOf, node)
  const position = freeSpot(flow, { x: node.position.x + size.width + GAP_X, y: node.position.y }, NEW_LINE_SIZE, 'right', options.sizeOf)
  const id = options.newId()
  newLine(project, flow, id, position, speakerOf(node))
  // Offered straight after this choice: later ones move up one place.
  settleEdgeOrder(flow, parent.id, handle)
  const order = (edge.order as number) + 1
  for (const e of outgoingEdges(flow, parent.id, handle)) if (typeof e.order === 'number' && e.order >= order) e.order += 1
  const edgeId = options.newId()
  flow.edges[edgeId] = { id: edgeId, source: parent.id, sourceHandle: handle, target: id, targetHandle: INPUT_HANDLE, order }
  return id
}

function connectInPlace(flow: Flow, c: { source: string; sourceHandle: string; target: string }, newId: () => string): void {
  const conn = { ...c, targetHandle: INPUT_HANDLE }
  if (!canConnect(flow, conn).ok) return
  const id = newId()
  flow.edges[id] = { id, ...conn, order: nextEdgeOrder(flow, c.source, c.sourceHandle) }
}

/**
 * Push the nodes in a column down so a node of `size` fits at `at`: anything
 * from that height down whose horizontal span meets the new node's moves by
 * the height needed, along with everything below it in the same column.
 */
function makeRoom(flow: Flow, at: Position, size: Size, sizeOf: SizeOf | undefined, except: string): void {
  const box = { ...at, ...size }
  const inColumn = Object.values(flow.nodes).filter((n) => {
    if (n.id === except) return false
    const s = sizeOr(sizeOf, n)
    return n.position.y + s.height > at.y && n.position.x < box.x + box.width + GAP_X / 2 && box.x < n.position.x + s.width + GAP_X / 2
  })
  const top = Math.min(...inColumn.map((n) => n.position.y))
  if (!inColumn.length || top >= at.y + size.height + GAP_Y) return
  const shift = at.y + size.height + GAP_Y - top
  for (const n of inColumn) n.position = { x: n.position.x, y: n.position.y + shift }
}
