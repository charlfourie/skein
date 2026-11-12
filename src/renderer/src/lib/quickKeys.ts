import type { KeyboardEvent } from 'react'
import type { SizeOf } from '@shared/quickEntry'
import { quickChoice, quickLine, stepSpeaker } from '../store/flowOps'
import { toast } from './toast'

/**
 * Quick line entry keys, shared by the canvas (a line selected) and the line's
 * text in the inspector:
 *
 *   Enter            the next line, below, spoken by whoever spoke before
 *   Ctrl/⌘+Enter     another choice beside this one
 *   Alt+↑ / Alt+↓    change the speaker
 *
 * (In the text, Shift+Enter is a line break.) Returns true when it handled the key.
 */

/** Sizes the canvas has measured, so new lines are placed clear of real node sizes. */
let measured: SizeOf | undefined
export function setMeasuredSizes(sizeOf: SizeOf | undefined): void {
  measured = sizeOf
}

export function quickEntryKey(e: KeyboardEvent, flowId: string, nodeId: string, before?: () => void): boolean {
  if (e.nativeEvent.isComposing || e.key === 'Process') return false // typing with an input method
  const mod = e.ctrlKey || e.metaKey
  if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
    e.preventDefault()
    before?.()
    if (!mod) quickLine(flowId, nodeId, measured)
    else if (!quickChoice(flowId, nodeId, measured)) toast.info('Nothing to branch from', 'A choice goes beside another line from the same node. This one has nothing before it.')
    return true
  }
  if (e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault()
    before?.()
    stepSpeaker(flowId, nodeId, e.key === 'ArrowUp' ? -1 : 1)
    return true
  }
  return false
}

/** Back to the canvas, with the node focused (so the keys above keep working). */
export function focusCanvasNode(nodeId: string): void {
  const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`)
  el?.focus()
}
