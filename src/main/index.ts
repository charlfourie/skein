import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { existsSync, promises as fsp } from 'fs'
import { dirname, join, resolve } from 'path'
import {
  IPC,
  type ConfirmOptions,
  type DiscardChoice,
  type MenuCommand,
  type ProjectLayout,
  type ReadResult,
  type WriteResult
} from '../shared/ipc'
import type { Project } from '../shared/schema'
import { FOLDER_SUFFIX, PROJECT_FILE, isFolderProjectPath, splitProject } from '../shared/projectFiles'
import { serializeProject } from '../shared/serialize'
import { folderHash, folderIsUsable, readProjectFolder, writeProjectFolder } from './projectStorage'
import { buildMenu } from './menu'
import { RecentProjects } from './recent'
import { hashText, readTextFile, writeFileAtomic } from './storage'
import { ProjectWatcher } from './watcher'

const PROJECT_FILTERS = [
  { name: 'Skein Project', extensions: ['json'] },
  { name: 'All Files', extensions: ['*'] }
]

let mainWindow: BrowserWindow | null = null
let dirty = false
let dirtyProjectName: string | null = null
let closeConfirmed = false

/**
 * The renderer may only read/write files the user picked in a native dialog
 * (or picked in an earlier session, via the recent list). A compromised
 * renderer therefore can't touch arbitrary paths on disk.
 */
const allowedPaths = new Set<string>()
const exportPaths = new Set<string>()
function allow(path: string): string {
  const resolved = resolve(path)
  allowedPaths.add(resolved)
  return resolved
}
function isAllowed(path: unknown): path is string {
  return typeof path === 'string' && allowedPaths.has(resolve(path))
}

const recent = new RecentProjects(() => join(app.getPath('userData'), 'recent-projects.json'))
const watcher = new ProjectWatcher((change) => mainWindow?.webContents.send(IPC.externalChange, change))

function send(command: MenuCommand): void {
  mainWindow?.webContents.send(IPC.menuCommand, command)
}

function describeError(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | null)?.code
  switch (code) {
    case 'ENOENT':
      return 'The file or folder no longer exists.'
    case 'EACCES':
    case 'EPERM':
      return 'Permission denied. The file may be read-only or locked by another program (a sync client or antivirus).'
    case 'EBUSY':
      return 'The file is locked by another program. Try again in a moment.'
    case 'EISDIR':
      return 'That path is a folder, not a file.'
    case 'ENOSPC':
      return 'The disk is full.'
    case 'EROFS':
      return 'The disk is read-only.'
  }
  return err instanceof Error ? err.message : String(err)
}

async function askToSave(win: BrowserWindow, projectName: string): Promise<DiscardChoice> {
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    message: `Do you want to save the changes to “${projectName}”?`,
    detail: "Your changes will be lost if you don't save them."
  })
  return (['save', 'discard', 'cancel'] as const)[response] ?? 'cancel'
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Skein',
    backgroundColor: '#0a0b0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  })
  mainWindow = win

  win.once('ready-to-show', () => win.show())

  win.on('close', (event) => {
    if (!dirty || closeConfirmed) return
    event.preventDefault()
    void askToSave(win, dirtyProjectName ?? 'this project').then((choice) => {
      if (choice === 'save') send('save-and-close')
      else if (choice === 'discard') {
        closeConfirmed = true
        win.close()
      }
    })
  })

  win.on('closed', () => {
    mainWindow = null
    dirty = false
    dirtyProjectName = null
    closeConfirmed = false
    watcher.stop()
  })

  // Never let the renderer navigate away or open new windows; send links to the OS browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function registerIpc(): void {
  ipcMain.handle(IPC.openDialog, async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Project',
      properties: ['openFile'],
      filters: PROJECT_FILTERS
    })
    const picked = result.filePaths[0]
    return result.canceled || !picked ? null : allow(picked)
  })

  ipcMain.handle(IPC.openFolderDialog, async (): Promise<{ path: string | null; error?: string }> => {
    if (!mainWindow) return { path: null }
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Open Project Folder', properties: ['openDirectory'] })
    const picked = result.filePaths[0]
    if (result.canceled || !picked) return { path: null }
    // The project folder itself, or a folder holding exactly one project folder.
    if (existsSync(join(picked, PROJECT_FILE))) return { path: allow(join(picked, PROJECT_FILE)) }
    const inside = (await fsp.readdir(picked).catch(() => [] as string[])).filter((n) => existsSync(join(picked, n, PROJECT_FILE)))
    if (inside.length === 1) return { path: allow(join(picked, inside[0], PROJECT_FILE)) }
    return { path: null, error: `That folder isn't a Skein project: it has no ${PROJECT_FILE}. Pick the “…${FOLDER_SUFFIX}” folder itself.` }
  })

  ipcMain.handle(IPC.saveDialog, async (_event, suggestedName: unknown, layout: unknown) => {
    if (!mainWindow) return null
    if ((layout as ProjectLayout) === 'folder') {
      const base = typeof suggestedName === 'string' && suggestedName ? suggestedName : 'Untitled'
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Save Project Folder',
        buttonLabel: 'Save',
        defaultPath: `${base}${FOLDER_SUFFIX}`,
        properties: ['createDirectory'],
        message: 'Skein saves the project as a folder, with one file per flow.'
      })
      if (result.canceled || !result.filePath) return null
      let folder = result.filePath.replace(/(\.skein)?\.json$/i, '')
      if (!folder.toLowerCase().endsWith(FOLDER_SUFFIX)) folder += FOLDER_SUFFIX
      if (!(await folderIsUsable(folder))) {
        await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          message: 'That folder already holds other files.',
          detail: 'Choose a new name, or an existing Skein project folder to replace.'
        })
        return null
      }
      await fsp.mkdir(folder, { recursive: true })
      return allow(join(folder, PROJECT_FILE))
    }
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Project',
      defaultPath: typeof suggestedName === 'string' ? suggestedName : 'Untitled.skein.json',
      filters: PROJECT_FILTERS,
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    if (result.canceled || !result.filePath) return null
    let path = result.filePath
    if (!path.toLowerCase().endsWith('.json')) path += '.skein.json'
    return allow(path)
  })

  ipcMain.handle(IPC.read, async (_event, path: unknown): Promise<ReadResult> => {
    if (!isAllowed(path)) return { ok: false, error: 'Access to this file was not granted. Open it with File › Open.' }
    const target = resolve(path)
    try {
      if (isFolderProjectPath(target)) {
        const files = await readProjectFolder(dirname(target))
        watcher.watch(target, folderHash(files), true)
        return { ok: true, path: target, files }
      }
      const text = await readTextFile(target)
      watcher.watch(target, hashText(text))
      return { ok: true, path: target, text }
    } catch (err) {
      return { ok: false, error: describeError(err) }
    }
  })

  ipcMain.handle(IPC.write, async (_event, path: unknown, project: Project): Promise<WriteResult> => {
    if (!isAllowed(path)) return { ok: false, error: 'Access to this file was not granted. Use File › Save As.' }
    const target = resolve(path)
    try {
      if (isFolderProjectPath(target)) {
        // Several files change: tell the watcher, so our own save isn't reported as someone else's.
        const hash = folderHash(splitProject(project))
        watcher.watch(target, hash, true)
        watcher.pause()
        try {
          const { bytes } = await writeProjectFolder(dirname(target), project)
          return { ok: true, path: target, bytes }
        } finally {
          watcher.resume(hash)
        }
      }
      // Serialization happens here, in one place, so every save is canonical
      // regardless of what the renderer's in-memory key order looks like.
      const text = serializeProject(project)
      watcher.watch(target, hashText(text)) // register before writing so our own write isn't reported
      await writeFileAtomic(target, text)
      return { ok: true, path: target, bytes: Buffer.byteLength(text, 'utf8') }
    } catch (err) {
      return { ok: false, error: describeError(err) }
    }
  })

  ipcMain.handle(IPC.recentList, async () => {
    const list = await recent.listWithExistence()
    for (const item of list) allow(item.path)
    return list
  })

  ipcMain.handle(IPC.recentTouch, async (_event, path: unknown, name: unknown) => {
    if (isAllowed(path) && typeof name === 'string') await recent.touch(resolve(path), name)
  })

  ipcMain.handle(IPC.recentRemove, async (_event, path: unknown) => {
    if (typeof path === 'string') await recent.remove(resolve(path))
  })

  ipcMain.handle(IPC.confirmDiscard, async (_event, projectName: unknown): Promise<DiscardChoice> => {
    if (!mainWindow) return 'cancel'
    return askToSave(mainWindow, typeof projectName === 'string' ? projectName : 'this project')
  })

  ipcMain.handle(IPC.confirm, async (_event, options: ConfirmOptions): Promise<boolean> => {
    if (!mainWindow) return false
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: options.danger ? 'warning' : 'question',
      buttons: [options.confirmLabel ?? 'OK', 'Cancel'],
      defaultId: options.danger ? 1 : 0,
      cancelId: 1,
      noLink: true,
      message: String(options.message),
      detail: options.detail ? String(options.detail) : undefined
    })
    return response === 0
  })

  ipcMain.on(IPC.setDirty, (_event, isDirty: unknown, projectName: unknown) => {
    dirty = isDirty === true
    dirtyProjectName = typeof projectName === 'string' ? projectName : null
    if (process.platform === 'darwin') mainWindow?.setDocumentEdited(dirty)
  })

  ipcMain.on(IPC.forceClose, () => {
    closeConfirmed = true
    mainWindow?.close()
  })

  // Game exports: a separate allow-list, so the export path can't be used to overwrite the project.
  ipcMain.handle(IPC.exportDialog, async (_event, suggestedName: unknown) => {
    if (!mainWindow) return null
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export for Game Engine',
      defaultPath: typeof suggestedName === 'string' ? suggestedName : 'game.json',
      filters: [{ name: 'Game data (JSON)', extensions: ['json'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    if (result.canceled || !result.filePath) return null
    let path = result.filePath
    if (!path.toLowerCase().endsWith('.json')) path += '.json'
    const resolved = resolve(path)
    exportPaths.add(resolved)
    allow(resolved) // so "Show in folder" works
    return resolved
  })

  ipcMain.handle(IPC.exportWrite, async (_event, path: unknown, text: unknown): Promise<WriteResult> => {
    if (typeof path !== 'string' || !exportPaths.has(resolve(path))) {
      return { ok: false, error: 'Choose where to export with the Export dialog first.' }
    }
    if (typeof text !== 'string' || text.length > 512 * 1024 * 1024) return { ok: false, error: 'Nothing valid to write.' }
    try {
      await writeFileAtomic(resolve(path), text)
      return { ok: true, path: resolve(path), bytes: Buffer.byteLength(text, 'utf8') }
    } catch (err) {
      return { ok: false, error: describeError(err) }
    }
  })

  ipcMain.on(IPC.showInFolder, (_event, path: unknown) => {
    if (isAllowed(path)) shell.showItemInFolder(resolve(path))
  })
}

app.whenReady().then(async () => {
  for (const item of await recent.list()) allow(item.path)
  Menu.setApplicationMenu(buildMenu(send, !app.isPackaged))
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  watcher.stop()
  if (process.platform !== 'darwin') app.quit()
})
