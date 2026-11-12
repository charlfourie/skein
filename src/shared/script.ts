/**
 * A flow read as a script: its lines in the order a reader would follow them,
 * branches indented under the choice or condition they hang from.
 *
 * Every node appears exactly once. Where the story reaches a node it has
 * already shown (a loop, or branches meeting again) the script says where it
 * continues instead of repeating it. Nodes no start reaches come last.
 */
import { orderedTargets, outgoingEdges, startNodes } from './flowOrder'
import { dataString, isEndNode, outputHandles } from './nodes'
import type { Flow, FlowNode, Project } from './schema'

/** How a branch is offered: a choice the player picks, or the first that's available. */
export type BranchKind = 'choice' | 'first'

export interface BranchInfo {
  kind: BranchKind
  /** The connection into this branch, for reordering. */
  edgeId: string
  index: number
  count: number
}

export type ScriptItem =
  | { kind: 'start'; nodeId: string; depth: number; index: number; count: number }
  | { kind: 'unreached'; depth: number }
  | { kind: 'line'; nodeId: string; depth: number; branch?: BranchInfo }
  | { kind: 'direction'; nodeId: string; depth: number; branch?: BranchInfo }
  | { kind: 'condition'; nodeId: string; depth: number; branch?: BranchInfo }
  | { kind: 'when'; nodeId: string; depth: number; outcome: 'true' | 'false' }
  | { kind: 'goto'; nodeId: string; targetId: string | null; depth: number; reason: 'again' | 'jump'; branch?: BranchInfo }

type Task = { node: string; depth: number; branch?: BranchInfo } | { item: ScriptItem }

export function scriptOf(flow: Flow): ScriptItem[] {
  const items: ScriptItem[] = []
  const seen = new Set<string>()
  const starts = startNodes(flow)

  // An explicit stack instead of recursion: a long linear scene is deep.
  const walk = (first: Task[]) => {
    const stack: Task[] = [...first].reverse()
    while (stack.length) {
      const task = stack.pop()!
      if ('item' in task) {
        items.push(task.item)
        continue
      }
      const { node: id, depth, branch } = task
      const node = flow.nodes[id]
      if (!node) continue
      if (seen.has(id)) {
        items.push({ kind: 'goto', nodeId: id, targetId: id, depth, reason: 'again', branch })
        continue
      }
      seen.add(id)
      const next: Task[] = []
      if (node.type === 'jump') {
        const target = typeof node.data.targetId === 'string' && flow.nodes[node.data.targetId] ? node.data.targetId : null
        items.push({ kind: 'goto', nodeId: id, targetId: target, depth, reason: 'jump', branch })
      } else if (node.type === 'condition') {
        items.push({ kind: 'condition', nodeId: id, depth, branch })
        for (const outcome of ['true', 'false'] as const) {
          const [target] = orderedTargets(flow, id, outcome)
          if (!target) continue
          next.push({ item: { kind: 'when', nodeId: id, depth, outcome } }, { node: target, depth: depth + 1 })
        }
      } else {
        items.push({ kind: node.type === 'dialogue' ? 'line' : 'direction', nodeId: id, depth, branch })
        const outs = outputHandles(node.type).flatMap((h) => outgoingEdges(flow, id, h))
        if (outs.length === 1) next.push({ node: outs[0].target, depth })
        else {
          const kind: BranchKind = node.type === 'dialogue' || node.type === 'hub' ? 'choice' : 'first'
          outs.forEach((e, index) => next.push({ node: e.target, depth: depth + 1, branch: { kind, edgeId: e.id, index, count: outs.length } }))
        }
      }
      for (let i = next.length - 1; i >= 0; i--) stack.push(next[i])
    }
  }

  starts.forEach((s, index) => {
    if (seen.has(s.id)) return
    if (starts.length > 1) items.push({ kind: 'start', nodeId: s.id, depth: 0, index, count: starts.length })
    walk([{ node: s.id, depth: 0 }])
  })

  // What no start reaches: begin from nodes nothing leads to, top to bottom.
  const leftover = () => Object.values(flow.nodes).filter((n) => !seen.has(n.id))
  if (leftover().length) {
    items.push({ kind: 'unreached', depth: 0 })
    const incoming = new Set(Object.values(flow.edges).map((e) => e.target))
    const byPlace = (a: FlowNode, b: FlowNode) => a.position.y - b.position.y || a.position.x - b.position.x || (a.id < b.id ? -1 : 1)
    while (leftover().length) {
      const rest = leftover().sort(byPlace)
      const root = rest.find((n) => !incoming.has(n.id)) ?? rest[0] // a loop nothing enters: start anywhere
      walk([{ node: root.id, depth: 0 }])
    }
  }
  return items
}

/**
 * The flow's endings (nodes marked End), numbered in reading order: ending 1 is
 * the first a reader meets going down the script. Stable as long as the story's
 * shape is; moving nodes on the canvas doesn't renumber them.
 */
export function endingNumbers(flow: Flow, items: ScriptItem[] = scriptOf(flow)): Map<string, number> {
  const out = new Map<string, number>()
  for (const item of items) {
    if (!('nodeId' in item) || item.kind === 'when' || item.kind === 'goto') continue
    if (isEndNode(flow.nodes[item.nodeId]) && !out.has(item.nodeId)) out.set(item.nodeId, out.size + 1)
  }
  return out
}

// ---- Plain text and printing ------------------------------------------------

/** What a line says, for reading: the speaker's name and text. */
export function lineParts(project: Project, node: FlowNode): { speaker: string | null; text: string; menuText: string } {
  const id = node.data.speakerId
  const speaker = typeof id === 'string' ? (project.entities[id]?.name ?? null) : null
  return { speaker, text: dataString(node, 'text'), menuText: dataString(node, 'menuText') }
}

/** A one-line description of a non-dialogue node. */
export function directionText(project: Project, node: FlowNode): string {
  switch (node.type) {
    case 'instruction':
      return dataString(node, 'script') || 'Instruction'
    case 'hub':
      return dataString(node, 'label') || 'Hub'
    case 'call': {
      const f = typeof node.data.flowId === 'string' ? project.flows[node.data.flowId] : undefined
      return f ? `Play “${f.name}”` : 'Play flow (none chosen)'
    }
    default:
      return node.type
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Short words for where a "goto" leads. */
export function gotoText(project: Project, flow: Flow, item: Extract<ScriptItem, { kind: 'goto' }>): string {
  const node = flow.nodes[item.nodeId]
  if (item.reason === 'jump') {
    const other = typeof node?.data.targetFlowId === 'string' ? project.flows[node.data.targetFlowId] : undefined
    if (other) return `Continues in “${other.name}”`
    if (!item.targetId) return 'Jump (no target)'
  }
  const target = item.targetId ? flow.nodes[item.targetId] : undefined
  if (!target) return 'Continues'
  if (target.type === 'dialogue') {
    const { speaker, text } = lineParts(project, target)
    const short = text.length > 48 ? `${text.slice(0, 48)}…` : text
    return `Back to ${speaker ? `${speaker}: ` : ''}“${short || '…'}”`
  }
  return `Back to ${directionText(project, target)}`
}

/** A printable page for the script (opened in a new window and printed). */
export function scriptHtml(project: Project, flow: Flow, items = scriptOf(flow)): string {
  const endings = endingNumbers(flow, items)
  const rows = items.map((item) => {
    const pad = `style="margin-left:${item.depth * 1.6}em"`
    const node = 'nodeId' in item ? flow.nodes[item.nodeId] : undefined
    const mark = 'branch' in item && item.branch ? `<span class="n">${item.branch.kind === 'choice' ? `${item.branch.index + 1}.` : 'or'}</span> ` : ''
    switch (item.kind) {
      case 'start':
        return `<h2 ${pad}>Start ${item.index + 1}</h2>`
      case 'unreached':
        return `<h2>Not reached from a start</h2>`
      case 'line': {
        const { speaker, text } = lineParts(project, node!)
        const n = endings.size > 1 ? endings.get(node!.id) : undefined
        const end = node && isEndNode(node) ? ` <span class="end">END${n ? ` ${n}` : ''}</span>` : ''
        return `<div class="line" ${pad}>${mark}<span class="who">${esc(speaker ?? 'Narration')}</span><div class="say">${esc(text) || '<em>(no text)</em>'}${end}</div></div>`
      }
      case 'direction':
        return `<div class="dir" ${pad}>${mark}(${esc(directionText(project, node!))})</div>`
      case 'condition':
        return `<div class="dir" ${pad}>${mark}Check: ${esc(dataString(node!, 'expression') || '(no condition)')}</div>`
      case 'when':
        return `<div class="when" ${pad}>${item.outcome === 'true' ? 'If so:' : 'Otherwise:'}</div>`
      case 'goto':
        return `<div class="dir" ${pad}>${mark}→ ${esc(gotoText(project, flow, item))}</div>`
    }
  })
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(project.meta.name)} · ${esc(flow.name)}</title>
<style>
body{font:12pt/1.45 "Courier Prime","Courier New",monospace;color:#111;max-width:46em;margin:2em auto;padding:0 1em}
h1{font-size:14pt;text-transform:uppercase;letter-spacing:.06em;margin:0 0 .2em}
.sub{color:#666;margin:0 0 2em;font-size:10pt}
h2{font-size:11pt;text-transform:uppercase;margin:1.6em 0 .6em;color:#444}
.line{margin:0 0 .9em;break-inside:avoid}
.who{display:block;text-transform:uppercase;margin-left:12em}
.say{margin-left:6em;margin-right:4em;white-space:pre-wrap}
.dir,.when{margin:0 0 .9em;color:#444;font-style:italic}
.when{font-style:normal;text-transform:uppercase;font-size:10pt}
.n{font-weight:bold;font-style:normal}
.end{font-size:9pt;border:1px solid #999;padding:0 .3em;margin-left:.4em}
@media print{body{margin:0}}
</style></head><body><h1>${esc(flow.name)}</h1><p class="sub">${esc(project.meta.name)}</p>
${rows.join('\n')}
</body></html>`
}
