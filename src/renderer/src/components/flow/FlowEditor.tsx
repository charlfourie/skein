import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type FinalConnectionState,
  type NodeChange,
  type OnSelectionChangeParams
} from '@xyflow/react'
import { AnimatePresence, motion } from 'framer-motion'
import { Activity, AlertTriangle, Grid3x3, Maximize, Network, Repeat } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { analyzeFlow, type FlowAnalysis } from '@shared/flowAnalysis'
import { choiceNumbers, startNodes } from '@shared/flowOrder'
import { canConnect, dataRef, dataString, NODE_TYPES, type NodeType } from '@shared/nodes'
import type { Flow, Position, Project } from '@shared/schema'
import type { IssueMap } from '@shared/validate'
import { useIssues } from '../../hooks/useIssues'
import { cx } from '../../lib/cx'
import { addNode, autoLayout, connect, deleteElements, duplicateNodes, moveNodes, reconnect } from '../../store/flowOps'
import { usePrefs } from '../../store/prefs'
import { useProjectStore, type Selection } from '../../store/projectStore'
import { MenuItem, Popover } from '../ui/Popover'
import { COLORS, FlowContext, NODE_DRAG_MIME, NODE_META } from './flowMeta'
import { ConnectionLine, edgeColor, NarrativeEdge, type NarrativeRFEdge } from './NarrativeEdge'
import { NarrativeNode, type NarrativeRFNode } from './NarrativeNode'

const nodeTypes = { narrative: NarrativeNode }
const edgeTypes = { narrative: NarrativeEdge }

/** Where new nodes appear relative to the pointer (roughly the node's top centre). */
const DROP_OFFSET = { x: 130, y: 24 }

// ---------------------------------------------------------------------------
// Store → React Flow

function deriveNodes(project: Project, flow: Flow, analysis: FlowAnalysis, issues: IssueMap): NarrativeRFNode[] {
  const starts = startNodes(flow)
  const startRank = new Map(starts.length > 1 ? starts.map((n, i) => [n.id, i + 1] as const) : [])
  return Object.values(flow.nodes)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((node) => {
      const speakerId = dataRef(node, 'speakerId')
      const speaker = speakerId ? project.entities[speakerId] : undefined
      const template = speaker ? project.templates[speaker.templateId] : undefined
      const targetId = dataRef(node, 'targetId')
      const target = targetId ? flow.nodes[targetId] : undefined
      const nodeIssues = issues.get(node.id) ?? []
      return {
        id: node.id,
        type: 'narrative' as const,
        position: node.position,
        data: {
          node,
          speaker: speaker ? { name: speaker.name, color: template?.color ?? COLORS.accent, icon: template?.icon ?? 'user' } : null,
          jumpTarget: target ? describeNode(project, target) : null,
          warn: nodeIssues.some((i) => i.level === 'warning'),
          error: nodeIssues.some((i) => i.level === 'error'),
          loopJump: analysis.loopJumps.has(node.id),
          startRank: startRank.get(node.id) ?? null,
          issues: nodeIssues
        }
      }
    })
}

function deriveEdges(flow: Flow, analysis: FlowAnalysis): NarrativeRFEdge[] {
  const numbers = choiceNumbers(flow)
  return Object.values(flow.edges)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((e) => {
      const data = {
        branch: (e.sourceHandle ?? 'out') as 'out' | 'true' | 'false',
        loop: analysis.loopEdges.has(e.id),
        choice: numbers.get(e.id) ?? null
      }
      return {
        id: e.id,
        type: 'narrative' as const,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? 'out',
        targetHandle: e.targetHandle ?? 'in',
        data,
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(data), width: 16, height: 16 }
      }
    })
}

export function describeNode(project: Project, node: Flow['nodes'][string]): string {
  const label = dataString(node, 'label')
  if (node.type === 'hub' && label) return label
  if (node.type === 'dialogue') {
    const speakerId = dataRef(node, 'speakerId')
    const who = speakerId ? project.entities[speakerId]?.name : undefined
    const text = dataString(node, 'text')
    const short = text.length > 32 ? `${text.slice(0, 32)}…` : text
    return [who, short && `“${short}”`].filter(Boolean).join(': ') || 'Dialogue'
  }
  return (NODE_META as Record<string, { label: string }>)[node.type]?.label ?? node.type
}

function eventPoint(event: MouseEvent | globalThis.MouseEvent | TouchEvent): { x: number; y: number } {
  if ('changedTouches' in event) return { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY }
  return { x: event.clientX, y: event.clientY }
}

interface QuickAdd {
  anchor: DOMRect
  position: Position
  from?: { source: string; sourceHandle: string | null }
  to?: string
}

// ---------------------------------------------------------------------------

export function FlowEditor({ flow }: { flow: Flow }) {
  const project = useProjectStore((s) => s.project) as Project
  const select = useProjectStore((s) => s.select)
  const focusRequest = useProjectStore((s) => s.focusRequest)
  const { animateEdges, snapToGrid, set: setPrefs } = usePrefs()
  const issues = useIssues()
  const analysis = analyzeFlow(flow)
  const rf = useReactFlow<NarrativeRFNode, NarrativeRFEdge>()
  const wrapper = useRef<HTMLDivElement>(null)

  // React Flow owns transient state (drag positions, selection, measured
  // sizes); the store owns the document. Re-derive from the store whenever
  // the document changes, carrying the transient state across.
  const derivedNodes = useMemo(() => deriveNodes(project, flow, analysis, issues), [project, flow, analysis, issues])
  const derivedEdges = useMemo(() => deriveEdges(flow, analysis), [flow, analysis])
  const initialSelection = useProjectStore.getState().selection
  const [nodes, setNodes] = useState<NarrativeRFNode[]>(() =>
    derivedNodes.map((n) => ({ ...n, selected: initialSelection?.kind === 'node' && initialSelection.id === n.id }))
  )
  const [edges, setEdges] = useState<NarrativeRFEdge[]>(derivedEdges)

  useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]))
      // A node that was just created (palette, quick-add, duplicate) arrives
      // selected, so the inspector opens on it straight away.
      const sel = useProjectStore.getState().selection
      const fresh = sel?.kind === 'node' && sel.flowId === flow.id && !byId.has(sel.id) ? sel.id : null
      return derivedNodes.map((n) => {
        const old = byId.get(n.id)
        if (fresh) return old ? { ...n, selected: false, measured: old.measured } : { ...n, selected: n.id === fresh }
        return old ? { ...n, selected: old.selected, measured: old.measured } : n
      })
    })
  }, [derivedNodes, flow.id])
  useEffect(() => {
    setEdges((prev) => {
      const selected = new Set(prev.filter((e) => e.selected).map((e) => e.id))
      return derivedEdges.map((e) => (selected.has(e.id) ? { ...e, selected: true } : e))
    })
  }, [derivedEdges])

  // Deletions go through onDelete (one undo step), so drop RF's own removals.
  const onNodesChange = useCallback(
    (changes: NodeChange<NarrativeRFNode>[]) => setNodes((nds) => applyNodeChanges(changes.filter((c) => c.type !== 'remove'), nds)),
    []
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange<NarrativeRFEdge>[]) => setEdges((eds) => applyEdgeChanges(changes.filter((c) => c.type !== 'remove'), eds)),
    []
  )

  const onSelectionChange = useCallback(
    ({ nodes: selNodes, edges: selEdges }: OnSelectionChangeParams) => {
      const current = useProjectStore.getState().selection
      let next: Selection
      if (selNodes.length === 1 && selEdges.length === 0) next = { kind: 'node', flowId: flow.id, id: selNodes[0].id }
      else if (selEdges.length === 1 && selNodes.length === 0) next = { kind: 'edge', flowId: flow.id, id: selEdges[0].id }
      else if (selNodes.length === 0 && selEdges.length === 0) {
        // Only fall back to the flow if the selection was inside this canvas.
        if (current?.kind !== 'node' && current?.kind !== 'edge') return
        next = { kind: 'flow', id: flow.id }
      } else next = { kind: 'flow', id: flow.id }
      if (JSON.stringify(next) !== JSON.stringify(current)) select(next)
    },
    [flow.id, select]
  )

  // "Show in flow" from elsewhere: select the node and bring it into view.
  useEffect(() => {
    if (!focusRequest || focusRequest.flowId !== flow.id) return
    const target = flow.nodes[focusRequest.nodeId]
    if (!target) return
    setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === target.id })))
    const t = setTimeout(() => {
      const measured = rf.getNode(target.id)?.measured
      void rf.setCenter(target.position.x + (measured?.width ?? 260) / 2, target.position.y + (measured?.height ?? 100) / 2, {
        zoom: Math.max(rf.getZoom(), 0.9),
        duration: 450
      })
    }, 60)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.nonce])

  // --- Editing --------------------------------------------------------------

  const isValidConnection = useCallback(
    (c: Connection | NarrativeRFEdge) => canConnect(flow, c).ok,
    [flow]
  )

  const [quickAdd, setQuickAdd] = useState<QuickAdd | null>(null)

  const openQuickAdd = (client: { x: number; y: number }, extra?: Pick<QuickAdd, 'from' | 'to'>) => {
    const position = rf.screenToFlowPosition(client)
    setQuickAdd({
      anchor: new DOMRect(client.x, client.y, 0, 0),
      position: { x: position.x - DROP_OFFSET.x, y: position.y - (extra?.to ? 90 : DROP_OFFSET.y) },
      ...extra
    })
  }

  const createFromQuickAdd = (type: NodeType) => {
    if (!quickAdd) return
    const id = addNode(flow.id, type, quickAdd.position, quickAdd.from)
    if (id && quickAdd.to) connect(flow.id, { source: id, sourceHandle: null, target: quickAdd.to, targetHandle: 'in' })
    setQuickAdd(null)
  }

  /** Dropping a connection on empty canvas offers to create the next node right there. */
  const onConnectEnd = useCallback(
    (event: globalThis.MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || !state.fromNode || state.toHandle) return
      const target = event.target as Element | null
      if (!target?.classList.contains('react-flow__pane')) return
      const point = eventPoint(event)
      if (state.fromHandle?.type === 'source') {
        openQuickAdd(point, { from: { source: state.fromNode.id, sourceHandle: state.fromHandle.id ?? null } })
      } else {
        openQuickAdd(point, { to: state.fromNode.id })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rf]
  )

  const addAtCenter = (type: NodeType) => {
    const rect = wrapper.current?.getBoundingClientRect()
    if (!rect) return
    const p = rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    addNode(flow.id, type, { x: p.x - DROP_OFFSET.x, y: p.y - 40 })
  }

  const onDrop = (e: DragEvent) => {
    const type = e.dataTransfer.getData(NODE_DRAG_MIME) as NodeType
    if (!type || !NODE_TYPES.includes(type)) return
    e.preventDefault()
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    addNode(flow.id, type, { x: p.x - DROP_OFFSET.x, y: p.y - DROP_OFFSET.y })
  }

  const runAutoLayout = () => {
    const sizes = Object.fromEntries(
      rf.getNodes().map((n) => [n.id, { width: n.measured?.width ?? 260, height: n.measured?.height ?? 100 }])
    )
    autoLayout(flow.id, sizes)
    setTimeout(() => void rf.fitView({ padding: 0.25, duration: 450, maxZoom: 1 }), 60)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      const ids = nodes.filter((n) => n.selected).map((n) => n.id)
      const created = duplicateNodes(flow.id, ids)
      if (created.length === 1) select({ kind: 'node', flowId: flow.id, id: created[0] })
    }
  }

  // --- Issue navigation -----------------------------------------------------

  const problemNodes = useMemo(() => {
    const ids = [...analysis.orphans, ...analysis.deadEnds, ...analysis.brokenJumps, ...analysis.openBranches.keys()]
    return [...new Set(ids)].map((id) => flow.nodes[id]).filter(Boolean).sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
  }, [analysis, flow.nodes])
  const loopEdgeTargets = useMemo(
    () => [...analysis.loopEdges].map((id) => flow.edges[id]?.source).filter((x): x is string => Boolean(x)),
    [analysis, flow.edges]
  )
  const cycle = useRef<Record<string, number>>({})
  const focusNext = (key: string, ids: string[]) => {
    if (!ids.length) return
    const i = (cycle.current[key] = ((cycle.current[key] ?? -1) + 1) % ids.length)
    useProjectStore.getState().focusNode(flow.id, ids[i])
  }

  const ctx = useMemo(() => ({ flow, animate: animateEdges }), [flow, animateEdges])
  const empty = nodes.length === 0

  return (
    <FlowContext.Provider value={ctx}>
      <div
        ref={wrapper}
        className="relative h-full w-full outline-none"
        onKeyDown={onKeyDown}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(NODE_DRAG_MIME)) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }
        }}
        onDrop={onDrop}
        onDoubleClick={(e) => {
          if ((e.target as Element).classList.contains('react-flow__pane')) openQuickAdd({ x: e.clientX, y: e.clientY })
        }}
      >
        <ReactFlow<NarrativeRFNode, NarrativeRFEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onSelectionChange={onSelectionChange}
          onNodeDragStop={(_e, _n, dragged) =>
            moveNodes(flow.id, Object.fromEntries(dragged.map((n) => [n.id, n.position])))
          }
          onConnect={(c) => connect(flow.id, c)}
          onConnectEnd={onConnectEnd}
          onReconnect={(old, c) => reconnect(flow.id, old.id, c)}
          edgesReconnectable
          onDelete={({ nodes: ns, edges: es }) => deleteElements(flow.id, ns.map((n) => n.id), es.map((e) => e.id))}
          isValidConnection={isValidConnection}
          connectionLineComponent={ConnectionLine}
          connectionRadius={44}
          deleteKeyCode={['Delete', 'Backspace']}
          snapToGrid={snapToGrid}
          snapGrid={[20, 20]}
          onPaneContextMenu={(e) => {
            e.preventDefault()
            openQuickAdd({ x: e.clientX, y: e.clientY })
          }}
          zoomOnDoubleClick={false}
          colorMode="dark"
          fitView
          fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
          minZoom={0.15}
          maxZoom={2}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="rgb(255 255 255 / 0.08)" />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            nodeColor={(n) => {
              const d = (n as NarrativeRFNode).data
              return d?.error ? COLORS.false : d?.warn ? '#fbbf24' : '#5a6174'
            }}
            nodeStrokeColor="#818cf8"
            maskColor="rgba(10, 11, 15, 0.65)"
            bgColor="#0f1117"
            style={{ width: 160, height: 110 }}
          />

          <Panel position="top-left">
            <Palette onAdd={addAtCenter} />
          </Panel>

          <Panel position="top-right">
            <div className="flex items-center gap-1.5">
              <AnimatePresence initial={false}>
                {problemNodes.length > 0 && (
                  <IssueChip
                    key="problems"
                    tone="warn"
                    icon={<AlertTriangle size={12} />}
                    label={`${problemNodes.length} need${problemNodes.length === 1 ? 's' : ''} attention`}
                    title="Orphans, dead ends, open branches and broken jumps. Click to visit each."
                    onClick={() => focusNext('problems', problemNodes.map((n) => n.id))}
                  />
                )}
                {analysis.loopEdges.size + analysis.loopJumps.size > 0 && (
                  <IssueChip
                    key="loops"
                    tone="loop"
                    icon={<Repeat size={12} />}
                    label={`${analysis.loopEdges.size + analysis.loopJumps.size} loop${analysis.loopEdges.size + analysis.loopJumps.size === 1 ? '' : 's'}`}
                    title="Connections that lead back to an earlier point. Click to visit each."
                    onClick={() => focusNext('loops', [...loopEdgeTargets, ...analysis.loopJumps])}
                  />
                )}
              </AnimatePresence>
              <div className="flex items-center rounded-lg border border-line bg-panel/90 p-0.5 shadow-pop backdrop-blur">
                <ToolButton icon={<Network size={15} />} label="Auto-layout (undoable)" onClick={runAutoLayout} disabled={empty} />
                <ToolButton
                  icon={<Maximize size={15} />}
                  label="Fit to view"
                  onClick={() => void rf.fitView({ padding: 0.25, duration: 400, maxZoom: 1 })}
                  disabled={empty}
                />
                <div className="mx-0.5 h-5 w-px bg-line" />
                <ToolButton icon={<Grid3x3 size={15} />} label="Snap to grid" active={snapToGrid} onClick={() => setPrefs({ snapToGrid: !snapToGrid })} />
                <ToolButton
                  icon={<Activity size={15} />}
                  label="Animate flow direction"
                  active={animateEdges}
                  onClick={() => setPrefs({ animateEdges: !animateEdges })}
                />
              </div>
            </div>
          </Panel>
        </ReactFlow>

        {empty && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="pointer-events-none absolute inset-0 grid place-items-center"
          >
            <div className="rounded-xl border border-dashed border-line bg-panel/60 px-6 py-5 text-center backdrop-blur-sm">
              <p className="text-sm font-medium text-muted">This flow is empty</p>
              <p className="mt-1 max-w-[300px] text-xs text-faint">
                Drag a node from the palette, or double-click (or right-click) the canvas. The first node you add becomes the start.
              </p>
            </div>
          </motion.div>
        )}
      </div>

      <Popover anchor={quickAdd?.anchor ?? null} onClose={() => setQuickAdd(null)} width={240}>
        <p className="px-2 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">
          {quickAdd?.from ? 'Continue with…' : quickAdd?.to ? 'Lead into it with…' : 'Add node'}
        </p>
        {NODE_TYPES.filter((t) => !(quickAdd?.to && t === 'jump')).map((type) => {
          const meta = NODE_META[type]
          const Icon = meta.icon
          return (
            <MenuItem key={type} icon={<Icon size={14} />} color={meta.color} label={meta.label} hint={meta.hint} onClick={() => createFromQuickAdd(type)} />
          )
        })}
      </Popover>
    </FlowContext.Provider>
  )
}

// ---------------------------------------------------------------------------

function Palette({ onAdd }: { onAdd(type: NodeType): void }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex flex-col gap-0.5 rounded-lg border border-line bg-panel/90 p-1 shadow-pop backdrop-blur"
    >
      {NODE_TYPES.map((type) => {
        const meta = NODE_META[type]
        const Icon = meta.icon
        return (
          <motion.button
            key={type}
            type="button"
            draggable
            onDragStart={(e) => {
              const de = e as unknown as globalThis.DragEvent
              de.dataTransfer?.setData(NODE_DRAG_MIME, type)
              if (de.dataTransfer) de.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => onAdd(type)}
            whileHover={{ x: 2 }}
            whileTap={{ scale: 0.96 }}
            title={`${meta.hint}. Drag onto the canvas, or click to add.`}
            className="flex cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted transition-colors hover:bg-raised hover:text-fg active:cursor-grabbing"
          >
            <span className="grid h-5 w-5 place-items-center rounded" style={{ background: `${meta.color}22`, color: meta.color }}>
              <Icon size={12} />
            </span>
            {meta.label}
          </motion.button>
        )
      })}
    </motion.div>
  )
}

function ToolButton({
  icon,
  label,
  onClick,
  active,
  disabled
}: {
  icon: ReactNode
  label: string
  onClick(): void
  active?: boolean
  disabled?: boolean
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cx(
        'grid h-7 w-7 place-items-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-35',
        active ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-raised hover:text-fg'
      )}
    >
      {icon}
    </motion.button>
  )
}

function IssueChip({
  tone,
  icon,
  label,
  title,
  onClick
}: {
  tone: 'warn' | 'loop'
  icon: ReactNode
  label: string
  title: string
  onClick(): void
}) {
  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      title={title}
      className={cx(
        'flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium shadow-pop backdrop-blur',
        tone === 'warn' ? 'border-warn/40 bg-warn/10 text-warn' : 'border-loop/40 bg-loop/10 text-loop'
      )}
    >
      {icon}
      {label}
    </motion.button>
  )
}

