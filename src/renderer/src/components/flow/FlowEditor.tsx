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
import { Activity, AlertTriangle, Frame as FrameIcon, Grid3x3, Maximize, MessageSquare, Network, Play, Repeat } from 'lucide-react'
import { openThreadCounts } from '@shared/comments'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { analyzeFlow, type FlowAnalysis } from '@shared/flowAnalysis'
import { framesOf, nodesInFrame } from '@shared/frames'
import { nodeTakes } from '@shared/time'
import { choiceNumbers, startNodes } from '@shared/flowOrder'
import { canConnect, dataRef, dataString, NODE_TYPES, type NodeType } from '@shared/nodes'
import type { Flow, Position, Project } from '@shared/schema'
import type { IssueMap } from '@shared/validate'
import { useIssues } from '../../hooks/useIssues'
import { cx } from '../../lib/cx'
import { addFrame, addNode, autoLayout, connect, deleteElements, duplicateNodes, moveNodes, pasteNodes, placeFrame, reconnect } from '../../store/flowOps'
import { copySelection, readClipboard } from '@shared/clipboard'
import { parseScreenplay } from '@shared/screenplay'
import { endingNumbers } from '@shared/script'
import { toast } from '../../lib/toast'
import { useUi } from '../../store/ui'
import { quickEntryKey, setMeasuredSizes } from '../../lib/quickKeys'
import { usePrefs } from '../../store/prefs'
import { useProjectStore, type Selection } from '../../store/projectStore'
import { usePlay } from '../../store/play'
import { PlayPanel } from '../play/PlayPanel'
import { MenuItem, Popover } from '../ui/Popover'
import { COLORS, FlowContext, NODE_DRAG_MIME, NODE_META } from './flowMeta'
import { ConnectionLine, edgeColor, NarrativeEdge, type NarrativeRFEdge } from './NarrativeEdge'
import { FrameNode, type FrameRFNode } from './FrameNode'
import { NarrativeNode, type NarrativeRFNode } from './NarrativeNode'

const nodeTypes = { narrative: NarrativeNode, frame: FrameNode }

/** Everything on the canvas: story nodes, and the frames that group them. */
type CanvasNode = NarrativeRFNode | FrameRFNode
const isFrame = (n: { type?: string }): boolean => n.type === 'frame'
const edgeTypes = { narrative: NarrativeEdge }

/** Where new nodes appear relative to the pointer (roughly the node's top centre). */
const DROP_OFFSET = { x: 130, y: 24 }

/** Width of the Play panel plus its margin (see PlayPanel). */
const PLAY_PANEL_WIDTH = 404

// ---------------------------------------------------------------------------
// Store → React Flow

function deriveNodes(project: Project, flow: Flow, analysis: FlowAnalysis, issues: IssueMap): NarrativeRFNode[] {
  const starts = startNodes(flow)
  const startRank = new Map(starts.length > 1 ? starts.map((n, i) => [n.id, i + 1] as const) : [])
  const endings = endingNumbers(flow)
  return Object.values(flow.nodes)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((node) => {
      const speakerId = dataRef(node, 'speakerId')
      const speaker = speakerId ? project.entities[speakerId] : undefined
      const template = speaker ? project.templates[speaker.templateId] : undefined
      const targetId = dataRef(node, 'targetId')
      const target = targetId ? flow.nodes[targetId] : undefined
      const otherFlowId = node.type === 'jump' ? dataRef(node, 'targetFlowId') : node.type === 'call' ? dataRef(node, 'flowId') : null
      const otherFlow = otherFlowId ? project.flows[otherFlowId] : undefined
      const nodeIssues = issues.get(node.id) ?? []
      return {
        id: node.id,
        type: 'narrative' as const,
        position: node.position,
        data: {
          node,
          speaker: speaker ? { name: speaker.name, color: template?.color ?? COLORS.accent, icon: template?.icon ?? 'user' } : null,
          jumpTarget: target ? describeNode(project, target) : null,
          otherFlow: otherFlow ? { id: otherFlow.id, name: otherFlow.name } : null,
          takes: nodeTakes(project, node),
          warn: nodeIssues.some((i) => i.level === 'warning'),
          error: nodeIssues.some((i) => i.level === 'error'),
          loopJump: analysis.loopJumps.has(node.id),
          startRank: startRank.get(node.id) ?? null,
          ending: endings.has(node.id) ? { number: endings.get(node.id)!, of: endings.size } : null,
          issues: nodeIssues
        }
      }
    })
}

function deriveFrames(flow: Flow): FrameRFNode[] {
  return framesOf(flow).map((frame, i) => ({
    id: frame.id,
    type: 'frame' as const,
    position: frame.position,
    width: frame.width,
    height: frame.height,
    // Behind the story nodes; larger frames behind smaller ones.
    zIndex: -100 + i,
    dragHandle: '.sk-frame-handle',
    style: { pointerEvents: 'none' as const },
    data: { frame, flowId: flow.id, count: nodesInFrame(flow, frame).length }
  }))
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
  const rf = useReactFlow<CanvasNode, NarrativeRFEdge>()
  const wrapper = useRef<HTMLDivElement>(null)

  // React Flow owns transient state (drag positions, selection, measured
  // sizes); the store owns the document. Re-derive from the store whenever
  // the document changes, carrying the transient state across.
  const derivedNodes = useMemo<CanvasNode[]>(() => [...deriveFrames(flow), ...deriveNodes(project, flow, analysis, issues)], [project, flow, analysis, issues])
  const derivedEdges = useMemo(() => deriveEdges(flow, analysis), [flow, analysis])
  const initialSelection = useProjectStore.getState().selection
  const [nodes, setNodes] = useState<CanvasNode[]>(() =>
    derivedNodes.map((n) => ({ ...n, selected: initialSelection?.kind === 'node' && initialSelection.id === n.id }))
  )
  const [edges, setEdges] = useState<NarrativeRFEdge[]>(derivedEdges)

  /** Nodes to select once they arrive (just pasted). */
  const selectNext = useRef<Set<string> | null>(null)
  useEffect(() => {
    setNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]))
      const pending = selectNext.current
      if (pending) {
        selectNext.current = null
        return derivedNodes.map((n) => ({ ...n, selected: pending.has(n.id), measured: byId.get(n.id)?.measured }) as CanvasNode)
      }
      // A node that was just created (palette, quick-add, duplicate) arrives
      // selected, so the inspector opens on it straight away.
      const sel = useProjectStore.getState().selection
      const fresh = sel?.kind === 'node' && sel.flowId === flow.id && !byId.has(sel.id) ? sel.id : null
      return derivedNodes.map((n) => {
        const old = byId.get(n.id)
        if (fresh) return (old ? { ...n, selected: false, measured: old.measured } : { ...n, selected: n.id === fresh }) as CanvasNode
        return (old ? { ...n, selected: old.selected, measured: old.measured } : n) as CanvasNode
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
    (changes: NodeChange<CanvasNode>[]) => setNodes((nds) => applyNodeChanges(changes.filter((c) => c.type !== 'remove'), nds)),
    []
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange<NarrativeRFEdge>[]) => setEdges((eds) => applyEdgeChanges(changes.filter((c) => c.type !== 'remove'), eds)),
    []
  )

  const onSelectionChange = useCallback(
    ({ nodes: allSelNodes, edges: selEdges }: OnSelectionChangeParams) => {
      const selNodes = allSelNodes.filter((n) => !isFrame(n)) // frames are edited on the canvas itself
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
      const zoom = Math.max(rf.getZoom(), 0.9)
      // With the Play panel open, centre in the part of the canvas it doesn't cover.
      const play = usePlay.getState()
      const shift = play.open && play.flowId === flow.id ? PLAY_PANEL_WIDTH / 2 / zoom : 0
      void rf.setCenter(target.position.x + (measured?.width ?? 260) / 2 + shift, target.position.y + (measured?.height ?? 100) / 2, {
        zoom,
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

  // Keep the flow fitted to the canvas until the designer pans or zooms. The first fit can run
  // before the panels around the canvas have their final size (which left a flow at 15% zoom,
  // tucked into a corner), so refit whenever the canvas resizes, as long as nobody has moved it.
  const userMoved = useRef(false)
  useEffect(() => {
    userMoved.current = false
    const el = wrapper.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(() => {
      if (userMoved.current) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (!userMoved.current) void rf.fitView({ padding: 0.3, maxZoom: 1 })
      }, 80)
    })
    observer.observe(el)
    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [flow.id, rf])

  const runAutoLayout = () => {
    const sizes = Object.fromEntries(
      rf.getNodes().map((n) => [n.id, { width: n.measured?.width ?? 260, height: n.measured?.height ?? 100 }])
    )
    autoLayout(flow.id, sizes)
    setTimeout(() => void rf.fitView({ padding: 0.25, duration: 450, maxZoom: 1 }), 60)
  }

  // --- Frames -----------------------------------------------------------------

  const sizesNow = () =>
    Object.fromEntries(
      rf
        .getNodes()
        .filter((n) => !isFrame(n))
        .map((n) => [n.id, { width: n.measured?.width ?? 260, height: n.measured?.height ?? 100 }])
    )

  /** A frame around the selected nodes, or an empty one in the middle of the view. */
  const addFrameHere = () => {
    const selected = nodes.filter((n) => n.selected && !isFrame(n)).map((n) => n.id)
    const rect = wrapper.current?.getBoundingClientRect()
    const centre = rect ? rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: 0, y: 0 }
    addFrame(flow.id, selected.length ? { around: selected, sizes: sizesNow() } : { at: { x: centre.x - 280, y: centre.y - 180 } })
  }

  // Dragging a frame carries the nodes inside it along.
  const frameDrag = useRef<Map<string, { start: Position; members: Map<string, Position> }>>(new Map())
  const startFrameDrag = (dragged: CanvasNode[]) => {
    frameDrag.current.clear()
    const draggedIds = new Set(dragged.map((n) => n.id))
    const sizes = sizesNow()
    for (const n of dragged) {
      if (!isFrame(n)) continue
      const frame = flow.frames?.[n.id]
      if (!frame) continue
      const members = new Map<string, Position>()
      for (const id of nodesInFrame(flow, frame, sizes)) if (!draggedIds.has(id)) members.set(id, flow.nodes[id].position)
      // Frames inside the frame come along too.
      for (const inner of framesOf(flow))
        if (inner.id !== frame.id && !draggedIds.has(inner.id) && nodesInFrameRect(frame, inner)) members.set(inner.id, inner.position)
      frameDrag.current.set(n.id, { start: frame.position, members })
    }
  }
  const dragFrames = (dragged: CanvasNode[]) => {
    if (!frameDrag.current.size) return
    const moved = new Map<string, Position>()
    for (const n of dragged) {
      const d = frameDrag.current.get(n.id)
      if (!d) continue
      const dx = n.position.x - d.start.x
      const dy = n.position.y - d.start.y
      for (const [id, p] of d.members) moved.set(id, { x: p.x + dx, y: p.y + dy })
    }
    if (moved.size) setNodes((nds) => nds.map((n) => (moved.has(n.id) ? ({ ...n, position: moved.get(n.id)! } as CanvasNode) : n)))
  }
  const stopDrag = (dragged: CanvasNode[]) => {
    const frames = dragged.filter(isFrame)
    const positions: Record<string, Position> = Object.fromEntries(dragged.filter((n) => !isFrame(n)).map((n) => [n.id, n.position]))
    if (!frames.length) {
      moveNodes(flow.id, positions)
      return
    }
    // One undo step per dragged frame, carrying its members (and any other dragged nodes) with it.
    frames.forEach((f, i) => {
      const d = frameDrag.current.get(f.id)
      const dx = f.position.x - (d?.start.x ?? f.position.x)
      const dy = f.position.y - (d?.start.y ?? f.position.y)
      const members: Record<string, Position> = i === 0 ? { ...positions } : {}
      const innerFrames: [string, Position][] = []
      for (const [id, p] of d?.members ?? []) {
        if (flow.frames?.[id]) innerFrames.push([id, { x: p.x + dx, y: p.y + dy }])
        else members[id] = { x: p.x + dx, y: p.y + dy }
      }
      placeFrame(flow.id, f.id, { position: f.position }, members)
      for (const [id, p] of innerFrames) placeFrame(flow.id, id, { position: p })
    })
    frameDrag.current.clear()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
      e.preventDefault()
      addFrameHere()
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      const ids = nodes.filter((n) => n.selected && !isFrame(n)).map((n) => n.id)
      const created = duplicateNodes(flow.id, ids)
      if (created.length === 1) select({ kind: 'node', flowId: flow.id, id: created[0] })
      return
    }
    // Quick line entry: one node selected, Enter writes the next line (not while a button has focus: Enter presses it).
    const picked = nodes.filter((n) => n.selected && !isFrame(n))
    if (picked.length === 1 && !t.closest('button, a, select')) quickEntryKey(e, flow.id, picked[0].id)
  }
  // A node just added off screen (quick line entry) slides into view, at the same zoom.
  const reveal = useUi((s) => s.reveal)
  useEffect(() => {
    if (!reveal || !flow.nodes[reveal.nodeId]) return
    const t = setTimeout(() => {
      const node = rf.getNode(reveal.nodeId)
      const box = wrapper.current?.getBoundingClientRect()
      if (!node || !box) return
      const w = node.measured?.width ?? 260
      const h = node.measured?.height ?? 100
      const tl = rf.flowToScreenPosition(node.position)
      const br = rf.flowToScreenPosition({ x: node.position.x + w, y: node.position.y + h })
      const margin = 48
      const inView = tl.x >= box.left + margin && tl.y >= box.top + margin && br.x <= box.right - margin && br.y <= box.bottom - margin
      if (!inView) void rf.setCenter(node.position.x + w / 2, node.position.y + h / 2, { zoom: rf.getZoom(), duration: 300 })
    }, 60)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal])
  // New lines are placed clear of nodes as the canvas measured them.
  useEffect(() => {
    setMeasuredSizes((id) => {
      const m = rf.getNode(id)?.measured
      return m?.width && m.height ? { width: m.width, height: m.height } : undefined
    })
    return () => setMeasuredSizes(undefined)
  }, [rf])

  // --- Copy and paste ---------------------------------------------------------
  // Through the system clipboard (copy/cut/paste events, so no permission prompts),
  // as JSON text: nodes can go to another flow, another project or another tab.

  /** The pointer's last spot on the canvas, in flow coordinates: where a paste lands. */
  const pointer = useRef<Position | null>(null)
  const typing = (t: EventTarget | null) => {
    const el = t as HTMLElement | null
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
  }
  const selectedIds = () => ({
    nodes: nodes.filter((n) => n.selected && !isFrame(n)).map((n) => n.id),
    frames: nodes.filter((n) => n.selected && isFrame(n)).map((n) => n.id)
  })
  // Listened for on the document: after a cut the focused node is gone and focus
  // falls back to the page, and a paste should still land here.
  const clip = useRef({ onCopy: (_e: globalThis.ClipboardEvent, _cut: boolean) => {}, onPaste: (_e: globalThis.ClipboardEvent) => {} })
  clip.current.onCopy = (e, cut) => {
    const sel = selectedIds()
    const payload = copySelection(project, flow.id, sel.nodes, sel.frames)
    if (!payload || !e.clipboardData) return
    e.preventDefault()
    e.clipboardData.setData('text/plain', JSON.stringify(payload))
    if (cut) deleteElements(flow.id, sel.nodes, [], sel.frames)
  }
  clip.current.onPaste = (e) => {
    const text = e.clipboardData?.getData('text/plain') ?? ''
    const payload = readClipboard(text)
    if (!payload) {
      // Not nodes: maybe a scene written as text. Preview it before it becomes lines.
      if (!parseScreenplay(text)) return
      e.preventDefault()
      const sel = selectedIds().nodes
      const box = wrapper.current?.getBoundingClientRect()
      const centre = box ? rf.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 3 }) : { x: 0, y: 0 }
      useUi.getState().setScenePaste({ flowId: flow.id, text, at: pointer.current ?? centre, after: sel.length === 1 ? sel[0] : null })
      return
    }
    e.preventDefault()
    const result = pasteNodes(flow.id, payload, pointer.current)
    if (!result.nodeIds.length) return
    selectNext.current = new Set(result.nodeIds)
    if (result.nodeIds.length === 1) select({ kind: 'node', flowId: flow.id, id: result.nodeIds[0] })
    else select({ kind: 'flow', id: flow.id })
    if (result.notes.length) toast.info(`Pasted ${result.nodeIds.length} node${result.nodeIds.length === 1 ? '' : 's'}`, result.notes.join('\n'))
  }
  useEffect(() => {
    const ours = (e: Event) => {
      const t = e.target as Node | null
      if (typing(t)) return false
      // Text picked out on the page (a node's text, say) copies as text.
      if (e.type !== 'paste' && window.getSelection()?.isCollapsed === false) return false
      return t === document.body || !!(t && wrapper.current?.contains(t))
    }
    const copy = (e: globalThis.ClipboardEvent) => ours(e) && clip.current.onCopy(e, false)
    const cut = (e: globalThis.ClipboardEvent) => ours(e) && clip.current.onCopy(e, true)
    const paste = (e: globalThis.ClipboardEvent) => ours(e) && clip.current.onPaste(e)
    document.addEventListener('copy', copy)
    document.addEventListener('cut', cut)
    document.addEventListener('paste', paste)
    return () => {
      document.removeEventListener('copy', copy)
      document.removeEventListener('cut', cut)
      document.removeEventListener('paste', paste)
    }
  }, [])

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

  const playing = usePlay((s) => s.open && s.flowId === flow.id)
  const commentCounts = openThreadCounts(flow)
  // In canvas order (top to bottom, then left to right), so clicking walks the flow.
  const commentNodes = [...commentCounts.keys()]
    .filter((id) => flow.nodes[id])
    .sort((a, b) => flow.nodes[a].position.y - flow.nodes[b].position.y || flow.nodes[a].position.x - flow.nodes[b].position.x)
  const openThreads = [...commentCounts.values()].reduce((n, c) => n + c, 0)
  const ctx = useMemo(() => ({ flow, animate: animateEdges }), [flow, animateEdges])
  const empty = nodes.length === 0

  return (
    <FlowContext.Provider value={ctx}>
      <div
        ref={wrapper}
        className="relative h-full w-full outline-none"
        onKeyDown={onKeyDown}
        onMouseMove={(e) => {
          pointer.current = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
        }}
        onMouseLeave={() => {
          pointer.current = null
        }}
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
        <ReactFlow<CanvasNode, NarrativeRFEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onSelectionChange={onSelectionChange}
          onNodeDragStart={(_e, _n, dragged) => startFrameDrag(dragged)}
          onNodeDrag={(_e, _n, dragged) => dragFrames(dragged)}
          onNodeDragStop={(_e, _n, dragged) => stopDrag(dragged)}
          onConnect={(c) => connect(flow.id, c)}
          onConnectEnd={onConnectEnd}
          onReconnect={(old, c) => reconnect(flow.id, old.id, c)}
          edgesReconnectable
          onDelete={({ nodes: ns, edges: es }) =>
            deleteElements(
              flow.id,
              ns.filter((n) => !isFrame(n)).map((n) => n.id),
              es.map((e) => e.id),
              ns.filter(isFrame).map((n) => n.id)
            )
          }
          elevateNodesOnSelect={false}
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
          onMoveStart={(event) => {
            if (event) userMoved.current = true // a real pan or zoom, not a programmatic fit
          }}
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
              if (isFrame(n)) return 'rgba(255, 255, 255, 0.05)'
              const d = (n as NarrativeRFNode).data
              return d?.error ? COLORS.false : d?.warn ? '#fbbf24' : '#5a6174'
            }}
            nodeStrokeColor="#818cf8"
            maskColor="rgba(10, 11, 15, 0.65)"
            bgColor="#0f1117"
            style={{ width: 160, height: 110 }}
          />

          <Panel position="top-left">
            <Palette onAdd={addAtCenter} onFrame={addFrameHere} />
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
                {commentNodes.length > 0 && (
                  <IssueChip
                    key="comments"
                    tone="accent"
                    icon={<MessageSquare size={12} />}
                    label={`${openThreads} open comment${openThreads === 1 ? '' : 's'}`}
                    title="Comment threads nobody has resolved yet. Click to visit each."
                    onClick={() => focusNext('comments', commentNodes)}
                  />
                )}
              </AnimatePresence>
              <button
                type="button"
                onClick={() => (playing ? usePlay.getState().close() : usePlay.getState().openFor(flow.id, 'play'))}
                disabled={empty}
                title={playing ? 'Stop playing' : 'Play this flow as the game would, and explore every path'}
                className={cx(
                  'flex h-[34px] items-center gap-1.5 rounded-lg border px-3 text-xs font-medium shadow-pop backdrop-blur transition-colors disabled:pointer-events-none disabled:opacity-40',
                  playing ? 'border-ok/60 bg-ok/15 text-ok' : 'border-line bg-panel/90 text-fg hover:border-ok/60 hover:text-ok'
                )}
              >
                <Play size={13} fill={playing ? 'currentColor' : 'none'} /> {playing ? 'Playing' : 'Play'}
              </button>
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
        <AnimatePresence>{playing && <PlayPanel key="play" project={project} flowId={flow.id} />}</AnimatePresence>

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

function Palette({ onAdd, onFrame }: { onAdd(type: NodeType): void; onFrame(): void }) {
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
      <div className="my-0.5 border-t border-line/70" />
      <motion.button
        type="button"
        onClick={onFrame}
        whileHover={{ x: 2 }}
        whileTap={{ scale: 0.96 }}
        title="Group nodes in a labelled frame (Ctrl+G). Frames are for you: they don't change how the story plays."
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted transition-colors hover:bg-raised hover:text-fg"
      >
        <span className="grid h-5 w-5 place-items-center rounded bg-raised text-muted">
          <FrameIcon size={12} />
        </span>
        Frame
      </motion.button>
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
  tone: 'warn' | 'loop' | 'accent'
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
        tone === 'warn' ? 'border-warn/40 bg-warn/10 text-warn' : tone === 'accent' ? 'border-accent/40 bg-accent/10 text-accent' : 'border-loop/40 bg-loop/10 text-loop'
      )}
    >
      {icon}
      {label}
    </motion.button>
  )
}

/** Whether frame `inner` lies entirely inside frame `outer`. */
function nodesInFrameRect(outer: { position: Position; width: number; height: number }, inner: { position: Position; width: number; height: number }): boolean {
  return (
    inner.position.x >= outer.position.x &&
    inner.position.y >= outer.position.y &&
    inner.position.x + inner.width <= outer.position.x + outer.width &&
    inner.position.y + inner.height <= outer.position.y + outer.height
  )
}
