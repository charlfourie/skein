import { createContext, useContext } from 'react'
import { CircleDot, CornerDownRight, GitBranch, MessageSquare, Zap, type LucideIcon } from 'lucide-react'
import type { NodeType } from '@shared/nodes'
import type { Flow } from '@shared/schema'

/**
 * Colours are literal hex (not CSS variables) because some are used in SVG
 * presentation attributes and markers, which can't resolve var().
 */
export const COLORS = {
  edge: '#4b5263',
  particle: '#a5b4fc',
  true: '#34d399',
  false: '#f87171',
  loop: '#c084fc',
  ok: '#34d399',
  accent: '#818cf8'
} as const

export const NODE_META: Record<NodeType, { label: string; icon: LucideIcon; color: string; hint: string }> = {
  dialogue: { label: 'Dialogue', icon: MessageSquare, color: '#818cf8', hint: 'A line spoken by a character' },
  condition: { label: 'Condition', icon: GitBranch, color: '#fbbf24', hint: 'Branches on true / false' },
  instruction: { label: 'Instruction', icon: Zap, color: '#2dd4bf', hint: 'Changes game state' },
  hub: { label: 'Hub', icon: CircleDot, color: '#60a5fa', hint: 'A meeting point that paths merge into' },
  jump: { label: 'Jump', icon: CornerDownRight, color: '#fb923c', hint: 'Continues the flow at another node' }
}

export const GENERIC_META = { label: 'Node', icon: CircleDot, color: '#90979e', hint: '' }

export const NODE_DRAG_MIME = 'application/x-skein-node'

interface FlowCtx {
  flow: Flow
  animate: boolean
}

export const FlowContext = createContext<FlowCtx | null>(null)
export const useFlowContext = () => useContext(FlowContext) as FlowCtx
