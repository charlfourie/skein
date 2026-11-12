/**
 * Pasting a scene written elsewhere (a document, a chat, a screenplay) as lines.
 *
 * Understood, one per line:
 *
 *   PIP: Morning! What can I get you?      a line, by a speaker
 *   PIP                                    a speaker on their own line (screenplay
 *   Morning! What can I get you?           style), followed by what they say
 *   (wiping the counter)                   a stage direction: kept as a note
 *   > A flat white, please.                a choice; several in a row make a menu
 *   > YOU: Just water.                     a choice with a speaker
 *   The café is quiet.                     after a blank line: narration
 *
 * Text straight after a line (no blank line between) carries on that line.
 * All choices of a menu lead on to whatever comes after the menu. A choice
 * with no name is spoken by whoever usually picks choices (see usualChooser).
 */
import type { Size } from './frames'
import { assignLineId } from './lineIds'
import { INPUT_HANDLE, outputHandles } from './nodes'
import { createEntity } from './factory'
import { nextEdgeOrder, outgoingEdges } from './flowOrder'
import { freeSpot } from './quickEntry'
import type { Flow, Position, Project } from './schema'
import { toTechnicalName, uniqueTechnicalName } from './technicalName'

export interface ScreenplayLine {
  /** The speaker as written, or null for narration. */
  name: string | null
  text: string
  /** Stage directions written with it. */
  direction?: string
  /** Part of a choice menu. */
  choice: boolean
}

/** NAME: text, the name at most four words (so most prose with a colon isn't taken for a line). */
const NAMED = /^([\p{L}\p{N}][\p{L}\p{N}.'’_-]*(?: [\p{L}\p{N}.'’_-]+){0,3})\s*(?:\(([^)]*)\))?\s*:\s*(.+)$/u
/** A screenplay cue: a name in capitals on its own (optionally with (V.O.) and the like). */
const CUE = /^([\p{Lu}\p{N}][\p{Lu}\p{N} .'’_-]{0,39}?)\s*(?:\(([^)]*)\))?$/u
const PAREN = /^\((.+)\)$/

/** Read pasted text as a scene. Null when it doesn't look like one (no line has a speaker). */
export function parseScreenplay(text: string): ScreenplayLine[] | null {
  const raw = text.replace(/\r\n?/g, '\n').split('\n')
  const lines: ScreenplayLine[] = []
  let current = null as ScreenplayLine | null // a line that following text continues (set inside push, so not narrowed)
  let cue: { name: string; direction?: string } | null = null // a name waiting for its text
  let directions: string[] = []
  let named = 0

  const push = (line: ScreenplayLine) => {
    if (directions.length) line.direction = [line.direction, ...directions].filter(Boolean).join('; ')
    directions = []
    lines.push(line)
    current = line
  }

  for (let i = 0; i < raw.length; i++) {
    const t = raw[i].trim()
    if (!t) {
      current = null
      if (cue) cue = null // a cue with nothing under it isn't a line
      continue
    }
    const paren = PAREN.exec(t)
    if (paren) {
      if (current && !cue) current.direction = [current.direction, paren[1].trim()].filter(Boolean).join('; ')
      else directions.push(paren[1].trim())
      continue
    }
    if (t.startsWith('>')) {
      const body = t.slice(1).trim()
      if (!body) continue
      const m = NAMED.exec(body)
      if (m) named++
      push({ name: m ? m[1].trim() : null, text: m ? m[3].trim() : body, choice: true, direction: m?.[2]?.trim() || undefined })
      cue = null
      continue
    }
    if (cue) {
      push({ name: cue.name, text: t, choice: false, direction: cue.direction })
      named++
      cue = null
      continue
    }
    const m = NAMED.exec(t)
    // "Note: …" inside prose is rare; a known-looking name with a colon is a line.
    if (m && !/^https?$/i.test(m[1])) {
      named++
      push({ name: m[1].trim(), text: m[3].trim(), choice: false, direction: m[2]?.trim() || undefined })
      continue
    }
    const c = CUE.exec(t)
    const nextLine = raw[i + 1]?.trim() ?? ''
    if (c && /\p{Lu}/u.test(c[1]) && c[1] === c[1].toUpperCase() && nextLine && !CUE.test(nextLine)) {
      cue = { name: c[1].trim(), direction: c[2]?.trim() || undefined }
      current = null
      continue
    }
    if (current && !current.choice) current.text = `${current.text} ${t}`
    else push({ name: null, text: t, choice: false })
  }
  return named > 0 ? lines : null
}

/** The distinct speaker names, in the order they first appear. */
export function screenplayNames(lines: readonly ScreenplayLine[]): string[] {
  return [...new Set(lines.map((l) => l.name).filter((n): n is string => n !== null))]
}

/** Who a written name most likely is: an entity whose name or technical name matches, ignoring case and spaces. */
export function matchSpeaker(project: Project, name: string): string | null {
  const key = (s: string) => s.toLowerCase().replace(/[\s_'’.-]/g, '')
  const k = key(name)
  const entities = Object.values(project.entities)
  const exact = entities.find((e) => key(e.name) === k || key(e.technicalName) === k)
  if (exact) return exact.id
  // "PIP" for "Pip the Barista": a single entity whose name starts with the word.
  const starts = entities.filter((e) => key(e.name.split(/\s+/)[0] ?? '') === k)
  return starts.length === 1 ? starts[0].id : null
}

/** The name a new character gets: screenplay capitals read as a name ("OLD TOM" → "Old Tom"). */
export function characterName(written: string): string {
  return written === written.toUpperCase() && /\p{Lu}/u.test(written) ? written.toLowerCase().replace(/(^|[\s'’-])\p{L}/gu, (m) => m.toUpperCase()) : written
}

/**
 * Who usually picks the choices in this flow (then the project): the speaker
 * of most lines offered as choices. A pasted choice with no name gets them.
 */
export function usualChooser(project: Project, flowId: string): string | null {
  const count = (flows: Flow[]) => {
    const tally = new Map<string, number>()
    for (const f of flows)
      for (const n of Object.values(f.nodes)) {
        const outs = outputHandles(n.type).flatMap((h) => outgoingEdges(f, n.id, h))
        if (outs.length < 2 || (n.type !== 'dialogue' && n.type !== 'hub')) continue
        for (const e of outs) {
          const s = f.nodes[e.target]?.data.speakerId
          if (typeof s === 'string' && project.entities[s]) tally.set(s, (tally.get(s) ?? 0) + 1)
        }
      }
    return [...tally].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null
  }
  const flow = project.flows[flowId]
  return (flow && count([flow])) ?? count(Object.values(project.flows))
}

/** For each written name: an entity id, `new` (create a character), or null (narration, no speaker). */
export type SpeakerChoice = string | 'new' | null

export interface ScreenplayResult {
  nodeIds: string[]
  newEntityIds: string[]
  notes: string[]
}

const W = 260
const H = 110
const GAP_X = 40
const GAP_Y = 56

/**
 * Add the scene to a flow (works on an Immer draft). Lines are stacked below
 * one another from `at` (moved down until they overlap nothing), a menu's
 * choices side by side. With `after`, the first line follows that node when
 * it has nothing after it yet.
 */
export function addScreenplay(
  project: Project,
  flowId: string,
  lines: readonly ScreenplayLine[],
  speakers: Record<string, SpeakerChoice>,
  options: { at: Position; after?: string | null; newId: () => string; chooser?: string | null }
): ScreenplayResult {
  const flow = project.flows[flowId] as Flow | undefined
  const result: ScreenplayResult = { nodeIds: [], newEntityIds: [], notes: [] }
  if (!flow || !lines.length) return result

  // New characters: with the template most speakers already use.
  const ids: Record<string, string | null> = {}
  const usage = new Map<string, number>()
  for (const f of Object.values(project.flows))
    for (const n of Object.values(f.nodes)) {
      const e = typeof n.data.speakerId === 'string' ? project.entities[n.data.speakerId] : undefined
      if (e) usage.set(e.templateId, (usage.get(e.templateId) ?? 0) + 1)
    }
  const template =
    [...usage].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    Object.values(project.templates).find((t) => /character|person|npc/i.test(t.name))?.id ??
    Object.values(project.templates)[0]?.id
  for (const [name, choice] of Object.entries(speakers)) {
    if (choice !== 'new') {
      ids[name] = choice && project.entities[choice] ? choice : null
      continue
    }
    if (!template) {
      ids[name] = null
      result.notes.push(`There's no template to make “${name}” from, so their lines have no speaker.`)
      continue
    }
    const all = Object.values(project.entities)
    const id = options.newId()
    const order = all.filter((e) => e.folderId === null).reduce((m, e) => Math.max(m, e.order), -1) + 1
    const display = characterName(name)
    const technical = uniqueTechnicalName(toTechnicalName(display) || 'Character', all.map((e) => e.technicalName))
    project.entities[id] = createEntity(id, display, technical, template, null, order)
    ids[name] = id
    result.newEntityIds.push(id)
  }

  // Rows: a plain line on its own, or a menu of choices side by side.
  const rows: ScreenplayLine[][] = []
  for (const line of lines) {
    const last = rows[rows.length - 1]
    if (line.choice && last?.[0].choice) last.push(line)
    else rows.push([line])
  }
  const width = Math.max(...rows.map((r) => r.length)) * (W + GAP_X) - GAP_X
  const height = rows.length * (H + GAP_Y) - GAP_Y
  const origin = freeSpot(flow, options.at, { width, height } satisfies Size, 'down')

  let previous: string[] = []
  const after = options.after && flow.nodes[options.after] ? options.after : null
  if (after) {
    const handle = outputHandles(flow.nodes[after].type)[0]
    if (handle && !outgoingEdges(flow, after, handle).length) previous = [after]
    else result.notes.push('The selected node already leads somewhere, so the pasted lines aren’t connected to it.')
  }
  const connect = (source: string, target: string) => {
    const handle = outputHandles(flow.nodes[source].type)[0]
    if (!handle) return
    const id = options.newId()
    flow.edges[id] = { id, source, sourceHandle: handle, target, targetHandle: INPUT_HANDLE, order: nextEdgeOrder(flow, source, handle) }
  }

  rows.forEach((row, r) => {
    const made = row.map((line, c) => {
      const id = options.newId()
      const data: Record<string, unknown> = {}
      const speaker = line.name ? ids[line.name] : line.choice && options.chooser && project.entities[options.chooser] ? options.chooser : null
      if (speaker) data.speakerId = speaker
      if (line.text) data.text = line.text
      if (line.direction) data.note = `Direction: ${line.direction}`
      flow.nodes[id] = { id, type: 'dialogue', position: { x: origin.x + c * (W + GAP_X), y: origin.y + r * (H + GAP_Y) }, data }
      assignLineId(project, flow, flow.nodes[id])
      for (const p of previous) connect(p, id)
      result.nodeIds.push(id)
      return id
    })
    previous = made
  })
  return result
}
