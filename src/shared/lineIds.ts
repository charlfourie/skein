/**
 * Line IDs: a stable name for every dialogue line, for voice-over scripts and
 * translation (`ORDER_3f9a2c`). The choice text of a line has its own ID with
 * `_M` on the end (`ORDER_3f9a2c_M`).
 *
 * An ID is the flow's line prefix plus the start of the node's own id, so two
 * people adding lines on separate branches never produce the same ID. Once a
 * node has an ID it's stored on the node (`data.lineId`) and never changes when
 * the text is edited, the node moves or the flow is renamed.
 */
import { isChoiceEdge } from './choices'
import type { Flow, FlowEdge, FlowNode, Project } from './schema'

/** Words dropped from the front of a flow name when making its prefix. */
const ARTICLES = new Set(['THE', 'A', 'AN'])
const MAX_PREFIX = 16

/** "The Order" → "ORDER", "1 · The Plan" → "F1_PLAN": letters, digits and underscores, starting with a letter. */
export function defaultLinePrefix(flowName: string): string {
  const words = flowName
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
  while (words.length > 1 && ARTICLES.has(words[0])) words.shift()
  // A leading number with an article after it ("1 · The Plan"): drop the article too.
  if (words.length > 2 && /^[0-9]+$/.test(words[0]) && ARTICLES.has(words[1])) words.splice(1, 1)
  let prefix = words.join('_').slice(0, MAX_PREFIX).replace(/_+$/, '')
  if (!prefix) prefix = 'LINE'
  if (/^[0-9]/.test(prefix)) prefix = `F${prefix}`
  return prefix
}

/** Clean up a prefix a designer typed: upper case, letters, digits and underscores. */
export function cleanLinePrefix(raw: string): string {
  const p = raw
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_PREFIX)
  return p && /^[0-9]/.test(p) ? `F${p}` : p
}

export function linePrefixOf(flow: Pick<Flow, 'name'> & { linePrefix?: string }): string {
  return flow.linePrefix || defaultLinePrefix(flow.name)
}

/** The choice text's ID, for a line that has one. */
export function menuLineId(lineId: string): string {
  return `${lineId}_M`
}

export function isDialogue(node: FlowNode): boolean {
  return node.type === 'dialogue'
}

export function lineIdOf(node: FlowNode): string | null {
  const v = node.data.lineId
  return typeof v === 'string' && v ? v : null
}

/** A new ID for a node: prefix + the first 6 characters of its id, longer if that's taken. */
export function newLineId(prefix: string, nodeId: string, taken: ReadonlySet<string>): string {
  const tail = nodeId.toLowerCase().replace(/[^a-z0-9]/g, '') || '0'
  for (let n = Math.min(6, tail.length); n <= tail.length; n++) {
    const id = `${prefix}_${tail.slice(0, n)}`
    if (!taken.has(id)) return id
  }
  for (let i = 2; ; i++) {
    const id = `${prefix}_${tail}_${i}`
    if (!taken.has(id)) return id
  }
}

/** Every line ID in the project (lines and choices). */
export function lineIdsIn(project: Project): Set<string> {
  const ids = new Set<string>()
  for (const flow of Object.values(project.flows)) {
    for (const node of Object.values(flow.nodes)) {
      const id = lineIdOf(node)
      if (id) ids.add(id)
    }
    for (const edge of Object.values(flow.edges)) {
      const id = choiceLineIdOf(edge)
      if (id) ids.add(id)
    }
  }
  return ids
}

export function choiceLineIdOf(edge: FlowEdge): string | null {
  return typeof edge.choiceLineId === 'string' && edge.choiceLineId ? edge.choiceLineId : null
}

/**
 * A new ID for a choice's text: the target line's ID plus `_M` (as choice text
 * had before it moved onto connections), then `_M2`, `_M3`… for further choices into it.
 */
export function newChoiceLineId(flow: Flow, edge: FlowEdge, taken: ReadonlySet<string>): string {
  const target = flow.nodes[edge.target]
  const base = (target && lineIdOf(target)) || newLineId(linePrefixOf(flow), edge.id, taken)
  if (!taken.has(menuLineId(base))) return menuLineId(base)
  for (let i = 2; ; i++) {
    const id = `${menuLineId(base)}${i}`
    if (!taken.has(id)) return id
  }
}

/**
 * Give every choice with text an ID, and drop the ID of a choice without text.
 * Runs after assignLineIds, on load and after every edit. Deterministic: within a
 * flow, choices are taken by target, then source, then connection id, so the first
 * choice into a line keeps the line's `_M` ID from before choices moved.
 * Returns how many choices were given a new ID.
 */
export function assignChoiceLineIds(project: Project): number {
  const flows = Object.values(project.flows).sort((a, b) => (a.id < b.id ? -1 : 1))
  // Cheap check first: most edits leave every choice as it was.
  const needs = flows.some((flow) =>
    Object.values(flow.edges).some((e) => {
      const has = typeof e.choiceText === 'string' && e.choiceText !== ''
      return has !== Boolean(choiceLineIdOf(e)) && isChoiceEdge(flow, e)
    })
  )
  // A choice ID used twice (or by a line too) needs sorting out as well.
  const seen = new Set<string>()
  let duplicated = false
  for (const flow of flows) {
    for (const node of Object.values(flow.nodes)) {
      const id = lineIdOf(node)
      if (id) seen.add(id)
    }
    for (const e of Object.values(flow.edges)) {
      const id = choiceLineIdOf(e)
      if (!id) continue
      if (seen.has(id)) duplicated = true
      seen.add(id)
    }
  }
  if (!needs && !duplicated) return 0

  const taken = new Set<string>()
  for (const flow of flows) for (const node of Object.values(flow.nodes)) {
    const id = lineIdOf(node)
    if (id) taken.add(id)
  }
  let assigned = 0
  for (const flow of flows) {
    const choices = Object.values(flow.edges)
      .filter((e) => isChoiceEdge(flow, e))
      .sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : a.source < b.source ? -1 : a.source > b.source ? 1 : a.id < b.id ? -1 : 1))
    for (const edge of choices) {
      const id = choiceLineIdOf(edge)
      if (typeof edge.choiceText !== 'string' || edge.choiceText === '') {
        if (id) delete edge.choiceLineId
        continue
      }
      if (id && !taken.has(id)) {
        taken.add(id)
        continue
      }
      const next = newChoiceLineId(flow, edge, taken)
      edge.choiceLineId = next
      taken.add(next)
      assigned++
    }
  }
  return assigned
}

/**
 * Give an ID to every dialogue line that has none, and a new one to any line
 * whose ID another line already uses (which only a hand edit or an unusual
 * merge can cause). Works in place (on Immer drafts too). Deterministic: flows
 * and nodes are visited in id order, so the same project always gets the same IDs.
 * Returns the lines whose ID was a duplicate, for the repair report.
 */
export function assignLineIds(project: Project): { assigned: number; duplicates: { flow: string; lineId: string }[] } {
  const taken = new Set<string>()
  const missing: { flow: Flow; node: FlowNode }[] = []
  const duplicates: { flow: string; lineId: string }[] = []
  const flows = Object.values(project.flows).sort((a, b) => (a.id < b.id ? -1 : 1))
  for (const flow of flows) {
    for (const node of Object.values(flow.nodes).sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (!isDialogue(node)) continue
      const id = lineIdOf(node)
      if (!id) missing.push({ flow, node })
      else if (taken.has(id)) {
        duplicates.push({ flow: flow.name, lineId: id })
        missing.push({ flow, node })
      } else taken.add(id)
    }
  }
  for (const { flow, node } of missing) {
    const id = newLineId(linePrefixOf(flow), node.id, taken)
    node.data.lineId = id
    taken.add(id)
  }
  return { assigned: missing.length, duplicates }
}

/** Give one node its line ID (after adding or duplicating it). */
export function assignLineId(project: Project, flow: Flow, node: FlowNode): void {
  if (!isDialogue(node)) return
  delete node.data.lineId
  const taken = lineIdsIn(project)
  node.data.lineId = newLineId(linePrefixOf(flow), node.id, taken)
}

/**
 * Re-prefix every line in a flow (after its prefix changed). Lines keep the
 * rest of their ID. Returns how many changed: recorded voice lines may need renaming.
 */
export function reprefixLines(project: Project, flow: Flow): number {
  const prefix = linePrefixOf(flow)
  const taken = lineIdsIn(project)
  let changed = 0
  for (const node of Object.values(flow.nodes).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const id = lineIdOf(node)
    if (!id || !isDialogue(node)) continue
    taken.delete(id)
    const next = newLineId(prefix, node.id, taken)
    if (next === id) {
      taken.add(id)
      continue
    }
    node.data.lineId = next
    taken.add(next)
    changed++
  }
  return changed
}
