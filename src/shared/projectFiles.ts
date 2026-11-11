/**
 * Project folders: one file per flow.
 *
 *   My Story.skein/
 *     project.json                      everything except flows (and their tests)
 *     flows/
 *       the-order.3f9a2c.json           one flow, plus the story tests for it
 *
 * Two people editing different flows never touch the same file, and a flow's
 * tests travel with it. A flow's file name is its name plus the start of its
 * id, so renaming a flow is a rename in git (and two flows with the same name
 * never clash). Every file is written by the same canonical serializer as a
 * single-file project, so saving an unchanged project changes nothing.
 *
 * In memory a folder project is the same Project as a single file: only
 * saving and loading know the difference.
 */
import { describeJsonError, findConflictMarker, isPlainObject, parseRaw, type ParseResult } from './parse'
import type { Flow, Project, StoryTest } from './schema'
import { serializeCanonical } from './serialize'

export const PROJECT_FILE = 'project.json'
export const FLOWS_DIR = 'flows'
/** Folder projects are named "<Project>.skein". */
export const FOLDER_SUFFIX = '.skein'
export const FLOW_FORMAT = 'skein.flow'

/** Relative path (always with `/`) → file contents. */
export type ProjectFiles = Record<string, string>

/** A project path is a folder project when it points at a project.json. */
export function isFolderProjectPath(path: string): boolean {
  return /(^|[\\/])project\.json$/i.test(path)
}

/** "The Order" + "3f9a2c71-…" → "the-order.3f9a2c.json" */
export function flowFileName(flow: Pick<Flow, 'id' | 'name'>): string {
  const slug =
    flow.name
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/, '') || 'flow'
  const id = flow.id.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) || 'x'
  return `${slug}.${id}.json`
}

/** The files a project is saved as, keyed by relative path. */
export function splitProject(project: Project): ProjectFiles {
  const files: ProjectFiles = {}
  const testsByFlow = new Map<string, Record<string, StoryTest>>()
  const leftover: Record<string, StoryTest> = {}
  for (const t of Object.values(project.tests ?? {})) {
    if (project.flows[t.flowId]) testsByFlow.set(t.flowId, { ...(testsByFlow.get(t.flowId) ?? {}), [t.id]: t })
    else leftover[t.id] = t // a test of a missing flow stays visible (the runner reports it)
  }

  const used = new Set<string>()
  for (const flow of Object.values(project.flows).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    let name = flowFileName(flow)
    // Two flows whose names and id starts match (only possible with hand-made ids): keep both.
    for (let i = 2; used.has(name); i++) name = flowFileName({ ...flow, name: `${flow.name} ${i}` })
    used.add(name)
    const tests = testsByFlow.get(flow.id)
    files[`${FLOWS_DIR}/${name}`] = serializeCanonical({ format: FLOW_FORMAT, ...flow, ...(tests ? { tests } : {}) })
  }

  const { flows: _flows, tests: _tests, ...rest } = project
  files[PROJECT_FILE] = serializeCanonical({ ...rest, ...(Object.keys(leftover).length ? { tests: leftover } : {}) })
  return files
}

/**
 * Load a project folder: check every file (merge-conflict markers and JSON
 * errors are reported with the file's name), put the project back together,
 * then migrate, validate and repair it like a single file.
 */
export function parseProjectFiles(files: ProjectFiles): ParseResult {
  const main = files[PROJECT_FILE]
  if (main === undefined) return { ok: false, error: `This folder has no ${PROJECT_FILE}, so it isn't a Skein project.` }

  const read = (path: string): { ok: true; value: unknown } | { ok: false; error: string } => {
    const raw = files[path]
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
    const conflict = findConflictMarker(text)
    if (conflict !== null) {
      return {
        ok: false,
        error: `${path} contains unresolved merge-conflict markers (first one on line ${conflict}). Resolve the conflict in your merge tool or text editor, then open the project again.`
      }
    }
    try {
      return { ok: true, value: JSON.parse(text) }
    } catch (err) {
      return { ok: false, error: `${path}: ${describeJsonError(text, err)}` }
    }
  }

  const head = read(PROJECT_FILE)
  if (!head.ok) return head
  if (!isPlainObject(head.value)) return { ok: false, error: `${PROJECT_FILE} isn't a Skein project.` }
  const raw: Record<string, unknown> = { ...head.value }
  const flows: Record<string, unknown> = {}
  const tests: Record<string, unknown> = isPlainObject(raw.tests) ? { ...raw.tests } : {}
  const repairs: string[] = []

  const flowPaths = Object.keys(files)
    .filter((p) => p.startsWith(`${FLOWS_DIR}/`) && p.toLowerCase().endsWith('.json'))
    .sort()
  for (const path of flowPaths) {
    const r = read(path)
    if (!r.ok) return r
    if (!isPlainObject(r.value) || typeof r.value.id !== 'string' || (r.value.format !== undefined && r.value.format !== FLOW_FORMAT)) {
      return { ok: false, error: `${path} isn't a Skein flow. Move it out of the flows folder, or fix it, then open the project again.` }
    }
    const { format: _format, tests: flowTests, ...flow } = r.value
    if (flows[flow.id as string]) {
      repairs.push(`${path} is a second copy of a flow that's already in the project; it was left out. Delete the file once you've checked it.`)
      continue
    }
    flows[flow.id as string] = flow
    if (isPlainObject(flowTests)) Object.assign(tests, flowTests)
  }

  raw.flows = flows
  if (Object.keys(tests).length) raw.tests = tests
  else delete raw.tests
  return parseRaw(raw, repairs)
}

/** Which files to write and which old flow files to delete, given what's on disk now. */
export function planWrite(next: ProjectFiles, existing: ProjectFiles): { write: ProjectFiles; remove: string[] } {
  const write: ProjectFiles = {}
  for (const [path, text] of Object.entries(next)) if (existing[path] !== text) write[path] = text
  const remove = Object.keys(existing).filter((p) => p.startsWith(`${FLOWS_DIR}/`) && p.toLowerCase().endsWith('.json') && !(p in next))
  return { write, remove }
}
