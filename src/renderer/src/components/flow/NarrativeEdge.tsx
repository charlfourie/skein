import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  type ConnectionLineComponentProps,
  type Edge,
  type EdgeProps
} from '@xyflow/react'
import { AnimatePresence, motion } from 'framer-motion'
import { Repeat, X, Lock } from 'lucide-react'
import { memo } from 'react'
import { deleteElements } from '../../store/flowOps'
import { COLORS, useFlowContext } from './flowMeta'

export interface NarrativeEdgeData extends Record<string, unknown> {
  branch: 'out' | 'true' | 'false' | 'fallback'
  /** A choice's own text, and whether it's once-only or has a requirement (format 8). */
  choiceText?: string
  once?: boolean
  gated?: boolean
  loop: boolean
  /** One of several choices on the same output: its place in the order the player sees them. */
  choice?: { index: number; count: number } | null
}

export type NarrativeRFEdge = Edge<NarrativeEdgeData, 'narrative'>

export function edgeColor(data: NarrativeEdgeData | undefined): string {
  if (data?.loop) return COLORS.loop
  if (data?.branch === 'true') return COLORS.true
  if (data?.branch === 'false') return COLORS.false
  return COLORS.edge
}

/**
 * A connection that shows which way the story flows:
 *  - particles travel from source to target (constant speed, any length);
 *  - loop-backs are drawn in purple with a marching dash and a ↺ badge, and
 *    route around the side when they point upwards;
 *  - condition branches are tinted green (true) or red (false).
 */
export const NarrativeEdge = memo(function NarrativeEdge(props: EdgeProps<NarrativeRFEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd } = props
  const { flow, animate } = useFlowContext()
  const upwards = targetY < sourceY + 20
  const [path, labelX, labelY] = upwards
    ? getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 18, offset: 28 })
    : getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: 0.3 })

  const color = edgeColor(data)
  const loop = data?.loop === true
  const branch = data?.branch ?? 'out'
  const length = Math.hypot(targetX - sourceX, targetY - sourceY) * (upwards ? 1.8 : 1.15)
  const duration = Math.min(Math.max(length / 90, 1.4), 7)
  const particles = length > 220 ? 3 : 2
  const particleColor = loop ? COLORS.loop : branch === 'out' ? COLORS.particle : color

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={22}
        className={loop && animate ? 'sk-edge-dash' : undefined}
        style={{
          stroke: selected ? (loop ? COLORS.loop : COLORS.accent) : color,
          strokeWidth: selected ? 2.6 : loop ? 2 : 1.6,
          strokeDasharray: loop ? '7 5' : undefined,
          filter: selected ? `drop-shadow(0 0 5px ${loop ? COLORS.loop : COLORS.accent})` : undefined,
          transition: 'stroke 150ms, stroke-width 150ms'
        }}
      />
      {animate &&
        Array.from({ length: particles }, (_, i) => (
          <circle key={i} r={loop ? 2.6 : 2.2} fill={particleColor} opacity={0.95} className="pointer-events-none">
            <animateMotion dur={`${duration}s`} begin={`${(-i * duration) / particles}s`} repeatCount="indefinite" path={path} />
          </circle>
        ))}

      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute flex items-center gap-1"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {data?.choice && (
            <span
              className="grid h-[18px] min-w-[18px] place-items-center rounded-full border px-1 text-[10px] font-semibold tabular-nums"
              style={{ color: COLORS.accent, borderColor: `${COLORS.accent}66`, background: '#0f1117ee' }}
              title={`Choice ${data.choice.index} of ${data.choice.count}: the order the player sees them in. Change it in the inspector of the node it leaves.`}
            >
              {data.choice.index}
            </span>
          )}
          {data && (data.choiceText || data.once || data.gated) && (
            <span
              className="flex max-w-[160px] items-center gap-1 rounded-full border px-1.5 py-px text-[10px]"
              style={{ color: '#c9cbd6', borderColor: '#ffffff22', background: '#0f1117ee' }}
              title={[data.choiceText && `Choice text: ${data.choiceText}`, data.once && 'Only once', data.gated && 'Has a requirement'].filter(Boolean).join('\n')}
            >
              {data.choiceText && <span className="truncate">{data.choiceText}</span>}
              {data.once && <span style={{ color: COLORS.accent }}>1×</span>}
              {data.gated && <Lock size={9} style={{ color: '#fbbf24' }} />}
            </span>
          )}
          {loop && (
            <span
              className="flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-semibold"
              style={{ color: COLORS.loop, borderColor: `${COLORS.loop}66`, background: '#14101cee' }}
              title="This connection loops back to an earlier point in the flow"
            >
              <Repeat size={10} /> loop
            </span>
          )}
          <AnimatePresence>
            {selected && (
              <motion.button
                type="button"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                whileHover={{ scale: 1.15 }}
                onClick={() => deleteElements(flow.id, [], [id])}
                aria-label="Delete connection"
                title="Delete connection (Del)"
                className="grid h-5 w-5 place-items-center rounded-full border border-line bg-panel text-muted shadow hover:border-danger hover:text-danger"
              >
                <X size={11} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </EdgeLabelRenderer>
    </>
  )
})

/**
 * The line drawn while dragging a new connection. Dashed and marching while
 * searching; solid green with a pulsing endpoint once it has snapped onto a
 * valid handle.
 */
export function ConnectionLine({ fromX, fromY, toX, toY, fromPosition, toPosition, connectionStatus }: ConnectionLineComponentProps) {
  const [path] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
    curvature: 0.3
  })
  const snapped = connectionStatus === 'valid'
  const invalid = connectionStatus === 'invalid'
  const color = snapped ? COLORS.ok : invalid ? COLORS.false : COLORS.accent
  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={snapped ? 2.6 : 1.8}
        strokeDasharray={snapped ? undefined : '6 6'}
        className={snapped ? undefined : 'sk-edge-dash'}
      />
      <circle cx={toX} cy={toY} r={snapped ? 6 : 4} fill={snapped ? color : '#0f1117'} stroke={color} strokeWidth={1.6} className={snapped ? 'sk-snap-pulse' : undefined} />
    </g>
  )
}
