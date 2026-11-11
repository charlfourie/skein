import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type ExternalChange, type MenuCommand, type SkeinApi } from '../shared/ipc'

/**
 * The only bridge between the sandboxed renderer and the OS. The renderer never
 * gets `fs`, `require` or raw `ipcRenderer`; it gets this narrow, typed API.
 */
const api: SkeinApi = {
  platform: process.platform,
  openProjectDialog: () => ipcRenderer.invoke(IPC.openDialog),
  openProjectFolderDialog: async () => {
    const r: { path: string | null; error?: string } = await ipcRenderer.invoke(IPC.openFolderDialog)
    if (r.error) throw new Error(r.error)
    return r.path
  },
  saveProjectDialog: (suggestedName, layout) => ipcRenderer.invoke(IPC.saveDialog, suggestedName, layout),
  readProject: (path) => ipcRenderer.invoke(IPC.read, path),
  writeProject: (path, project) => ipcRenderer.invoke(IPC.write, path, project),
  listRecent: () => ipcRenderer.invoke(IPC.recentList),
  touchRecent: (path, name) => ipcRenderer.invoke(IPC.recentTouch, path, name),
  removeRecent: (path) => ipcRenderer.invoke(IPC.recentRemove, path),
  confirmDiscard: (projectName) => ipcRenderer.invoke(IPC.confirmDiscard, projectName),
  confirm: (options) => ipcRenderer.invoke(IPC.confirm, options),
  setDirty: (dirty, projectName) => ipcRenderer.send(IPC.setDirty, dirty, projectName),
  forceClose: () => ipcRenderer.send(IPC.forceClose),
  showInFolder: (path) => ipcRenderer.send(IPC.showInFolder, path),
  exportDialog: (suggestedName) => ipcRenderer.invoke(IPC.exportDialog, suggestedName),
  exportWrite: (path, text) => ipcRenderer.invoke(IPC.exportWrite, path, text),
  onMenuCommand: (callback) => {
    const handler = (_event: IpcRendererEvent, command: MenuCommand) => callback(command)
    ipcRenderer.on(IPC.menuCommand, handler)
    return () => ipcRenderer.removeListener(IPC.menuCommand, handler)
  },
  onExternalChange: (callback) => {
    const handler = (_event: IpcRendererEvent, change: ExternalChange) => callback(change)
    ipcRenderer.on(IPC.externalChange, handler)
    return () => ipcRenderer.removeListener(IPC.externalChange, handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
