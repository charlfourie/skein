import type { ProjectFiles } from './projectFiles'
import type { Project } from './schema'

/** Commands from keyboard shortcuts (the browser bridge listens for them). */
export type MenuCommand = 'new' | 'open' | 'open-file' | 'save' | 'save-as' | 'close-project' | 'undo' | 'redo' | 'export'

/** A single-file project comes back as `text`; a project folder (path ends in project.json) as `files`. */
export type ReadResult = { ok: true; path: string; text: string } | { ok: true; path: string; files: ProjectFiles } | { ok: false; error: string }
/** folder: a "<Name>.skein" folder with one file per flow. file: one .skein.json file. */
export type ProjectLayout = 'folder' | 'file'
export type WriteResult = { ok: true; path: string; bytes: number } | { ok: false; error: string }
export type DiscardChoice = 'save' | 'discard' | 'cancel'

export interface RecentProject {
  path: string
  name: string
  openedAt: string
  exists: boolean
}

export interface ExternalChange {
  path: string
  deleted: boolean
}

export interface ConfirmOptions {
  message: string
  detail?: string
  confirmLabel?: string
  danger?: boolean
}

/**
 * Everything the editor needs from outside itself: picking, reading and writing
 * project files, confirmations, and shortcuts. The browser implementation is
 * src/renderer/src/web/browserApi.ts; tests can supply their own.
 */
export interface SkeinApi {
  platform: string
  /** The browser can open and save project folders (Chromium's File System Access). Elsewhere, projects are single files. */
  supportsFolders: boolean
  /** Pick a project file (a .skein.json, or a project folder's project.json). */
  openProjectDialog(): Promise<string | null>
  /** Pick a project folder. Resolves its project.json path; throws with a message when the folder isn't a Skein project. */
  openProjectFolderDialog(): Promise<string | null>
  /** Choose where to save. A folder's path is its project.json. Where folders can't be written (some browsers), a file path comes back instead. */
  saveProjectDialog(suggestedName: string, layout: ProjectLayout): Promise<string | null>
  readProject(path: string): Promise<ReadResult>
  writeProject(path: string, project: Project): Promise<WriteResult>
  listRecent(): Promise<RecentProject[]>
  touchRecent(path: string, name: string): Promise<void>
  removeRecent(path: string): Promise<void>
  confirmDiscard(projectName: string): Promise<DiscardChoice>
  confirm(options: ConfirmOptions): Promise<boolean>
  /** Warn before the tab closes while there are unsaved changes. */
  setDirty(dirty: boolean, projectName: string | null): void
  /** Ask where to write a game export. Returns the chosen path, or null. */
  exportDialog(suggestedName: string): Promise<string | null>
  /** Write export text to a path chosen with exportDialog. */
  exportWrite(path: string, text: string): Promise<WriteResult>
  onMenuCommand(callback: (command: MenuCommand) => void): () => void
  onExternalChange(callback: (change: ExternalChange) => void): () => void
}
