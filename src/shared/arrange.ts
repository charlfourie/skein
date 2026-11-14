/**
 * Canvas helpers that work on a selection: what's reachable from a node, and
 * lining nodes up. Pure functions, so the canvas and tests share them.
 */
import type { Flow, Position } from './schema'

type LooseFlow = Pick<Flow, 'nodes' | 'edges'>

/**
 * Every node the story can reach from `start` going forward (`after`) or that can
 * lead to it (`before`), through connections and jumps within the flow. `start` itself
 * is left out unless a loop leads back to it.
 */
export function reachable(flow: LooseFlow, start: string, direction: 'after' | 'before'): Set<string> {
  const links = new Map<string, string[]>()
  const link = (from: string, to: string) => {
    if (!flow.nodes[from] || !flow.nodes[to]) return
    const [a, b] = direction === 'after' ? [from, to] : [to, from]
    links.set(a, [...(links.get(a) ?? []), b])
  }
  for (const e of Object.values(flow.edges)) link(e.source, e.target)
  for (const n of Object.values(flow.nodes)) {
    const target = n.type === 'jump' ? n.data.targetId : undefined
    if (typeof target === 'string') link(n.id, target)
  }
  const seen = new Set<string>()
  const stack = [...(links.get(start) ?? [])]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(links.get(id) ?? []))
  }
  return seen
}

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'spreadX' | 'spreadY'

export interface Box {
  id: string
  position: Position
  width: number
  height: number
}

/** New positions that line the boxes up (or spread them evenly), moving only the axis asked for. */
export function align(boxes: Box[], mode: AlignMode): Record<string, Position> {
  const out: Record<string, Position> = {}
  if (boxes.length < 2) return out
  const left = Math.min(...boxes.map((b) => b.position.x))
  const right = Math.max(...boxes.map((b) => b.position.x + b.width))
  const top = Math.min(...boxes.map((b) => b.position.y))
  const bottom = Math.max(...boxes.map((b) => b.position.y + b.height))
  const set = (b: Box, x: number, y: number) => (out[b.id] = { x, y })
  switch (mode) {
    case 'left':
      for (const b of boxes) set(b, left, b.position.y)
      break
    case 'right':
      for (const b of boxes) set(b, right - b.width, b.position.y)
      break
    case 'center': {
      const c = (left + right) / 2
      for (const b of boxes) set(b, c - b.width / 2, b.position.y)
      break
    }
    case 'top':
      for (const b of boxes) set(b, b.position.x, top)
      break
    case 'bottom':
      for (const b of boxes) set(b, b.position.x, bottom - b.height)
      break
    case 'middle': {
      const m = (top + bottom) / 2
      for (const b of boxes) set(b, b.position.x, m - b.height / 2)
      break
    }
    case 'spreadX':
    case 'spreadY': {
      // Equal gaps between neighbours, keeping the outermost two where they are.
      const horizontal = mode === 'spreadX'
      const sorted = [...boxes].sort((a, b) => (horizontal ? a.position.x - b.position.x : a.position.y - b.position.y))
      const size = (b: Box) => (horizontal ? b.width : b.height)
      const start = horizontal ? left : top
      const span = (horizontal ? right : bottom) - start
      const gap = (span - sorted.reduce((n, b) => n + size(b), 0)) / (sorted.length - 1)
      let at = start
      for (const b of sorted) {
        if (horizontal) set(b, at, b.position.y)
        else set(b, b.position.x, at)
        at += size(b) + gap
      }
      break
    }
  }
  return out
}
