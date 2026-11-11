import { produce, type Draft } from 'immer'
import { create } from 'zustand'
import type { ExternalChange } from '@shared/bridge'
import type { Project } from '@shared/schema'
import { compareOrder } from '../lib/tree'
import { usePlay } from './play'

export type TreeKind = 'folder' | 'flow' | 'template' | 'entity'
export type DocKind = 'flow' | 'template' | 'entity' | 'state'

/** The fixed State documents. */
export type StateDocId = 'world' | 'relationships' | 'time'

export type FlowElementKind = 'node' | 'edge'

export type Selection =
  | { kind: 'project' }
  | { kind: TreeKind; id: string }
  | { kind: FlowElementKind; flowId: string; id: string }
  | { kind: 'state'; id: StateDocId }
  | null

export function isTreeSelection(sel: Selection): sel is { kind: TreeKind; id: string } {
  return sel !== null && sel.kind !== 'project' && sel.kind !== 'node' && sel.kind !== 'edge' && sel.kind !== 'state'
}

/** The document shown in the central workspace. */
export interface DocRef {
  kind: DocKind
  id: string
}

interface HistoryEntry {
  /** The project as it was on the other side of this step. */
  project: Project
  label: string
  selection: Selection
  activeDoc: DocRef | null
}

interface ProjectState {
  /** The open project, exactly as it will be written to disk. Immutable (Immer-frozen). */
  project: Project | null
  /** Absolute path of the project file, or null if it has never been saved. */
  filePath: string | null
  /**
   * The project as last saved or loaded. Dirty means `project !== savedProject`.
   * Because snapshots are immutable and structurally shared, undoing back to the
   * saved state restores the very same object, so the project reads clean again.
   */
  savedProject: Project | null
  past: HistoryEntry[]
  future: HistoryEntry[]

  // UI state (never written to the project file)
  selection: Selection
  activeDoc: DocRef | null
  renamingId: string | null
  externalChange: ExternalChange | null
  /** A node the canvas should scroll to and select (e.g. after "show in flow"). */
  focusRequest: { flowId: string; nodeId: string; nonce: number } | null
}

interface ProjectActions {
  loadProject(project: Project, filePath: string | null, options?: { dirty?: boolean }): void
  closeProject(): void
  markSaved(filePath: string, saved: Project): void
  /**
   * Apply one undoable change. Returns false when the recipe changed nothing
   * (no history entry, no dirty flag).
   */
  edit(label: string, recipe: (draft: Draft<Project>) => void): boolean
  undo(): void
  redo(): void
  select(selection: Selection): void
  openDoc(doc: DocRef | null): void
  setRenaming(id: string | null): void
  setExternalChange(change: ExternalChange | null): void
  focusNode(flowId: string, nodeId: string): void
}

export type ProjectStore = ProjectState & ProjectActions

const HISTORY_LIMIT = 200

const initialState: ProjectState = {
  project: null,
  filePath: null,
  savedProject: null,
  past: [],
  future: [],
  selection: null,
  activeDoc: null,
  renamingId: null,
  externalChange: null,
  focusRequest: null
}

function collectionFor(kind: TreeKind) {
  return ({ folder: 'folders', flow: 'flows', template: 'templates', entity: 'entities' } as const)[kind]
}

export function itemExists(project: Project, kind: TreeKind, id: string): boolean {
  return id in project[collectionFor(kind)]
}

function firstFlow(project: Project): DocRef | null {
  const flows = Object.values(project.flows)
  const root = flows.filter((f) => f.folderId === null).sort(compareOrder)[0] ?? flows.sort(compareOrder)[0]
  return root ? { kind: 'flow', id: root.id } : null
}

export function docExists(project: Project, doc: DocRef): boolean {
  return doc.kind === 'state' ? true : itemExists(project, doc.kind, doc.id)
}

function selectionExists(project: Project, sel: Selection): boolean {
  if (!sel || sel.kind === 'project' || sel.kind === 'state') return true
  if (sel.kind === 'node') return Boolean(project.flows[sel.flowId]?.nodes[sel.id])
  if (sel.kind === 'edge') return Boolean(project.flows[sel.flowId]?.edges[sel.id])
  return itemExists(project, sel.kind, sel.id)
}

/** Keep selection/doc only if what they point at still exists in `project`. */
function sanitizeView(project: Project, selection: Selection, activeDoc: DocRef | null) {
  const docOk = activeDoc !== null && docExists(project, activeDoc)
  const sel: Selection = selectionExists(project, selection)
    ? selection
    : docOk && activeDoc
      ? activeDoc.kind === 'state'
        ? { kind: 'state', id: activeDoc.id as StateDocId }
        : { kind: activeDoc.kind, id: activeDoc.id }
      : { kind: 'project' }
  const doc = docOk ? activeDoc : null
  return { selection: sel, activeDoc: doc }
}

export const useProjectStore = create<ProjectStore>()((set, get) => ({
  ...initialState,

  loadProject: (project, filePath, options) => {
    usePlay.getState().reset()
    const frozen = produce(project, () => undefined) // freeze, so later edits share structure safely
    set({
      ...initialState,
      project: frozen,
      filePath,
      savedProject: options?.dirty ? null : frozen,
      selection: { kind: 'project' },
      activeDoc: firstFlow(frozen)
    })
  },

  closeProject: () => {
    usePlay.getState().reset()
    set({ ...initialState })
  },

  markSaved: (filePath, saved) => set({ filePath, savedProject: saved, externalChange: null }),

  edit: (label, recipe) => {
    const s = get()
    if (!s.project) return false
    const next = produce(s.project, recipe)
    if (next === s.project) return false
    const entry: HistoryEntry = { project: s.project, label, selection: s.selection, activeDoc: s.activeDoc }
    set({ project: next, past: [...s.past, entry].slice(-HISTORY_LIMIT), future: [] })
    return true
  },

  undo: () => {
    const s = get()
    const entry = s.past[s.past.length - 1]
    if (!entry || !s.project) return
    set({
      project: entry.project,
      past: s.past.slice(0, -1),
      future: [{ project: s.project, label: entry.label, selection: s.selection, activeDoc: s.activeDoc }, ...s.future],
      renamingId: null,
      ...sanitizeView(entry.project, entry.selection, entry.activeDoc)
    })
  },

  redo: () => {
    const s = get()
    const entry = s.future[0]
    if (!entry || !s.project) return
    set({
      project: entry.project,
      future: s.future.slice(1),
      past: [...s.past, { project: s.project, label: entry.label, selection: s.selection, activeDoc: s.activeDoc }],
      renamingId: null,
      ...sanitizeView(entry.project, entry.selection, entry.activeDoc)
    })
  },

  select: (selection) =>
    set(() => {
      if (!selection || selection.kind === 'project' || selection.kind === 'folder') return { selection }
      if (selection.kind === 'node' || selection.kind === 'edge') {
        return { selection, activeDoc: { kind: 'flow', id: selection.flowId } }
      }
      if (selection.kind === 'state') return { selection, activeDoc: { kind: 'state', id: selection.id } }
      return { selection, activeDoc: { kind: selection.kind, id: selection.id } }
    }),

  openDoc: (doc) =>
    set({
      activeDoc: doc,
      selection: doc
        ? doc.kind === 'state'
          ? { kind: 'state', id: doc.id as StateDocId }
          : { kind: doc.kind, id: doc.id }
        : get().selection
    }),

  setRenaming: (id) => set({ renamingId: id }),

  setExternalChange: (change) => set({ externalChange: change }),

  focusNode: (hintFlowId, nodeId) => {
    // Node ids are unique project-wide; find the flow that actually holds it (Play can cross flows).
    const flows = get().project?.flows ?? {}
    const flowId = flows[hintFlowId]?.nodes[nodeId] ? hintFlowId : (Object.values(flows).find((f) => f.nodes[nodeId])?.id ?? hintFlowId)
    set({
      activeDoc: { kind: 'flow', id: flowId },
      selection: { kind: 'node', flowId, id: nodeId },
      focusRequest: { flowId, nodeId, nonce: Date.now() }
    })
  }
}))

export { selectionExists }

export const selectDirty = (s: ProjectStore): boolean => s.project !== null && s.project !== s.savedProject
export const selectCanUndo = (s: ProjectStore): boolean => s.past.length > 0
export const selectCanRedo = (s: ProjectStore): boolean => s.future.length > 0
