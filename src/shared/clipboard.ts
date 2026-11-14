/**
 * Copy and paste on the canvas: nodes, the connections between them and the
 * frames around them, as plain JSON text on the system clipboard, so they can
 * be pasted into another flow, another project, or another copy of Skein.
 *
 * Pasted nodes are new nodes: new ids, new line IDs, never a second start.
 * Things they point at are matched by name in the target project (speakers by
 * technical name, flows by name), and anything that can't be matched is
 * dropped and reported, rather than left pointing at nothing.
 */
import { assignLineId } from './lineIds'
import type { Flow, FlowEdge, FlowFrame, FlowNode, Position, Project } from './schema'

export const CLIPBOARD_FORMAT = 'skein.clipboard'

export interface ClipboardPayload {
  format: typeof CLIPBOARD_FORMAT
  version: 1
  /** Where it was copied from, so a paste into the same flow can keep its links. */
  projectId: string
  flowId: string
  nodes: FlowNode[]
  /** Only connections between copied nodes. */
  edges: FlowEdge[]
  frames: FlowFrame[]
  /** Names of what the nodes point at, for matching in another project. */
  names: { entities: Record<string, string>; flows: Record<string, string> }
}

/** Copy these nodes and frames of a flow (connections between the nodes come along). */
export function copySelection(project: Project, flowId: string, nodeIds: readonly string[], frameIds: readonly string[] = []): ClipboardPayload | null {
  const flow = project.flows[flowId]
  if (!flow) return null
  const ids = new Set(nodeIds.filter((id) => flow.nodes[id]))
  const frames = frameIds.map((id) => flow.frames?.[id]).filter((f): f is FlowFrame => Boolean(f))
  if (!ids.size && !frames.length) return null
  const nodes = [...ids].sort().map((id) => flow.nodes[id])
  const edges = Object.values(flow.edges)
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
  const entities: Record<string, string> = {}
  const flows: Record<string, string> = {}
  for (const n of nodes) {
    const speaker = n.data.speakerId
    if (typeof speaker === 'string' && project.entities[speaker]) entities[speaker] = project.entities[speaker].technicalName
    for (const key of ['targetFlowId', 'flowId']) {
      const f = n.data[key]
      if (typeof f === 'string' && project.flows[f]) flows[f] = project.flows[f].name
    }
  }
  return { format: CLIPBOARD_FORMAT, version: 1, projectId: project.meta.id, flowId, nodes, edges, frames, names: { entities, flows } }
}

/** Read clipboard text: a payload, or null if it's something else (plain text, a screenplay). */
export function readClipboard(text: string): ClipboardPayload | null {
  if (!text.includes(CLIPBOARD_FORMAT)) return null
  try {
    const v = JSON.parse(text) as Partial<ClipboardPayload>
    if (v.format !== CLIPBOARD_FORMAT || v.version !== 1 || !Array.isArray(v.nodes) || !Array.isArray(v.edges)) return null
    if (!v.nodes.every((n) => n && typeof n.id === 'string' && typeof n.type === 'string' && n.position && typeof n.data === 'object')) return null
    return { frames: [], names: { entities: {}, flows: {} }, ...v } as ClipboardPayload
  } catch {
    return null
  }
}

export interface PasteResult {
  nodeIds: string[]
  /** What couldn't come along, in plain words ("speaker “Pip” isn't in this project"). */
  notes: string[]
}

/**
 * Paste into a flow (works on Immer drafts). `at` is where the top-left of the
 * pasted group goes; without it, the copy lands slightly offset from the original.
 */
export function pasteInto(project: Project, flowId: string, payload: ClipboardPayload, at: Position | null, newId: () => string): PasteResult {
  const flow = project.flows[flowId]
  if (!flow) return { nodeIds: [], notes: [] }
  const sameProject = payload.projectId === project.meta.id
  const sameFlow = sameProject && payload.flowId === flowId
  const notes = new Set<string>()

  // Where it goes: the top-left of everything copied moves to `at`.
  const points = [...payload.nodes.map((n) => n.position), ...payload.frames.map((f) => f.position)]
  const minX = Math.min(...points.map((p) => p.x))
  const minY = Math.min(...points.map((p) => p.y))
  const shift = at ? { x: Math.round(at.x - minX), y: Math.round(at.y - minY) } : { x: 40, y: 40 }
  const move = (p: Position): Position => ({ x: Math.round(p.x + shift.x), y: Math.round(p.y + shift.y) })

  const ids = new Map(payload.nodes.map((n) => [n.id, newId()]))
  const entityByName = new Map(Object.values(project.entities).map((e) => [e.technicalName, e.id]))
  const flowByName = new Map(Object.values(project.flows).map((f) => [f.name, f.id]))
  const tags = new Set(Object.values(project.flows).flatMap((f) => Object.values(f.nodes).map((n) => n.data.tag)).filter((t): t is string => typeof t === 'string'))

  for (const src of payload.nodes) {
    const id = ids.get(src.id)!
    const data: Record<string, unknown> = { ...src.data }
    delete data.isStart // a copy is never a second entry point
    delete data.startOrder
    delete data.lineId // a new line: it gets its own ID below

    const speaker = data.speakerId
    if (typeof speaker === 'string' && !(sameProject && project.entities[speaker])) {
      const name = payload.names.entities[speaker]
      const match = name ? entityByName.get(name) : undefined
      if (match) data.speakerId = match
      else {
        delete data.speakerId
        notes.add(name ? `The speaker “${name}” isn't in this project, so those lines have no speaker.` : "A speaker isn't in this project, so those lines have no speaker.")
      }
    }
    const target = data.targetId
    if (typeof target === 'string') {
      if (ids.has(target)) data.targetId = ids.get(target)
      else if (!(sameFlow && flow.nodes[target])) {
        delete data.targetId
        notes.add("A jump's target wasn't copied, so the jump needs a new target.")
      }
    }
    for (const key of ['targetFlowId', 'flowId']) {
      const f = data[key]
      if (typeof f !== 'string' || (sameProject && project.flows[f])) continue
      const name = payload.names.flows[f]
      const match = name ? flowByName.get(name) : undefined
      if (match) data[key] = match
      else {
        delete data[key]
        notes.add(`The flow ${name ? `“${name}” ` : ''}that a jump or Play flow node used isn't in this project.`)
      }
    }
    if (typeof data.tag === 'string' && tags.has(data.tag)) {
      notes.add(`Tag “${data.tag}” is already used, so the copy has no tag (tags must be unique).`)
      delete data.tag
    } else if (typeof data.tag === 'string') tags.add(data.tag)

    flow.nodes[id] = { ...src, id, position: move(src.position), data }
    assignLineId(project, flow as Flow, flow.nodes[id])
  }

  for (const e of payload.edges) {
    const source = ids.get(e.source)
    const targetId = ids.get(e.target)
    if (!source || !targetId) continue
    const id = newId()
    flow.edges[id] = { ...e, id, source, target: targetId }
    delete flow.edges[id].choiceLineId // a new choice: it gets its own ID after the edit
  }

  for (const fr of payload.frames) {
    const id = newId()
    flow.frames = flow.frames ?? {}
    flow.frames[id] = { ...fr, id, position: move(fr.position) }
  }

  return { nodeIds: [...ids.values()], notes: [...notes] }
}
