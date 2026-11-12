import { createEmptyProject } from '@shared/factory'
import type { ProjectLayout } from '@shared/bridge'
import { parseProject } from '@shared/parse'
import { isFolderProjectPath, parseProjectFiles } from '@shared/projectFiles'
import type { Demo } from '../demos'
import { selectDirty, useProjectStore } from '../store/projectStore'
import { basename, dirname, suggestedFileName, suggestedProjectName } from './platform'
import { discardRecovery, findRecovery, holdRecovery, readRecovered, type RecoveryRecord } from './recovery'
import { toast } from './toast'

/** How a project path reads in messages: a folder by its folder name, a file by its file name. */
export function displayName(path: string): string {
  return isFolderProjectPath(path) ? basename(dirname(path)) : basename(path)
}

/** Single-file projects whose owner said "not now" to converting, this session. */
const keptAsFile = new Set<string>()

/**
 * High-level file operations. The editor never touches files directly: it asks
 * the bridge (`window.api`, the browser's file pickers) to choose, read and
 * write them, and every save goes through the canonical serializer.
 */

const store = () => useProjectStore.getState()

let busy = false
async function exclusive<T>(fallback: T, op: () => Promise<T>): Promise<T> {
  if (busy) return fallback
  busy = true
  try {
    return await op()
  } finally {
    busy = false
  }
}

/** If there are unsaved changes, ask what to do. Resolves true when it's safe to continue. */
export async function guardUnsaved(): Promise<boolean> {
  const s = store()
  if (!selectDirty(s) || !s.project) return true
  const choice = await window.api.confirmDiscard(s.project.meta.name)
  if (choice === 'cancel') return false
  if (choice === 'save') return saveProject()
  return true
}

export async function newProject(): Promise<void> {
  if (!(await guardUnsaved())) return
  store().loadProject(createEmptyProject('Untitled Project'), null)
}

/** Open a project: a known path (Recent), or pick one — a folder where the browser supports it, else a file. */
export async function openProject(path?: string): Promise<boolean> {
  if (!(await guardUnsaved())) return false
  if (path) return loadFrom(path)
  if (!window.api.supportsFolders) return pickAndLoad(() => window.api.openProjectDialog())
  return pickAndLoad(() => window.api.openProjectFolderDialog())
}

/** Open a single .skein.json file (older projects, or one someone sent you). */
export async function openProjectFile(): Promise<boolean> {
  if (!(await guardUnsaved())) return false
  return pickAndLoad(() => window.api.openProjectDialog())
}

async function pickAndLoad(pick: () => Promise<string | null>): Promise<boolean> {
  let target: string | null
  try {
    target = await pick()
  } catch (err) {
    toast.error("Couldn't open that", err instanceof Error ? err.message : String(err))
    return false
  }
  return target ? loadFrom(target) : false
}

/**
 * Open a bundled demo. It opens like a new, unsaved project, so saving asks
 * where to put a copy and the bundled original is never touched.
 */
export async function openDemo(demo: Demo): Promise<boolean> {
  if (!(await guardUnsaved())) return false
  const parsed = parseProject(demo.text)
  if (!parsed.ok) {
    toast.error(`Couldn't open ${demo.title}`, parsed.error)
    return false
  }
  store().loadProject(parsed.project, null)
  toast.success(`Opened ${demo.title}`, 'This is a demo copy. Use Save As to keep your changes.')
  return true
}

export async function reloadFromDisk(): Promise<boolean> {
  const path = store().filePath
  return path ? loadFrom(path) : false
}

async function loadFrom(path: string, options: { offerRecovery?: boolean } = {}): Promise<boolean> {
  const loaded = await exclusive(false, async () => {
    const res = await window.api.readProject(path)
    if (!res.ok) {
      toast.error(`Couldn't open ${displayName(path)}`, res.error)
      return false
    }
    const parsed = 'files' in res ? parseProjectFiles(res.files) : parseProject(res.text)
    if (!parsed.ok) {
      toast.error(`Couldn't open ${displayName(path)}`, parsed.error)
      return false
    }
    const repaired = parsed.repairs.length > 0
    store().loadProject(parsed.project, res.path, { dirty: repaired })
    void window.api.touchRecent(res.path, parsed.project.meta.name)
    if (repaired) {
      const list = parsed.repairs.slice(0, 4).join('\n')
      const more = parsed.repairs.length > 4 ? `\n…and ${parsed.repairs.length - 4} more` : ''
      toast.warn(
        `Repaired ${parsed.repairs.length} issue${parsed.repairs.length === 1 ? '' : 's'} in the file`,
        `${list}${more}\nSave to keep the fixes.`
      )
    }
    return true
  })
  if (loaded && options.offerRecovery !== false) await offerRecovery()
  return loaded
}

/** When a copy was kept, in words: "today at 14:32", "3 Nov at 09:05". */
export function recoveredWhen(iso: string): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const today = new Date().toDateString() === d.toDateString()
  return today ? `today at ${time}` : `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} at ${time}`
}

/** The project just opened has a recovery copy: restore it over the files, or discard it. */
async function offerRecovery(): Promise<void> {
  const project = store().project
  if (!project) return
  const id = project.meta.id
  const release = holdRecovery(id)
  try {
    const record = await findRecovery(id)
    if (!record) return
    const restore = await window.api.confirm({
      message: `Restore unsaved changes to “${record.name}”?`,
      detail:
        `Skein kept a copy of changes that weren't saved (${recoveredWhen(record.savedAt)}). ` +
        'Restore puts them back over the saved files, as one step you can undo. Cancel discards the copy.',
      confirmLabel: 'Restore'
    })
    if (restore && store().project?.meta.id === id) applyRecovered(record)
    else await discardRecovery(id)
  } finally {
    release()
  }
}

function applyRecovered(record: RecoveryRecord): boolean {
  const read = readRecovered(record)
  if (!read.ok) {
    toast.error("Couldn't restore the unsaved changes", read.error)
    return false
  }
  store().replaceProject('Restore unsaved changes', read.project)
  toast.success('Restored unsaved changes', `From ${recoveredWhen(record.savedAt)}. Save to keep them, or undo to go back to the saved files.`)
  return true
}

/**
 * Restore a recovery copy from the start screen: reopen its project and put the
 * changes back over it (one undoable step). If the project can't be reopened
 * (moved, or never saved), the copy opens as a new, unsaved project.
 */
export async function restoreRecovery(record: RecoveryRecord): Promise<boolean> {
  if (!(await guardUnsaved())) return false
  const read = readRecovered(record)
  if (!read.ok) {
    toast.error("Couldn't restore the unsaved changes", read.error)
    return false
  }
  const release = holdRecovery(record.projectId)
  try {
    if (record.path && (await loadFrom(record.path, { offerRecovery: false })) && store().project?.meta.id === record.projectId) {
      return applyRecovered(record)
    }
    store().loadProject(read.project, null, { dirty: true })
    toast.success(
      'Restored unsaved changes',
      record.path
        ? `Couldn't reopen ${displayName(record.path)}, so this is an unsaved copy. Use Save As to keep it.`
        : `From ${recoveredWhen(record.savedAt)}. This project was never saved: use Save As to keep it.`
    )
    return true
  } finally {
    release()
  }
}

export async function saveProject(): Promise<boolean> {
  const { project, filePath } = store()
  if (!project) return false
  if (!filePath) return saveProjectAs()
  // A single-file project: offer the folder layout once per session, where the browser can write folders.
  if (window.api.supportsFolders && !isFolderProjectPath(filePath) && !keptAsFile.has(filePath)) {
    keptAsFile.add(filePath)
    const convert = await window.api.confirm({
      message: 'Save this project as a folder instead?',
      detail:
        'Skein now saves one file per flow, so people editing different flows never touch the same file and merges stay simple. ' +
        `Your ${basename(filePath)} is left as it is; delete it once you've checked the new folder.`,
      confirmLabel: 'Save as a folder…'
    })
    if (convert) return saveProjectAs('folder')
  }
  return writeTo(filePath)
}

/** Save under a new name: as a project folder where the browser supports it, else a single file. */
export async function saveProjectAs(layout: ProjectLayout = window.api.supportsFolders ? 'folder' : 'file'): Promise<boolean> {
  const { project } = store()
  if (!project) return false
  const name = layout === 'folder' ? suggestedProjectName(project.meta.name) : suggestedFileName(project.meta.name)
  let path: string | null
  try {
    path = await window.api.saveProjectDialog(name, layout)
  } catch (err) {
    toast.error("Couldn't save there", err instanceof Error ? err.message : String(err))
    return false
  }
  if (!path) return false
  if (!isFolderProjectPath(path)) keptAsFile.add(path) // chosen on purpose (or the browser can't write folders)
  return writeTo(path)
}

async function writeTo(path: string): Promise<boolean> {
  return exclusive(false, async () => {
    // Snapshot the exact (immutable) project being saved: edits made while the
    // write is in flight produce a new object, so they keep the project dirty.
    const { project } = store()
    if (!project) return false
    const res = await window.api.writeProject(path, project)
    if (!res.ok) {
      toast.error('Save failed', res.error)
      return false
    }
    store().markSaved(res.path, project)
    void window.api.touchRecent(res.path, project.meta.name)
    toast.success('Saved', displayName(res.path))
    return true
  })
}

export async function closeProject(): Promise<void> {
  if (!(await guardUnsaved())) return
  store().closeProject()
}
