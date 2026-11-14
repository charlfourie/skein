/**
 * Choices belong to connections (project format 8).
 *
 * A connection leaving a dialogue line or a hub on its main output is a choice
 * the player may be offered. It carries what's specific to that choice:
 *
 *   choiceText?: string    what the menu shows (blank: the target line's text)
 *   once?: true            offered until it's been picked once
 *   requires?: string      only offered while this holds (beside the target's own requirement)
 *   choiceLineId?: string  the choice text's line ID, for voice-over and translation
 *
 * Before format 8 the choice text lived on the target line (`data.menuText`),
 * shared by every connection into it. The migration moves it onto those connections.
 */
import { DEFAULT_HANDLE, outgoingEdges } from './flowOrder'
import type { Flow, FlowEdge, FlowNode } from './schema'

type LooseFlow = Pick<Flow, 'nodes' | 'edges'>

/** Whether a node type offers its connections as choices. */
export function offersChoices(type: string): boolean {
  return type === 'dialogue' || type === 'hub'
}

/** Whether a connection is a choice: it leaves a line or hub on its main output. */
export function isChoiceEdge(flow: LooseFlow, edge: Pick<FlowEdge, 'source' | 'sourceHandle'>): boolean {
  const source = flow.nodes[edge.source]
  return Boolean(source) && offersChoices(source.type) && (edge.sourceHandle ?? DEFAULT_HANDLE) === DEFAULT_HANDLE
}

/** The choices leaving a node, in the order they're offered. */
export function choiceEdges(flow: LooseFlow, nodeId: string): FlowEdge[] {
  const node = flow.nodes[nodeId]
  return node && offersChoices(node.type) ? outgoingEdges(flow as Flow, nodeId, DEFAULT_HANDLE) : []
}

/** The choices that lead into a node (from any line or hub). */
export function incomingChoices(flow: LooseFlow, nodeId: string): FlowEdge[] {
  return Object.values(flow.edges)
    .filter((e) => e.target === nodeId && isChoiceEdge(flow, e))
    .sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : a.id < b.id ? -1 : 1))
}

export function choiceTextOf(edge: FlowEdge): string {
  return typeof edge.choiceText === 'string' ? edge.choiceText : ''
}

export function choiceRequiresOf(edge: FlowEdge): string {
  return typeof edge.requires === 'string' ? edge.requires : ''
}

export function isOnceChoice(edge: FlowEdge): boolean {
  return edge.once === true
}

/** Whether a choice can stop being offered (it's once-only, or it or its target has a requirement). */
export function choiceCanDisappear(flow: LooseFlow, edge: FlowEdge): boolean {
  const target: FlowNode | undefined = flow.nodes[edge.target]
  const nodeReq = target && typeof target.data.requires === 'string' && target.data.requires.trim() !== ''
  return isOnceChoice(edge) || choiceRequiresOf(edge).trim() !== '' || target?.data.once === true || Boolean(nodeReq)
}
