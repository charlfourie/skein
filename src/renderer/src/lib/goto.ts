import type { SearchTarget } from '@shared/search'
import { useProjectStore } from '../store/projectStore'

/** Show where a search result or problem is: its node on the canvas, or the page it's on. */
export function goToTarget(t: SearchTarget): void {
  const s = useProjectStore.getState()
  switch (t.kind) {
    case 'node':
    case 'comment':
      return s.focusNode(t.flowId, t.nodeId)
    case 'frame':
    case 'flow':
      return s.openDoc({ kind: 'flow', id: t.flowId })
    case 'rule':
      return s.select({ kind: 'state', id: 'time' })
    case 'entity':
      return s.select({ kind: 'entity', id: t.entityId })
    case 'template':
      return s.select({ kind: 'template', id: t.templateId })
    case 'variable':
      return s.select({ kind: 'state', id: 'world' })
  }
}
