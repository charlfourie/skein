import type { Flow, FlowNode } from './schema'

/**
 * Flow node types and their data.
 *
 * Node data lives in `node.data` as plain JSON. Only fields that are set are
 * stored (an empty text or a false flag is simply absent), which keeps the
 * file minimal and diffs to the lines that actually changed.
 *
 *   all          isStart?: true, isEnd?: true, note?: string
 *   dialogue     speakerId?: entity id, text?, menuText?, stageDirections?
 *   condition    expression?: string          (outputs: "true", "false")
 *   instruction  script?: string
 *   hub          label?: string
 *   jump         targetId?: node id           (no outputs: flow continues at the target)
 */

export const NODE_TYPES = ['dialogue', 'condition', 'instruction', 'hub', 'jump'] as const
export type NodeType = (typeof NODE_TYPES)[number]

export const INPUT_HANDLE = 'in'

const OUTPUTS: Record<NodeType, readonly string[]> = {
  dialogue: ['out'],
  condition: ['true', 'false'],
  instruction: ['out'],
  hub: ['out'],
  jump: []
}

export function isKnownNodeType(type: string): type is NodeType {
  return (NODE_TYPES as readonly string[]).includes(type)
}

/** Output handle ids for a node type (unknown types get a single "out"). */
export function outputHandles(type: string): readonly string[] {
  return isKnownNodeType(type) ? OUTPUTS[type] : ['out']
}

// ---------------------------------------------------------------------------
// Typed reads of node.data

export function dataString(node: FlowNode, key: string): string {
  const v = node.data[key]
  return typeof v === 'string' ? v : ''
}

export function dataRef(node: FlowNode, key: string): string | null {
  const v = node.data[key]
  return typeof v === 'string' && v ? v : null
}

export function isStartNode(node: FlowNode): boolean {
  return node.data.isStart === true
}

export function isEndNode(node: FlowNode): boolean {
  return node.data.isEnd === true
}

/** Normalise a data patch value: empty strings, false and null mean "not set". */
export function isUnsetValue(v: unknown): boolean {
  return v === undefined || v === null || v === '' || v === false
}

// ---------------------------------------------------------------------------
// Connection rules

export interface ConnectionLike {
  source: string | null
  sourceHandle?: string | null
  target: string | null
  targetHandle?: string | null
}

export type ConnectCheck = { ok: true } | { ok: false; reason: string }

/**
 * Whether a connection is allowed. Used both to validate edits and, live,
 * to highlight valid handles while the designer drags a connection.
 */
export function canConnect(flow: Pick<Flow, 'nodes' | 'edges'>, c: ConnectionLike): ConnectCheck {
  const source = c.source ? flow.nodes[c.source] : undefined
  const target = c.target ? flow.nodes[c.target] : undefined
  if (!source || !target) return { ok: false, reason: 'Missing node' }
  if (source.id === target.id) return { ok: false, reason: 'A node can’t connect to itself' }
  const sourceHandle = c.sourceHandle ?? outputHandles(source.type)[0]
  if (!sourceHandle || !outputHandles(source.type).includes(sourceHandle)) {
    return { ok: false, reason: 'Not an output' }
  }
  if ((c.targetHandle ?? INPUT_HANDLE) !== INPUT_HANDLE) return { ok: false, reason: 'Not an input' }
  for (const e of Object.values(flow.edges)) {
    if (e.source === source.id && e.target === target.id && (e.sourceHandle ?? 'out') === sourceHandle) {
      return { ok: false, reason: 'Already connected' }
    }
  }
  return { ok: true }
}

/** Condition branches carry one connection each; connecting a branch again replaces it. */
export function isExclusiveHandle(type: string, handle: string): boolean {
  return type === 'condition' && (handle === 'true' || handle === 'false')
}
