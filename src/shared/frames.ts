import type { Flow, FlowFrame, Position } from './schema'

/** Frame colours: a few calm tints that read on the dark canvas. Absent = neutral grey. */
export const FRAME_COLORS = ['slate', 'indigo', 'teal', 'amber', 'rose', 'violet'] as const
export type FrameColor = (typeof FRAME_COLORS)[number]

export const FRAME_HEX: Record<FrameColor, string> = {
  slate: '#94a3b8',
  indigo: '#818cf8',
  teal: '#2dd4bf',
  amber: '#fbbf24',
  rose: '#fb7185',
  violet: '#c084fc'
}

export type Size = { width: number; height: number }
export const DEFAULT_NODE_SIZE: Size = { width: 260, height: 100 }
/** Space between a frame's edge and the nodes it was made around (the top leaves room for the label). */
export const FRAME_PAD = { x: 32, top: 56, bottom: 32 }

/** Frames, in a stable order (largest first, so smaller frames sit on top of the ones they're inside). */
export function framesOf(flow: Pick<Flow, 'frames'>): FlowFrame[] {
  return Object.values(flow.frames ?? {}).sort((a, b) => b.width * b.height - a.width * a.height || (a.id < b.id ? -1 : 1))
}

/** Whether a node's centre lies inside a frame. */
export function insideFrame(frame: Pick<FlowFrame, 'position' | 'width' | 'height'>, position: Position, size: Size = DEFAULT_NODE_SIZE): boolean {
  const cx = position.x + size.width / 2
  const cy = position.y + size.height / 2
  return cx >= frame.position.x && cx <= frame.position.x + frame.width && cy >= frame.position.y && cy <= frame.position.y + frame.height
}

/** The nodes inside a frame (by their centre). */
export function nodesInFrame(flow: Pick<Flow, 'nodes'>, frame: FlowFrame, sizes: Record<string, Size> = {}): string[] {
  return Object.values(flow.nodes)
    .filter((n) => insideFrame(frame, n.position, sizes[n.id]))
    .map((n) => n.id)
    .sort()
}

/** The rectangle a frame needs to hold these nodes, with padding. Null for no nodes. */
export function frameAround(flow: Pick<Flow, 'nodes'>, ids: string[], sizes: Record<string, Size> = {}): { position: Position; width: number; height: number } | null {
  const nodes = ids.map((id) => flow.nodes[id]).filter(Boolean)
  if (!nodes.length) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const n of nodes) {
    const s = sizes[n.id] ?? DEFAULT_NODE_SIZE
    x0 = Math.min(x0, n.position.x)
    y0 = Math.min(y0, n.position.y)
    x1 = Math.max(x1, n.position.x + s.width)
    y1 = Math.max(y1, n.position.y + s.height)
  }
  return {
    position: { x: Math.round(x0 - FRAME_PAD.x), y: Math.round(y0 - FRAME_PAD.top) },
    width: Math.round(x1 - x0 + FRAME_PAD.x * 2),
    height: Math.round(y1 - y0 + FRAME_PAD.top + FRAME_PAD.bottom)
  }
}
