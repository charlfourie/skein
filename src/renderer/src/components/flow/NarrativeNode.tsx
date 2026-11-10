import { Handle, Position, useConnection, type Node, type NodeProps } from '@xyflow/react'
import { motion } from 'framer-motion'
import { AlertTriangle, Flag, Lock, Play, Repeat, XCircle, Zap } from 'lucide-react'
import { memo } from 'react'
import { canConnect, dataString, INPUT_HANDLE, isEndNode, isKnownNodeType, isStartNode, outputHandles } from '@shared/nodes'
import type { FlowNode } from '@shared/schema'
import type { Issue } from '@shared/validate'
import { cx } from '../../lib/cx'
import { templateIcon } from '../../lib/meta'
import { GENERIC_META, NODE_META, useFlowContext } from './flowMeta'
import { usePlayMark } from '../../store/play'
import { ExprText } from '../defs/ExprText'
import { useProjectStore } from '../../store/projectStore'

export interface NarrativeNodeData extends Record<string, unknown> {
  node: FlowNode
  speaker: { name: string; color: string; icon: string } | null
  jumpTarget: string | null
  /** Jump hand-off or Play flow: the other flow. */
  otherFlow: { id: string; name: string } | null
  warn: boolean
  error: boolean
  loopJump: boolean
  /** Priority among several start nodes (1 = tried first), or null. */
  startRank: number | null
  issues: Issue[]
}

export type NarrativeRFNode = Node<NarrativeNodeData, 'narrative'>

type HandleState = 'idle' | 'valid' | 'snapped' | 'invalid'

/**
 * While a connection is being dragged, every node works out whether it could
 * accept it: valid handles glow (and swell when the line snaps to them),
 * nodes that can't take the connection fade back.
 *
 * The selector returns a string so the node re-renders only when the drag
 * state actually changes.
 */
function useConnectionState(): {
  fromNode: string
  fromHandle: string
  fromType: 'source' | 'target'
  toNode: string
  toHandle: string
} | null {
  const key = useConnection((c) =>
    c.inProgress
      ? [c.fromNode.id, c.fromHandle.id ?? '', c.fromHandle.type, c.toHandle?.nodeId ?? '', c.toHandle?.id ?? ''].join('\u0001')
      : ''
  )
  if (!key) return null
  const [fromNode, fromHandle, fromType, toNode, toHandle] = key.split('\u0001')
  return { fromNode, fromHandle, fromType: fromType as 'source' | 'target', toNode, toHandle }
}

export const NarrativeNode = memo(function NarrativeNode({ id, data, selected }: NodeProps<NarrativeRFNode>) {
  const { flow } = useFlowContext()
  const playMark = usePlayMark(flow.id, id)
  const conn = useConnectionState()
  const node = data.node
  const baseMeta = isKnownNodeType(node.type) ? NODE_META[node.type] : GENERIC_META
  // Dialogue lines take on their speaker's template icon and colour.
  const meta = data.speaker ? { ...baseMeta, color: data.speaker.color } : baseMeta
  const Icon = data.speaker ? templateIcon(data.speaker.icon) : meta.icon
  const outputs = outputHandles(node.type)

  let inputState: HandleState = 'idle'
  const outputState: Record<string, HandleState> = {}
  let dim = false
  if (conn && conn.fromNode !== id) {
    if (conn.fromType === 'source') {
      const ok = canConnect(flow, { source: conn.fromNode, sourceHandle: conn.fromHandle || null, target: id, targetHandle: INPUT_HANDLE }).ok
      inputState = ok ? (conn.toNode === id ? 'snapped' : 'valid') : 'invalid'
      dim = !ok
    } else {
      let any = false
      for (const h of outputs) {
        const ok = canConnect(flow, { source: id, sourceHandle: h, target: conn.fromNode, targetHandle: INPUT_HANDLE }).ok
        any ||= ok
        outputState[h] = ok ? (conn.toNode === id && conn.toHandle === h ? 'snapped' : 'valid') : 'invalid'
      }
      dim = !any
    }
  }

  const isStart = isStartNode(node)
  const isEnd = isEndNode(node)
  const compact = node.type === 'hub' || node.type === 'jump' || node.type === 'call'
  const tooltip = data.issues.map((i) => i.message).join('\n')

  return (
    <motion.div
      animate={{ opacity: dim ? 0.32 : 1, scale: inputState === 'snapped' ? 1.02 : 1 }}
      transition={{ duration: 0.15 }}
      className={cx(
        'group relative rounded-xl border bg-panel text-left shadow-[0_8px_24px_-14px_rgb(0_0_0/0.8)] transition-[border-color,box-shadow]',
        compact ? 'w-[200px]' : 'w-[260px]',
        selected ? 'border-accent shadow-[0_0_0_3px_rgb(var(--c-accent)/0.25)]' : 'border-line hover:border-faint/70',
        playMark === 'current' && 'sk-play-current border-ok shadow-[0_0_0_3px_rgb(var(--c-ok)/0.35)]',
        playMark === 'visited' && !selected && 'border-ok/45',
        data.error ? 'sk-node-error' : data.warn && 'sk-node-warn'
      )}
    >
      <Handle type="target" position={Position.Top} id={INPUT_HANDLE} className={handleClass(inputState)} />

      {/* Header */}
      <div
        className="flex items-center gap-2 rounded-t-xl border-b px-3 py-1.5"
        style={{ borderColor: `${meta.color}33`, background: `linear-gradient(90deg, ${meta.color}1f, transparent)` }}
      >
        <Icon size={13} style={{ color: meta.color }} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-2xs font-semibold uppercase tracking-wider" style={{ color: meta.color }}>
          {header(node, data, meta.label)}
        </span>
        {dataString(node, 'tag') && (
          <span className="max-w-[90px] truncate font-mono text-[10px] text-faint" title={`Tag: Seen.${dataString(node, 'tag')} / Visits.${dataString(node, 'tag')}`}>
            #{dataString(node, 'tag')}
          </span>
        )}
        {isStart && (
          <span
            className="flex items-center gap-0.5 rounded bg-ok/15 px-1 py-px text-[10px] font-semibold text-ok"
            title={data.startRank ? `Start node, priority ${data.startRank}: the first start whose requirement holds is used` : 'Start node'}
          >
            <Play size={9} fill="currentColor" /> START{data.startRank ? ` ${data.startRank}` : ''}
          </span>
        )}
        {node.data.once === true && (
          <span className="rounded bg-raised px-1 py-px text-[10px] font-semibold text-muted" title="Only once: not available again after the story has been here">
            1×
          </span>
        )}
        {isEnd && (
          <span className="flex items-center gap-0.5 rounded bg-raised px-1 py-px text-[10px] font-semibold text-muted" title="End node">
            <Flag size={9} /> END
          </span>
        )}
        {data.loopJump && (
          <span title="This jump loops back" className="text-loop">
            <Repeat size={12} />
          </span>
        )}
        {(data.warn || data.error) && (
          <span title={tooltip} className={data.error ? 'text-danger' : 'text-warn'}>
            {data.error ? <XCircle size={13} /> : <AlertTriangle size={13} />}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        <Body node={node} data={data} />
        <StateLines node={node} />
      </div>

      {/* Outputs */}
      {outputs.length === 1 && (
        <Handle type="source" position={Position.Bottom} id={outputs[0]} className={handleClass(outputState[outputs[0]] ?? 'idle')} />
      )}
      {node.type === 'condition' && (
        <>
          <div className="flex justify-between px-6 pb-1.5 text-[10px] font-semibold uppercase tracking-wider">
            <span className="text-ok/90">true</span>
            <span className="text-danger/90">false</span>
          </div>
          {outputs.map((h, i) => (
            <Handle
              key={h}
              type="source"
              position={Position.Bottom}
              id={h}
              style={{ left: i === 0 ? '28%' : '72%' }}
              className={cx(handleClass(outputState[h] ?? 'idle'), h === 'true' ? 'sk-handle--true' : 'sk-handle--false')}
            />
          ))}
        </>
      )}
    </motion.div>
  )
})

/** Requirements and effects, shown compactly under the node's content. */
function StateLines({ node }: { node: FlowNode }) {
  const requires = dataString(node, 'requires').trim()
  const effects = dataString(node, 'effects').trim()
  if (!requires && !effects) return null
  return (
    <div className="mt-2 space-y-0.5 border-t border-line/70 pt-1.5">
      {requires && (
        <p className="flex items-start gap-1 text-[11px] leading-snug text-muted" title={`Requires: ${requires}`}>
          <Lock size={10} className="mt-0.5 shrink-0 text-warn" />
          <code className="line-clamp-2 font-mono">
            <ExprText source={requires} />
          </code>
        </p>
      )}
      {effects && (
        <p className="flex items-start gap-1 text-[11px] leading-snug text-muted" title={`Effects:\n${effects}`}>
          <Zap size={10} className="mt-0.5 shrink-0 text-ok" />
          <code className="line-clamp-2 whitespace-pre-wrap font-mono">
            <ExprText source={effects} />
          </code>
        </p>
      )}
    </div>
  )
}

function handleClass(state: HandleState): string {
  return cx('sk-handle', state !== 'idle' && `sk-handle--${state}`)
}

function header(node: FlowNode, data: NarrativeNodeData, fallback: string): string {
  if (node.type === 'dialogue') return data.speaker?.name ?? 'Dialogue'
  if (node.type === 'hub') return dataString(node, 'label') || 'Hub'
  return fallback
}

function Placeholder({ children }: { children: string }) {
  return <p className="text-xs italic text-faint">{children}</p>
}

function Body({ node, data }: { node: FlowNode; data: NarrativeNodeData }) {
  switch (node.type) {
    case 'dialogue': {
      const text = dataString(node, 'text')
      const menu = dataString(node, 'menuText')
      return (
        <div>
          {!data.speaker && <p className="mb-1 text-2xs text-faint">No speaker</p>}
          {text ? <p className="line-clamp-4 whitespace-pre-line text-[13px] leading-snug text-fg">{text}</p> : <Placeholder>Empty line</Placeholder>}
          {menu && (
            <p className="mt-1.5 truncate rounded bg-raised px-1.5 py-0.5 text-2xs text-muted" title="Choice text">
              ▸ {menu}
            </p>
          )}
        </div>
      )
    }
    case 'condition': {
      const expr = dataString(node, 'expression')
      return expr ? (
        <code className="line-clamp-3 block font-mono text-xs text-fg">
          <ExprText source={expr} />
        </code>
      ) : (
        <Placeholder>No expression</Placeholder>
      )
    }
    case 'instruction': {
      const script = dataString(node, 'script')
      return script ? (
        <code className="line-clamp-4 block whitespace-pre-wrap font-mono text-xs text-fg">
          <ExprText source={script} />
        </code>
      ) : (
        <Placeholder>No instruction</Placeholder>
      )
    }
    case 'hub':
      return <p className="text-2xs text-faint">Paths meet here</p>
    case 'jump':
      if (data.otherFlow) return <FlowLink flow={data.otherFlow} prefix="Continue in" />
      return data.jumpTarget ? (
        <p className="truncate text-xs text-fg">→ {data.jumpTarget}</p>
      ) : (
        <Placeholder>Pick a target in the inspector</Placeholder>
      )
    case 'call':
      return data.otherFlow ? <FlowLink flow={data.otherFlow} prefix="Play" suffix="then carry on" /> : <Placeholder>Pick a flow in the inspector</Placeholder>
    default:
      return <Placeholder>{`Unknown node type “${node.type}”`}</Placeholder>
  }
}

/** A link to another flow, from a hand-off jump or a Play flow node. Click opens that flow. */
function FlowLink({ flow, prefix, suffix }: { flow: { id: string; name: string }; prefix: string; suffix?: string }) {
  const openDoc = useProjectStore((s) => s.openDoc)
  return (
    <button
      type="button"
      className="nodrag block w-full min-w-0 text-left text-xs text-fg hover:underline"
      title={`Open “${flow.name}”`}
      onClick={(e) => {
        e.stopPropagation()
        openDoc({ kind: 'flow', id: flow.id })
      }}
    >
      <span className="text-faint">{prefix} </span>
      <span className="font-medium">{flow.name}</span>
      {suffix && <span className="text-faint">, {suffix}</span>}
    </button>
  )
}
