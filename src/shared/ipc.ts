import type { Project } from './schema'

/** IPC channel names shared by the main process, preload and renderer. */
export const IPC = {
  openDialog: 'project:open-dialog',
  saveDialog: 'project:save-dialog',
  read: 'project:read',
  write: 'project:write',
  externalChange: 'project:external-change',
  recentList: 'recent:list',
  recentTouch: 'recent:touch',
  recentRemove: 'recent:remove',
  confirmDiscard: 'dialog:confirm-discard',
  confirm: 'dialog:confirm',
  setDirty: 'window:set-dirty',
  forceClose: 'window:force-close',
  showInFolder: 'shell:show-in-folder',
  exportDialog: 'export:save-dialog',
  exportWrite: 'export:write',
  menuCommand: 'menu:command'
} as const

export type MenuCommand = 'new' | 'open' | 'save' | 'save-as' | 'close-project' | 'save-and-close' | 'undo' | 'redo' | 'export'

export type ReadResult = { ok: true; path: string; text: string } | { ok: false; error: string }
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

/** The API exposed to the renderer as `window.api` by the preload script. */
export interface SkeinApi {
  platform: string
  openProjectDialog(): Promise<string | null>
  saveProjectDialog(suggestedName: string): Promise<string | null>
  readProject(path: string): Promise<ReadResult>
  writeProject(path: string, project: Project): Promise<WriteResult>
  listRecent(): Promise<RecentProject[]>
  touchRecent(path: string, name: string): Promise<void>
  removeRecent(path: string): Promise<void>
  confirmDiscard(projectName: string): Promise<DiscardChoice>
  confirm(options: ConfirmOptions): Promise<boolean>
  setDirty(dirty: boolean, projectName: string | null): void
  forceClose(): void
  showInFolder(path: string): void
  /** Ask where to write a game export. Returns the chosen path, or null. */
  exportDialog(suggestedName: string): Promise<string | null>
  /** Write export text to a path chosen with exportDialog. */
  exportWrite(path: string, text: string): Promise<WriteResult>
  onMenuCommand(callback: (command: MenuCommand) => void): () => void
  onExternalChange(callback: (change: ExternalChange) => void): () => void
}
