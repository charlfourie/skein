import type { Flow, NodeComment } from './schema'

export interface Thread {
  root: NodeComment
  replies: NodeComment[]
}

const byTime = (a: NodeComment, b: NodeComment) => a.createdAt.localeCompare(b.createdAt) || (a.id < b.id ? -1 : 1)

/** A node's comment threads, oldest first, each with its replies in order. */
export function threadsOf(flow: Pick<Flow, 'comments'> | undefined, nodeId: string): Thread[] {
  const all = Object.values(flow?.comments ?? {}).filter((c) => c.nodeId === nodeId)
  return all
    .filter((c) => !c.parentId)
    .sort(byTime)
    .map((root) => ({ root, replies: all.filter((c) => c.parentId === root.id).sort(byTime) }))
}

/** Nodes with unresolved threads, and how many each has. */
export function openThreadCounts(flow: Pick<Flow, 'comments'> | undefined): Map<string, number> {
  const out = new Map<string, number>()
  for (const c of Object.values(flow?.comments ?? {})) if (!c.parentId && !c.resolved) out.set(c.nodeId, (out.get(c.nodeId) ?? 0) + 1)
  return out
}
