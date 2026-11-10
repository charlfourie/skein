import { useState } from 'react'
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react'
import { FRAME_COLORS, FRAME_HEX, type FrameColor } from '@shared/frames'
import type { FlowFrame } from '@shared/schema'
import { placeFrame, updateFrame } from '../../store/flowOps'
import { cx } from '../../lib/cx'

export interface FrameNodeData extends Record<string, unknown> {
  frame: FlowFrame
  flowId: string
  /** How many nodes sit inside it. */
  count: number
}

export type FrameRFNode = Node<FrameNodeData, 'frame'>

/**
 * A labelled box that groups nodes on the canvas. Only its title bar takes the
 * mouse (drag it to move the frame and everything inside), so clicks and
 * selection boxes inside the frame still reach the canvas.
 */
export function FrameNode({ data, selected }: NodeProps<FrameRFNode>) {
  const { frame, flowId, count } = data
  const color = frame.color && frame.color in FRAME_HEX ? FRAME_HEX[frame.color as FrameColor] : '#90979e'
  const [editing, setEditing] = useState(false)

  return (
    <div
      className={cx('sk-frame relative h-full w-full rounded-2xl border-[1.5px] border-dashed', selected && 'border-solid')}
      style={{ borderColor: `${color}${selected ? 'aa' : '55'}`, background: `${color}0d` }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={160}
        minHeight={100}
        color={color}
        handleClassName="sk-frame-resize"
        lineClassName="sk-frame-resize"
        onResizeEnd={(_e, p) => placeFrame(flowId, frame.id, { position: { x: p.x, y: p.y }, width: p.width, height: p.height })}
      />
      <div
        className="sk-frame-handle group/frame absolute left-0 top-0 flex max-w-full cursor-grab items-center gap-2 rounded-br-xl rounded-tl-2xl px-3 py-1.5 active:cursor-grabbing"
        style={{ background: `${color}1f`, pointerEvents: 'all' }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setEditing(true)
        }}
      >
        {editing ? (
          <input
            autoFocus
            defaultValue={frame.label}
            onFocus={(e) => e.target.select()}
            className="nodrag w-48 rounded bg-bg px-1.5 py-0.5 text-sm font-semibold text-fg outline-none ring-1 ring-accent/60"
            onBlur={(e) => {
              updateFrame(flowId, frame.id, { label: e.target.value.trim() })
              setEditing(false)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <span className="truncate text-sm font-semibold" style={{ color }} title="Double-click to rename; drag to move with everything inside">
            {frame.label || 'Untitled frame'}
          </span>
        )}
        <span className="shrink-0 text-2xs text-faint">{count === 1 ? '1 node' : `${count} nodes`}</span>
        <span className={cx('nodrag flex shrink-0 items-center gap-1', selected ? 'flex' : 'hidden group-hover/frame:flex')}>
          {FRAME_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour: ${c}`}
              title={c}
              onClick={(e) => {
                e.stopPropagation()
                updateFrame(flowId, frame.id, { color: c === 'slate' ? '' : c })
              }}
              className={cx('h-3 w-3 rounded-full ring-offset-1 ring-offset-panel', (frame.color ?? 'slate') === c && 'ring-1 ring-fg')}
              style={{ background: FRAME_HEX[c] }}
            />
          ))}
        </span>
      </div>
    </div>
  )
}
