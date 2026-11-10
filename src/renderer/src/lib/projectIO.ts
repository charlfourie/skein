import { createEmptyProject } from '@shared/factory'
import { parseProject } from '@shared/parse'
import { selectDirty, useProjectStore } from '../store/projectStore'
import { basename, suggestedFileName } from './platform'
import { toast } from './toast'

/**
 * High-level file operations. The renderer never touches the disk: it asks the
 * main process (via the preload bridge) to show dialogs and read/write files,
 * and the main process does the canonical serialization and atomic write.
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

export async function openProject(path?: string): Promise<boolean> {
  if (!(await guardUnsaved())) return false
  const target = path ?? (await window.api.openProjectDialog())
  if (!target) return false
  return loadFrom(target)
}

export async function reloadFromDisk(): Promise<boolean> {
  const path = store().filePath
  return path ? loadFrom(path) : false
}

async function loadFrom(path: string): Promise<boolean> {
  return exclusive(false, async () => {
    const res = await window.api.readProject(path)
    if (!res.ok) {
      toast.error(`Couldn't open ${basename(path)}`, res.error)
      return false
    }
    const parsed = parseProject(res.text)
    if (!parsed.ok) {
      toast.error(`Couldn't open ${basename(path)}`, parsed.error)
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
}

export async function saveProject(): Promise<boolean> {
  const { project, filePath } = store()
  if (!project) return false
  if (!filePath) return saveProjectAs()
  return writeTo(filePath)
}

export async function saveProjectAs(): Promise<boolean> {
  const { project } = store()
  if (!project) return false
  const path = await window.api.saveProjectDialog(suggestedFileName(project.meta.name))
  if (!path) return false
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
    toast.success('Saved', basename(res.path))
    return true
  })
}

export async function closeProject(): Promise<void> {
  if (!(await guardUnsaved())) return
  store().closeProject()
}
