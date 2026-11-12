import { ArrowDown, ArrowUp, ClipboardPaste, Crosshair, CornerDownRight, Flag, Play, Plus, Printer } from 'lucide-react'
import { useEffect, useMemo, useRef, type ClipboardEvent, type ReactNode } from 'react'
import { dataString, isEndNode } from '@shared/nodes'
import { parseScreenplay } from '@shared/screenplay'
import { directionText, gotoText, lineParts, scriptHtml, scriptOf, type BranchInfo, type ScriptItem } from '@shared/script'
import type { Flow, Project } from '@shared/schema'
import { speakerOrder } from '@shared/quickEntry'
import { cx } from '../../lib/cx'
import { quickEntryKey } from '../../lib/quickKeys'
import { toast } from '../../lib/toast'
import { moveChoice, quickLine, updateNodeData } from '../../store/flowOps'
import { useProjectStore } from '../../store/projectStore'
import { useUi } from '../../store/ui'
import { Button } from '../ui/Button'
import { TextArea } from '../ui/fields'

/**
 * A flow read as a script (shared/script.ts), for writing and reading through.
 * Lines can be rewritten, given another speaker, followed by a new line, and
 * choices reordered; everything else is edited on the canvas.
 */
export function ScriptView({ flow }: { flow: Flow }) {
  const project = useProjectStore((s) => s.project) as Project
  const selection = useProjectStore((s) => s.selection)
  const items = useMemo(() => scriptOf(flow), [flow])
  const selectedId = selection?.kind === 'node' && selection.flowId === flow.id ? selection.id : null
  const lines = items.filter((i) => i.kind === 'line').length
  const list = useRef<HTMLDivElement>(null)

  // Keep the selected line in view (it may have been picked on the canvas or just added).
  useEffect(() => {
    if (!selectedId) return
    list.current?.querySelector(`[data-node="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  const print = () => {
    const w = window.open('', '_blank')
    if (!w) {
      toast.warn("Couldn't open the print view", 'Allow pop-ups for this site, then try again.')
      return
    }
    w.document.write(scriptHtml(project, flow, items))
    w.document.close()
    w.focus()
    w.print()
  }

  const onPaste = (e: ClipboardEvent) => {
    const t = e.target as HTMLElement
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
    const text = e.clipboardData.getData('text/plain')
    if (!parseScreenplay(text)) return
    e.preventDefault()
    openScene(flow, text, selectedId)
  }

  return (
    <div className="flex h-full flex-col" onPaste={onPaste}>
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2">
        <p className="min-w-0 flex-1 truncate text-xs text-muted">
          {lines} line{lines === 1 ? '' : 's'} · Enter adds the next line · Alt+↑/↓ changes the speaker
        </p>
        <Button variant="ghost" icon={ClipboardPaste} onClick={() => openScene(flow, '', selectedId)}>
          Paste a scene…
        </Button>
        <Button variant="ghost" icon={Printer} onClick={print}>
          Print
        </Button>
      </div>
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto" tabIndex={-1}>
        <div className="mx-auto max-w-[760px] px-6 py-6">
          {items.length === 0 ? (
            <p className="py-16 text-center text-sm text-faint">This flow is empty. Add a node on the canvas, or paste a scene.</p>
          ) : (
            items.map((item, i) => <Row key={`${item.kind}:${'nodeId' in item ? item.nodeId : ''}:${i}`} project={project} flow={flow} item={item} selectedId={selectedId} />)
          )}
        </div>
      </div>
    </div>
  )
}

function openScene(flow: Flow, text: string, after: string | null) {
  const from = after ? flow.nodes[after] : undefined
  const bottom = Object.values(flow.nodes).reduce((m, n) => Math.max(m, n.position.y), 0)
  const at = from ? { x: from.position.x, y: from.position.y + 160 } : { x: 0, y: bottom + 200 }
  useUi.getState().setScenePaste({ flowId: flow.id, text, at, after })
}

function Row({ project, flow, item, selectedId }: { project: Project; flow: Flow; item: ScriptItem; selectedId: string | null }) {
  const select = useProjectStore((s) => s.select)
  const indent = { paddingLeft: item.depth * 28 }
  const node = 'nodeId' in item ? flow.nodes[item.nodeId] : undefined
  const pick = () => node && select({ kind: 'node', flowId: flow.id, id: node.id })
  const selected = node !== undefined && node.id === selectedId && item.kind !== 'when'

  if (item.kind === 'start') {
    return (
      <h3 className="mb-2 mt-6 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-ok first:mt-0">
        <Play size={10} fill="currentColor" /> Start {item.index + 1}
      </h3>
    )
  }
  if (item.kind === 'unreached') {
    return (
      <h3 className="mb-2 mt-8 border-t border-line pt-4 text-2xs font-semibold uppercase tracking-wider text-warn">
        Not reached from a start
      </h3>
    )
  }
  if (item.kind === 'when') {
    return (
      <p style={indent} className={cx('mb-1 mt-3 text-2xs font-semibold uppercase tracking-wider', item.outcome === 'true' ? 'text-ok' : 'text-danger')}>
        {item.outcome === 'true' ? 'If so' : 'Otherwise'}
      </p>
    )
  }

  const branch = 'branch' in item ? item.branch : undefined
  const shell = (body: ReactNode, actions?: ReactNode) => (
    <div style={indent} data-node={node?.id} className="group relative">
      <div
        onMouseDown={pick}
        className={cx(
          'relative mb-1.5 flex gap-2 rounded-lg border px-3 py-2 transition-colors',
          selected ? 'border-accent/60 bg-accent/5' : 'border-transparent hover:border-line hover:bg-panel/60'
        )}
      >
        {branch && <BranchMark flowId={flow.id} branch={branch} />}
        <div className="min-w-0 flex-1">{body}</div>
        <div className="flex shrink-0 items-start gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {actions}
          {node && <ShowOnCanvas flowId={flow.id} nodeId={node.id} />}
        </div>
      </div>
    </div>
  )

  if (item.kind === 'line' && node) return shell(<LineBody project={project} flow={flow} nodeId={node.id} />, <AddAfter flowId={flow.id} nodeId={node.id} />)
  if (item.kind === 'direction' && node) {
    return shell(<p className="py-0.5 text-xs italic text-muted">({directionText(project, node)})</p>, <AddAfter flowId={flow.id} nodeId={node.id} />)
  }
  if (item.kind === 'condition' && node) {
    return shell(
      <p className="py-0.5 font-mono text-xs text-muted">
        <span className="font-sans text-2xs font-semibold uppercase tracking-wider text-faint">Check </span>
        {dataString(node, 'expression') || '(no condition)'}
      </p>
    )
  }
  if (item.kind === 'goto') {
    return shell(
      <p className="flex items-center gap-1.5 py-0.5 text-xs text-faint">
        <CornerDownRight size={12} />
        {gotoText(project, flow, item)}
      </p>
    )
  }
  return null
}

function LineBody({ project, flow, nodeId }: { project: Project; flow: Flow; nodeId: string }) {
  const node = flow.nodes[nodeId]
  const lineFocus = useUi((s) => s.lineFocus)
  const mine = lineFocus?.nodeId === nodeId && lineFocus.where === 'script'
  useEffect(() => {
    if (mine) useUi.setState({ lineFocus: null })
  }, [mine])
  const { text, menuText } = lineParts(project, node)
  const speakerId = typeof node.data.speakerId === 'string' ? node.data.speakerId : ''
  const rows = Math.max(1, text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 72)), 0))
  return (
    <div>
      <div className="flex items-center gap-2">
        <select
          value={project.entities[speakerId] ? speakerId : ''}
          onChange={(e) => updateNodeData(flow.id, nodeId, { speakerId: e.target.value || null })}
          aria-label="Speaker"
          className="max-w-[220px] cursor-pointer rounded bg-transparent py-0.5 pr-1 text-2xs font-semibold uppercase tracking-wider text-accent outline-none hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <option value="">Narration</option>
          {speakerOrder(project).map((id) => (
            <option key={id} value={id}>
              {project.entities[id].name}
            </option>
          ))}
        </select>
        {menuText && <span className="truncate text-2xs text-faint">choice: “{menuText}”</span>}
        {isEndNode(node) && (
          <span className="flex items-center gap-0.5 rounded bg-raised px-1 py-px text-[10px] font-semibold text-muted">
            <Flag size={9} /> END
          </span>
        )}
      </div>
      <TextArea
        value={text}
        rows={rows}
        label="Line"
        placeholder="What do they say?"
        onCommit={(t) => updateNodeData(flow.id, nodeId, { text: t })}
        focusNonce={mine ? lineFocus!.nonce : undefined}
        resizable={false}
        className="mt-0.5 border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-line focus:bg-bg"
        onKeyDown={(e, commit) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            commit()
            ;(e.target as HTMLTextAreaElement).blur()
            return
          }
          quickEntryKey(e, flow.id, nodeId, commit, 'script')
        }}
      />
    </div>
  )
}

function BranchMark({ flowId, branch }: { flowId: string; branch: BranchInfo }) {
  const label = branch.kind === 'choice' ? `${branch.index + 1}.` : branch.index === 0 ? 'if' : 'or'
  const title = branch.kind === 'choice' ? `Choice ${branch.index + 1} of ${branch.count}` : `Tried ${branch.index + 1} of ${branch.count}: the first available is followed`
  return (
    <div className="flex w-6 shrink-0 flex-col items-center pt-0.5" title={title}>
      <span className="font-mono text-xs font-semibold text-accent">{label}</span>
      <div className="flex flex-col opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          disabled={branch.index === 0}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => moveChoice(flowId, branch.edgeId, -1)}
          aria-label="Move earlier"
          className="grid h-4 w-5 place-items-center rounded text-faint hover:bg-raised hover:text-fg disabled:invisible"
        >
          <ArrowUp size={11} />
        </button>
        <button
          type="button"
          disabled={branch.index === branch.count - 1}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => moveChoice(flowId, branch.edgeId, 1)}
          aria-label="Move later"
          className="grid h-4 w-5 place-items-center rounded text-faint hover:bg-raised hover:text-fg disabled:invisible"
        >
          <ArrowDown size={11} />
        </button>
      </div>
    </div>
  )
}

function AddAfter({ flowId, nodeId }: { flowId: string; nodeId: string }) {
  return (
    <button
      type="button"
      title="Add a line after this (Enter)"
      aria-label="Add a line after this"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => quickLine(flowId, nodeId, undefined, 'script')}
      className="grid h-6 w-6 place-items-center rounded text-faint hover:bg-raised hover:text-fg"
    >
      <Plus size={13} />
    </button>
  )
}

function ShowOnCanvas({ flowId, nodeId }: { flowId: string; nodeId: string }) {
  const focusNode = useProjectStore((s) => s.focusNode)
  return (
    <button
      type="button"
      title="Show on the canvas"
      aria-label="Show on the canvas"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => {
        useUi.getState().setFlowView('canvas')
        focusNode(flowId, nodeId)
      }}
      className="grid h-6 w-6 place-items-center rounded text-faint hover:bg-raised hover:text-fg"
    >
      <Crosshair size={13} />
    </button>
  )
}
