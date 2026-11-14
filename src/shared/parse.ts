import { assignLineIds } from './lineIds'
import type { z } from 'zod'
import { createDefaultState } from './factory'
import { normalizeOrders } from './flowOrder'
import { structuralValueProblem } from './values'
import {
  PROJECT_FORMAT,
  ProjectSchema,
  SCHEMA_VERSION,
  SECTION_IDS,
  type CollectionId,
  type Project,
  type TreeItem
} from './schema'

export type ParseResult =
  | { ok: true; project: Project; repairs: string[] }
  | { ok: false; error: string }

/**
 * Migrations from version N to N+1, applied in sequence on load.
 * Add an entry here whenever SCHEMA_VERSION is bumped.
 */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 → v2: templates and entities gained real structure (properties, values,
  // technical names). v1 builds couldn't create either, so the schema's
  // defaults fill in everything; nothing needs rewriting.
  1: (raw) => raw,
  // v2 → v3: flows became editable. Connections now name their handles
  // ("out", "true"/"false" on conditions, "in"), and condition nodes keep their
  // logic in `expression` rather than `text`.
  2: migrateV2toV3,
  // v3 → v4: state. The placeholder `variables` section becomes `state`
  // (world variables, relationships, time, rules), and the theatre-style
  // "stage directions" on dialogue lines fold into the designer note.
  3: migrateV3toV4,
  // v4 → v5: choice order and start-node priority become explicit
  // (`edge.order`, `node.data.startOrder`) instead of following canvas
  // positions, so moving nodes can no longer reorder a player's choices.
  // The order each flow plays in today is what gets stored.
  4: migrateV4toV5,
  // v5 → v6: saved scenarios and story tests (optional `scenarios` and `tests`
  // sections). Older files have neither, so nothing needs rewriting.
  5: (raw) => raw,
  // v6 → v7: line IDs on dialogue lines (`data.lineId`), line prefixes and
  // comments on flows, and projects that can be a folder with one file per
  // flow. Line IDs are given to every line after loading (see assignLineIds).
  6: (raw) => raw,
  // v7 → v8: hubs gain a second output, "fallback" ("When nothing's left"),
  // followed when none of their choices is available. Older files have no
  // fallback connections, so nothing needs rewriting.
  7: (raw) => raw
}

function migrateV4toV5(raw: Record<string, unknown>): Record<string, unknown> {
  const flows = isPlainObject(raw.flows) ? raw.flows : {}
  for (const flow of Object.values(flows)) {
    if (!isPlainObject(flow)) continue
    // Order only the well-formed entries (same objects, so the order lands in
    // the file); anything malformed is left for validation and repair to report.
    const nodes: Record<string, { id: string; position?: { x: number; y: number }; data?: Record<string, unknown> }> = {}
    const edges: Record<string, { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; order?: number }> = {}
    if (isPlainObject(flow.nodes)) {
      for (const [id, n] of Object.entries(flow.nodes)) {
        if (isPlainObject(n) && isPlainObject(n.data)) nodes[id] = n as unknown as (typeof nodes)[string]
      }
    }
    if (isPlainObject(flow.edges)) {
      for (const [id, e] of Object.entries(flow.edges)) {
        if (isPlainObject(e) && typeof e.id === 'string' && typeof e.source === 'string' && typeof e.target === 'string') {
          edges[id] = e as unknown as (typeof edges)[string]
        }
      }
    }
    normalizeOrders({ nodes, edges })
  }
  return raw
}

function migrateV3toV4(raw: Record<string, unknown>): Record<string, unknown> {
  delete raw.variables
  if (isPlainObject(raw.folders)) {
    for (const [id, folder] of Object.entries(raw.folders)) {
      if (isPlainObject(folder) && folder.section === 'variables') delete raw.folders[id]
    }
  }
  if (!isPlainObject(raw.state)) raw.state = createDefaultState()
  const flows = isPlainObject(raw.flows) ? raw.flows : {}
  for (const flow of Object.values(flows)) {
    if (!isPlainObject(flow) || !isPlainObject(flow.nodes)) continue
    for (const node of Object.values(flow.nodes)) {
      if (!isPlainObject(node) || !isPlainObject(node.data)) continue
      const sd = node.data.stageDirections
      if (typeof sd === 'string' && sd.trim()) {
        const note = typeof node.data.note === 'string' && node.data.note.trim() ? `${node.data.note}\n` : ''
        node.data.note = `${note}Direction: ${sd}`
      }
      delete node.data.stageDirections
    }
  }
  return raw
}

function migrateV2toV3(raw: Record<string, unknown>): Record<string, unknown> {
  const flows = isPlainObject(raw.flows) ? raw.flows : {}
  for (const flow of Object.values(flows)) {
    if (!isPlainObject(flow)) continue
    const nodes = isPlainObject(flow.nodes) ? flow.nodes : {}
    const edges = isPlainObject(flow.edges) ? flow.edges : {}
    for (const node of Object.values(nodes)) {
      if (!isPlainObject(node) || node.type !== 'condition' || !isPlainObject(node.data)) continue
      if (typeof node.data.text === 'string' && node.data.expression === undefined) {
        node.data.expression = node.data.text
        delete node.data.text
      }
    }
    // Condition edges without a handle: the leftmost target becomes "true".
    const conditionEdges = new Map<string, Record<string, unknown>[]>()
    for (const edge of Object.values(edges)) {
      if (!isPlainObject(edge)) continue
      if (edge.targetHandle === null || edge.targetHandle === undefined) edge.targetHandle = 'in'
      if (edge.sourceHandle !== null && edge.sourceHandle !== undefined) continue
      const source = nodes[edge.source as string]
      if (isPlainObject(source) && source.type === 'condition') {
        const list = conditionEdges.get(edge.source as string) ?? []
        list.push(edge)
        conditionEdges.set(edge.source as string, list)
      } else {
        edge.sourceHandle = 'out'
      }
    }
    const x = (id: unknown) => {
      const n = nodes[id as string]
      const pos = isPlainObject(n) && isPlainObject(n.position) ? n.position : {}
      return typeof pos.x === 'number' ? pos.x : 0
    }
    for (const list of conditionEdges.values()) {
      list.sort((a, b) => x(a.target) - x(b.target) || String(a.id).localeCompare(String(b.id)))
      list.forEach((edge, i) => (edge.sourceHandle = i === 0 ? 'true' : 'false'))
    }
  }
  return raw
}

/**
 * Parse, migrate, validate and repair a project file.
 *
 * Failure modes are reported as plain-language messages because the most common
 * cause is a hand-merged file (git conflict markers, a stray comma after editing
 * in a text editor), and the person needs to know exactly where to look.
 */
export function parseProject(input: string): ParseResult {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input

  const conflictLine = findConflictMarker(text)
  if (conflictLine !== null) {
    return {
      ok: false,
      error:
        `This file contains unresolved merge-conflict markers (first one on line ${conflictLine}). ` +
        'Resolve the conflict in your merge tool or text editor, then open the file again.'
    }
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return { ok: false, error: describeJsonError(text, err) }
  }

  return parseRaw(raw)
}

/**
 * Migrate, validate and repair an already-parsed project object (from one file,
 * or assembled from a project folder). `repairs` starts with any problems found
 * while assembling it.
 */
export function parseRaw(raw: unknown, earlier: string[] = []): ParseResult {
  const migrated = migrate(raw)
  if (!migrated.ok) return migrated

  const parsed = ProjectSchema.safeParse(migrated.value)
  if (!parsed.success) return { ok: false, error: formatZodError(parsed.error) }

  const project = parsed.data
  const repairs = [...earlier, ...repairIntegrity(project)]
  // Lines without an ID (older files, lines added by hand) get one silently; a
  // duplicate ID is a real problem, so it's reported.
  const { duplicates } = assignLineIds(project)
  for (const d of duplicates) repairs.push(`Flow "${d.flow}": two lines shared the line ID ${d.lineId}; one got a new ID.`)
  return { ok: true, project, repairs }
}

// ---------------------------------------------------------------------------

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function findConflictMarker(text: string): number | null {
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (/^(?:<{7}|={7}|>{7}|\|{7})(?:\s|$)/.test(lines[i])) return i + 1
  }
  return null
}

function lineCol(text: string, position: number): { line: number; column: number } {
  let line = 1
  let lastBreak = -1
  for (let i = 0; i < position && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++
      lastBreak = i
    }
  }
  return { line, column: position - lastBreak }
}

export function describeJsonError(text: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const pos = /position (\d+)/.exec(msg)
  if (pos && !/line \d+/.test(msg)) {
    const { line, column } = lineCol(text, Number(pos[1]))
    return `The file is not valid JSON (line ${line}, column ${column}): ${msg}`
  }
  return `The file is not valid JSON: ${msg}`
}

function migrate(raw: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!isPlainObject(raw) || raw.format !== PROJECT_FORMAT) {
    return { ok: false, error: "This JSON file isn't a Skein project (missing \"format\": \"skein.project\")." }
  }
  let version = raw.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: 'The project file has a missing or invalid "schemaVersion".' }
  }
  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      error:
        `This project was saved by a newer version of Skein (format v${version}; this build reads up to v${SCHEMA_VERSION}). ` +
        'Update Skein to open it.'
    }
  }
  let value = raw
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version]
    if (!step) return { ok: false, error: `No migration available from format v${version}.` }
    value = step(value)
    version++
    value.schemaVersion = version
  }
  return { ok: true, value }
}

function formatZodError(err: z.ZodError): string {
  const shown = err.issues.slice(0, 6).map((issue) => {
    const where = issue.path.length ? issue.path.join('.') : '(root)'
    return `• ${where}: ${issue.message}`
  })
  const more = err.issues.length > shown.length ? `\n…and ${err.issues.length - shown.length} more` : ''
  return `The project file has an invalid structure:\n${shown.join('\n')}${more}`
}

/**
 * Fix referential problems that a manual merge can introduce, and report each
 * fix. The project is still loaded; the caller marks it dirty so the repaired
 * version gets saved.
 */
export function repairIntegrity(project: Project): string[] {
  const repairs: string[] = []

  // 1. Dictionary key must equal the entry's own id.
  const collections: CollectionId[] = ['folders', ...SECTION_IDS]
  for (const col of collections) {
    for (const [key, entry] of Object.entries(project[col] as Record<string, { id: string }>)) {
      if (entry.id !== key) {
        repairs.push(`${col}: entry "${key}" had a mismatched id ("${entry.id}"); reset to its key.`)
        entry.id = key
      }
    }
  }
  for (const flow of Object.values(project.flows)) {
    for (const [key, node] of Object.entries(flow.nodes)) {
      if (node.id !== key) {
        repairs.push(`Flow "${flow.name}": node "${key}" had a mismatched id; reset to its key.`)
        node.id = key
      }
    }
    for (const [key, edge] of Object.entries(flow.edges)) {
      if (edge.id !== key) {
        repairs.push(`Flow "${flow.name}": connection "${key}" had a mismatched id; reset to its key.`)
        edge.id = key
      }
    }
  }

  // 2. Folder parents must exist and belong to the same section.
  const folders = project.folders
  for (const folder of Object.values(folders)) {
    if (folder.parentId === null) continue
    const parent = folders[folder.parentId]
    if (!parent || parent.section !== folder.section) {
      repairs.push(`Folder "${folder.name}" pointed at a missing parent folder; moved to the top level.`)
      folder.parentId = null
    }
  }

  // 3. Break folder cycles (a → b → a), which a bad merge can create.
  for (const folder of Object.values(folders)) {
    const seen = new Set<string>([folder.id])
    let cur = folder.parentId
    while (cur !== null) {
      if (cur === folder.id) {
        repairs.push(`Folder "${folder.name}" was inside itself (a folder loop); moved to the top level.`)
        folder.parentId = null
        break
      }
      if (seen.has(cur)) break // a loop elsewhere; fixed when we reach one of its members
      seen.add(cur)
      cur = folders[cur]?.parentId ?? null
    }
  }

  // 4. Items must point at an existing folder of their own section.
  for (const section of SECTION_IDS) {
    for (const item of Object.values(project[section]) as TreeItem[]) {
      if (item.folderId === null) continue
      const folder = folders[item.folderId]
      if (!folder || folder.section !== section) {
        repairs.push(`"${item.name}" pointed at a missing folder; moved to the top of ${section}.`)
        item.folderId = null
      }
    }
  }

  // 5. Connections must reference nodes that exist in the same flow.
  for (const flow of Object.values(project.flows)) {
    for (const [key, edge] of Object.entries(flow.edges)) {
      if (!flow.nodes[edge.source] || !flow.nodes[edge.target]) {
        repairs.push(`Flow "${flow.name}": removed a connection to a node that no longer exists.`)
        delete flow.edges[key]
      }
    }
  }

  // 6. Template internals: property/option keys, dangling reference filters, broken defaults.
  for (const template of Object.values(project.templates)) {
    for (const [key, prop] of Object.entries(template.properties)) {
      if (prop.id !== key) {
        repairs.push(`Template "${template.name}": property "${key}" had a mismatched id; reset to its key.`)
        prop.id = key
      }
      for (const [optionKey, option] of Object.entries(prop.options ?? {})) {
        if (option.id !== optionKey) {
          repairs.push(`Template "${template.name}": an option of "${prop.name}" had a mismatched id; reset to its key.`)
          option.id = optionKey
        }
      }
      if (prop.referenceTemplateId && !project.templates[prop.referenceTemplateId]) {
        repairs.push(
          `Template "${template.name}": "${prop.name}" was limited to a template that no longer exists; it now accepts any entity.`
        )
        prop.referenceTemplateId = null
      }
      if (prop.defaultValue !== undefined) {
        const problem = structuralValueProblem(project, prop, prop.defaultValue)
        if (problem) {
          repairs.push(`Template "${template.name}": cleared the default of "${prop.name}" (${problem}).`)
          delete prop.defaultValue
        }
      }
    }
  }

  // 7. Entity values must fit their template's properties. (An entity whose
  //    template is missing is left untouched and flagged by validation.)
  for (const entity of Object.values(project.entities)) {
    const template = project.templates[entity.templateId]
    if (!template) continue
    for (const [propertyId, value] of Object.entries(entity.values)) {
      const prop = template.properties[propertyId]
      const problem = prop ? structuralValueProblem(project, prop, value) : 'its template no longer has that property'
      if (problem) {
        repairs.push(`Entity "${entity.name}": removed a value${prop ? ` for "${prop.name}"` : ''} (${problem}).`)
        delete entity.values[propertyId]
      }
    }
  }

  // 8. State: relationship endpoints, starting values, rule and time references.
  const state = project.state
  for (const rel of Object.values(state.relationships)) {
    if (!project.templates[rel.fromTemplateId] || !project.templates[rel.toTemplateId]) {
      repairs.push(`Relationship "${rel.name}" connected a template that no longer exists; removed.`)
      delete state.relationships[rel.id]
    }
  }
  for (const entity of Object.values(project.entities)) {
    if (!entity.relations) continue
    for (const [relId, targets] of Object.entries(entity.relations)) {
      const rel = state.relationships[relId]
      for (const [targetId, value] of Object.entries(targets)) {
        const target = project.entities[targetId]
        const problem = !rel
          ? 'its relationship no longer exists'
          : !target
            ? 'the other entity no longer exists'
            : structuralValueProblem(project, rel, value)
        if (problem) {
          repairs.push(`Entity "${entity.name}": removed a relationship value (${problem}).`)
          delete targets[targetId]
        }
      }
      if (Object.keys(targets).length === 0) delete entity.relations[relId]
    }
    if (Object.keys(entity.relations).length === 0) delete entity.relations
  }
  for (const rule of Object.values(state.rules)) {
    if (rule.forEachTemplateId && !project.templates[rule.forEachTemplateId]) {
      repairs.push(`Rule "${rule.name}" ran for a template that no longer exists; it now runs once.`)
      rule.forEachTemplateId = null
    }
    if (rule.phaseId && !state.time.phases[rule.phaseId]) {
      repairs.push(`Rule "${rule.name}" referred to a time phase that no longer exists; it now runs every phase.`)
      rule.phaseId = null
    }
  }
  if (state.time.startPhaseId && !state.time.phases[state.time.startPhaseId]) {
    repairs.push('The starting time phase no longer exists; reset to the first phase.')
    state.time.startPhaseId = Object.values(state.time.phases).sort((a, b) => a.order - b.order)[0]?.id ?? null
  }

  // 9. Flow node references: speakers and jump targets that no longer exist.
  for (const flow of Object.values(project.flows)) {
    for (const node of Object.values(flow.nodes)) {
      const speaker = node.data.speakerId
      if (typeof speaker === 'string' && !project.entities[speaker]) {
        repairs.push(`Flow "${flow.name}": a line's speaker no longer exists; cleared.`)
        delete node.data.speakerId
      }
      const target = node.data.targetId
      if (node.type === 'jump' && typeof target === 'string' && !flow.nodes[target]) {
        repairs.push(`Flow "${flow.name}": a jump pointed at a node that no longer exists; cleared.`)
        delete node.data.targetId
      }
    }
  }

  // 9b. Comments on nodes that no longer exist, and replies to missing threads.
  for (const flow of Object.values(project.flows)) {
    let removed = 0
    for (let again = true; again; ) {
      again = false
      for (const [key, c] of Object.entries(flow.comments ?? {})) {
        if (c.id !== key) c.id = key
        const orphan = !flow.nodes[c.nodeId] || (c.parentId !== undefined && !flow.comments?.[c.parentId])
        if (!orphan) continue
        delete flow.comments![key]
        removed++
        again = true
      }
    }
    if (removed) repairs.push(`Flow "${flow.name}": removed ${removed} comment${removed === 1 ? '' : 's'} on nodes that no longer exist.`)
    if (flow.comments && Object.keys(flow.comments).length === 0) delete flow.comments
  }

  // 10. Scenarios and story tests (v6). Tests that point at a flow, node or
  //     scenario that's gone are left alone: the test runner reports them, so
  //     nobody loses a test without being told.
  for (const [key, sc] of Object.entries(project.scenarios ?? {})) {
    if (sc.id !== key) {
      repairs.push(`Scenario "${sc.name}" had a mismatched id; reset to its key.`)
      sc.id = key
    }
    if (sc.phaseId && !state.time.phases[sc.phaseId]) {
      repairs.push(`Scenario "${sc.name}" started in a time phase that no longer exists; it now starts in the project's start phase.`)
      delete sc.phaseId
    }
  }
  for (const [key, t] of Object.entries(project.tests ?? {})) {
    if (t.id !== key) {
      repairs.push(`Test "${t.name}" had a mismatched id; reset to its key.`)
      t.id = key
    }
  }

  return repairs
}
