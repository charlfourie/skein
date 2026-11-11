import type {
  ConfirmOptions,
  DiscardChoice,
  ExternalChange,
  MenuCommand,
  ReadResult,
  RecentProject,
  SkeinApi,
  WriteResult
} from '@shared/bridge'
import { FLOWS_DIR, FOLDER_SUFFIX, PROJECT_FILE, isFolderProjectPath, planWrite, splitProject, type ProjectFiles } from '@shared/projectFiles'
import { serializeProject } from '@shared/serialize'

/**
 * The editor's bridge to files and the keyboard (`window.api`), in the browser.
 *
 * The editor only ever talks to `SkeinApi`. Projects stay local files:
 *
 *  - Chromium browsers (Chrome, Edge, Arc, Brave) use the File System Access API,
 *    so Open/Save read and write the real files on disk,
 *    and project folders (one file per flow) work too.
 *  - Other browsers (Firefox, Safari) fall back to a file picker for Open and a
 *    download for Save, so they use single-file projects.
 *
 * Nothing is ever sent to a server. Paths are opaque keys (`<id>/<file name>`)
 * that map to a file handle kept in this tab and, for Recent, in IndexedDB.
 */

// ---- File System Access API (Chromium only; not in TypeScript's DOM lib) ----

type PermissionMode = 'read' | 'readwrite'
interface FsFileHandle {
  kind: 'file'
  name: string
  getFile(): Promise<File>
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>
  queryPermission?(opts: { mode: PermissionMode }): Promise<PermissionState>
  requestPermission?(opts: { mode: PermissionMode }): Promise<PermissionState>
  isSameEntry?(other: FsFileHandle): Promise<boolean>
}
interface FsDirHandle {
  kind: 'directory'
  name: string
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FsFileHandle>
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FsDirHandle>
  removeEntry(name: string): Promise<void>
  values(): AsyncIterable<FsFileHandle | FsDirHandle>
  queryPermission?(opts: { mode: PermissionMode }): Promise<PermissionState>
  requestPermission?(opts: { mode: PermissionMode }): Promise<PermissionState>
  isSameEntry?(other: FsFileHandle | FsDirHandle): Promise<boolean>
}
interface PickerType {
  description: string
  accept: Record<string, string[]>
}
interface FsWindow {
  showOpenFilePicker?(opts: { types?: PickerType[]; multiple?: boolean; id?: string }): Promise<FsFileHandle[]>
  showSaveFilePicker?(opts: { suggestedName?: string; types?: PickerType[]; id?: string }): Promise<FsFileHandle>
  showDirectoryPicker?(opts: { id?: string; mode?: PermissionMode }): Promise<FsDirHandle>
}

const fsWindow = window as unknown as FsWindow
const hasFsAccess = typeof fsWindow.showOpenFilePicker === 'function' && typeof fsWindow.showSaveFilePicker === 'function'
const hasFolders = hasFsAccess && typeof fsWindow.showDirectoryPicker === 'function'

const PROJECT_TYPES: PickerType[] = [{ description: 'Skein Project', accept: { 'application/json': ['.json'] } }]
const EXPORT_TYPES: PickerType[] = [{ description: 'Game data (JSON)', accept: { 'application/json': ['.json'] } }]

// ---- Path keys ----

/** Files this tab may touch: a picked handle, or (fallback) text read from an upload / a download name. */
const handles = new Map<string, FsFileHandle>()
/** Project folders, by key (`<id>/<Name>.skein/project.json`). */
const folders = new Map<string, FsDirHandle>()
const uploads = new Map<string, string>()
const downloads = new Set<string>()

const DOWNLOAD_PREFIX = 'download'

function newKey(fileName: string): string {
  const id = Math.random().toString(36).slice(2, 8)
  return `${id}/${fileName}`
}

function fileNameOf(key: string): string {
  const i = key.lastIndexOf('/')
  return i >= 0 ? key.slice(i + 1) : key
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

function describe(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') return 'Permission to this file was not granted.'
    if (err.name === 'NotFoundError') return 'The file no longer exists.'
    if (err.name === 'NoModificationAllowedError') return 'The file is read-only or locked by another program.'
  }
  return err instanceof Error ? err.message : String(err)
}

async function ensurePermission(handle: FsFileHandle | FsDirHandle, mode: PermissionMode): Promise<boolean> {
  if (!handle.queryPermission || !handle.requestPermission) return true
  if ((await handle.queryPermission({ mode })) === 'granted') return true
  return (await handle.requestPermission({ mode })) === 'granted'
}

function withJsonExtension(name: string, fallbackExt: string): string {
  return name.toLowerCase().endsWith('.json') ? name : name + fallbackExt
}

function download(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Fallback Open: a hidden <input type=file>. Resolves null if the user cancels. */
function pickUpload(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    let settled = false
    const done = (file: File | null) => {
      if (settled) return
      settled = true
      resolve(file)
    }
    input.addEventListener('change', () => done(input.files?.[0] ?? null))
    input.addEventListener('cancel', () => done(null))
    input.click()
  })
}

async function writeText(key: string, text: string): Promise<WriteResult> {
  const handle = handles.get(key)
  if (handle) {
    try {
      if (!(await ensurePermission(handle, 'readwrite'))) return { ok: false, error: 'Permission to save this file was not granted.' }
      const writable = await handle.createWritable()
      await writable.write(text)
      await writable.close()
      await rememberModified(key, handle)
      return { ok: true, path: key, bytes: byteLength(text) }
    } catch (err) {
      return { ok: false, error: describe(err) }
    }
  }
  if (downloads.has(key) || uploads.has(key)) {
    download(fileNameOf(key), text)
    return { ok: true, path: key, bytes: byteLength(text) }
  }
  return { ok: false, error: 'Choose where to save with Save As first.' }
}

// ---- Project folders ----

/** `<id>/<Name>.skein/project.json`: ends in project.json, so the editor knows it is a folder project. */
function folderKey(dir: FsDirHandle): string {
  return newKey(`${dir.name}/${PROJECT_FILE}`)
}

async function readFolder(dir: FsDirHandle): Promise<{ files: ProjectFiles; stamp: string }> {
  const main = await (await dir.getFileHandle(PROJECT_FILE)).getFile()
  const files: ProjectFiles = { [PROJECT_FILE]: await main.text() }
  const stamp: string[] = [`${main.lastModified}`]
  let flows: FsDirHandle | null = null
  try {
    flows = await dir.getDirectoryHandle(FLOWS_DIR)
  } catch {
    flows = null
  }
  if (flows) {
    const entries: FsFileHandle[] = []
    for await (const entry of flows.values()) if (entry.kind === 'file' && !entry.name.startsWith('.') && entry.name.toLowerCase().endsWith('.json')) entries.push(entry)
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const file = await entry.getFile()
      files[`${FLOWS_DIR}/${entry.name}`] = await file.text()
      stamp.push(`${entry.name}:${file.lastModified}`)
    }
  }
  return { files, stamp: stamp.join('|') }
}

async function writeFolder(key: string, dir: FsDirHandle, files: ProjectFiles): Promise<WriteResult> {
  try {
    if (!(await ensurePermission(dir, 'readwrite'))) return { ok: false, error: 'Permission to save into this folder was not granted.' }
    let existing: ProjectFiles = {}
    try {
      existing = (await readFolder(dir)).files
    } catch {
      existing = {}
    }
    const { write, remove } = planWrite(files, existing)
    const flows = await dir.getDirectoryHandle(FLOWS_DIR, { create: true })
    // project.json last, so a save that stops part-way never points at flows it doesn't have.
    const order = Object.keys(write).sort((a, b) => (a === PROJECT_FILE ? 1 : b === PROJECT_FILE ? -1 : a < b ? -1 : 1))
    for (const path of order) {
      const target = path === PROJECT_FILE ? dir : flows
      const handle = await target.getFileHandle(path === PROJECT_FILE ? PROJECT_FILE : path.slice(FLOWS_DIR.length + 1), { create: true })
      const writable = await handle.createWritable()
      await writable.write(write[path])
      await writable.close()
    }
    for (const path of remove) await flows.removeEntry(path.slice(FLOWS_DIR.length + 1)).catch(() => undefined)
    folderStamps.set(key, (await readFolder(dir)).stamp)
    return { ok: true, path: key, bytes: Object.values(files).reduce((n, t) => n + byteLength(t), 0) }
  } catch (err) {
    return { ok: false, error: describe(err) }
  }
}

// ---- Recent projects (IndexedDB, so file handles survive a reload) ----

const DB_NAME = 'skein'
const STORE = 'recent'
const MAX_RECENT = 12

interface StoredRecent {
  path: string
  name: string
  openedAt: string
  handle: FsFileHandle | FsDirHandle
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'path' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

async function listStored(): Promise<StoredRecent[]> {
  try {
    const all = await withStore<StoredRecent[]>('readonly', (s) => s.getAll() as IDBRequest<StoredRecent[]>)
    return all.sort((a, b) => b.openedAt.localeCompare(a.openedAt))
  } catch {
    return [] // Recent is a convenience; private windows may block IndexedDB.
  }
}

// ---- External-change detection (polls the open file's modified time) ----

const lastModified = new Map<string, number>()
const folderStamps = new Map<string, string>()
const externalListeners = new Set<(change: ExternalChange) => void>()
let watchedKey: string | null = null

async function rememberModified(key: string, handle: FsFileHandle): Promise<void> {
  try {
    lastModified.set(key, (await handle.getFile()).lastModified)
  } catch {
    // ignore
  }
}

setInterval(() => {
  if (!watchedKey || document.visibilityState !== 'visible') return
  const key = watchedKey
  const dir = folders.get(key)
  if (dir) {
    const known = folderStamps.get(key)
    readFolder(dir).then(
      ({ stamp }) => {
        if (known !== undefined && stamp !== known) {
          folderStamps.set(key, stamp)
          externalListeners.forEach((cb) => cb({ path: key, deleted: false }))
        }
      },
      () => {
        if (!folderStamps.has(key)) return
        folderStamps.delete(key)
        externalListeners.forEach((cb) => cb({ path: key, deleted: true }))
      }
    )
    return
  }
  const handle = handles.get(key)
  const known = lastModified.get(key)
  if (!handle || known === undefined) return
  handle.getFile().then(
    (file) => {
      if (file.lastModified !== known) {
        lastModified.set(key, file.lastModified)
        externalListeners.forEach((cb) => cb({ path: key, deleted: false }))
      }
    },
    (err: unknown) => {
      if (err instanceof DOMException && err.name === 'NotFoundError') {
        lastModified.delete(key)
        externalListeners.forEach((cb) => cb({ path: key, deleted: true }))
      }
    }
  )
}, 2000)

// ---- Keyboard shortcuts for file commands ----

const menuListeners = new Set<(command: MenuCommand) => void>()

function isTextEditing(el: Element | null): boolean {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly
  if (el instanceof HTMLInputElement) {
    return !el.readOnly && !['checkbox', 'radio', 'button', 'submit', 'color', 'range', 'file'].includes(el.type)
  }
  return el instanceof HTMLElement && el.isContentEditable
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform)

window.addEventListener('keydown', (e) => {
  const mod = isMac ? e.metaKey : e.ctrlKey
  if (!mod || e.altKey) return
  const key = e.key.toLowerCase()
  let command: MenuCommand | null = null
  if (key === 's') command = e.shiftKey ? 'save-as' : 'save'
  else if (key === 'o') command = e.shiftKey ? 'open-file' : 'open'
  else if (key === 'e' && !e.shiftKey) command = 'export'
  else if (key === 'w' && e.shiftKey) command = 'close-project'
  // Ctrl+N opens a browser window in most browsers and can't be intercepted, so Alt+N is offered too (below).
  else if (key === 'n' && !e.shiftKey) command = 'new'
  else if (!isTextEditing(document.activeElement)) {
    // Text fields keep native undo. Ctrl+Shift+Z (non-Mac) is already handled by useAppCommands.
    if (key === 'z' && !e.shiftKey) command = 'undo'
    else if ((key === 'y' && !isMac) || (key === 'z' && e.shiftKey && isMac)) command = 'redo'
  }
  if (!command) return
  e.preventDefault()
  menuListeners.forEach((cb) => cb(command))
})

window.addEventListener('keydown', (e) => {
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'n') {
    e.preventDefault()
    menuListeners.forEach((cb) => cb('new'))
  }
})

// ---- Unsaved-changes guard on tab close ----

let dirty = false
window.addEventListener('beforeunload', (e) => {
  if (!dirty) return
  e.preventDefault()
  e.returnValue = ''
})

// ---- The bridge ----

function confirmText(options: ConfirmOptions): string {
  return options.detail ? `${options.message}\n\n${options.detail}` : options.message
}

export const browserApi: SkeinApi = {
  platform: isMac ? 'darwin' : 'win32',
  supportsFolders: hasFolders,

  async openProjectDialog() {
    if (hasFsAccess) {
      try {
        const [handle] = await fsWindow.showOpenFilePicker!({ types: PROJECT_TYPES, id: 'skein-project' })
        if (!handle) return null
        const key = newKey(handle.name)
        handles.set(key, handle)
        return key
      } catch (err) {
        if (isAbort(err)) return null
        throw err
      }
    }
    const file = await pickUpload()
    if (!file) return null
    const key = newKey(file.name)
    uploads.set(key, await file.text())
    return key
  },

  async openProjectFolderDialog() {
    if (!hasFolders) throw new Error('This browser can’t open folders. Use Chrome, Edge or Arc, or open a single .skein.json file.')
    let picked: FsDirHandle
    try {
      picked = await fsWindow.showDirectoryPicker!({ id: 'skein-project', mode: 'readwrite' })
    } catch (err) {
      if (isAbort(err)) return null
      throw err
    }
    // The project folder itself, or a folder holding exactly one project folder.
    let dir: FsDirHandle | null = null
    try {
      await picked.getFileHandle(PROJECT_FILE)
      dir = picked
    } catch {
      const inside: FsDirHandle[] = []
      for await (const entry of picked.values()) {
        if (entry.kind !== 'directory') continue
        try {
          await entry.getFileHandle(PROJECT_FILE)
          inside.push(entry)
        } catch {
          // not a project
        }
      }
      if (inside.length === 1) dir = inside[0]
    }
    if (!dir) throw new Error(`That folder isn't a Skein project: it has no ${PROJECT_FILE}. Pick the “…${FOLDER_SUFFIX}” folder itself.`)
    const key = folderKey(dir)
    folders.set(key, dir)
    return key
  },

  async saveProjectDialog(suggestedName, layout) {
    if (layout === 'folder' && hasFolders) {
      try {
        const parent = await fsWindow.showDirectoryPicker!({ id: 'skein-project', mode: 'readwrite' })
        const base = (suggestedName || 'Untitled').replace(/(\.skein)?(\.json)?$/i, '')
        let dir: FsDirHandle
        if (parent.name.toLowerCase().endsWith(FOLDER_SUFFIX)) dir = parent // picked an existing project folder
        else dir = await parent.getDirectoryHandle(`${base}${FOLDER_SUFFIX}`, { create: true })
        for await (const entry of dir.values()) {
          if (entry.name.startsWith('.') || entry.name === PROJECT_FILE || entry.name === FLOWS_DIR) continue
          throw new Error(`${dir.name} already holds other files. Choose a new name, or an existing Skein project folder.`)
        }
        const key = folderKey(dir)
        folders.set(key, dir)
        return key
      } catch (err) {
        if (isAbort(err)) return null
        throw err
      }
    }
    // Single file (asked for, or the browser can't write folders).
    const name = withJsonExtension(`${(suggestedName || 'Untitled').replace(/(\.skein)?(\.json)?$/i, '')}.skein.json`, '.skein.json')
    if (hasFsAccess) {
      try {
        const handle = await fsWindow.showSaveFilePicker!({ suggestedName: name, types: PROJECT_TYPES, id: 'skein-project' })
        const key = newKey(withJsonExtension(handle.name, '.skein.json'))
        handles.set(key, handle)
        return key
      } catch (err) {
        if (isAbort(err)) return null
        throw err
      }
    }
    const key = `${DOWNLOAD_PREFIX}/${name}`
    downloads.add(key)
    return key
  },

  async readProject(path): Promise<ReadResult> {
    const dir = folders.get(path)
    if (dir) {
      try {
        if (!(await ensurePermission(dir, 'readwrite'))) return { ok: false, error: 'Permission to open this folder was not granted.' }
        const { files, stamp } = await readFolder(dir)
        folderStamps.set(path, stamp)
        watchedKey = path
        return { ok: true, path, files }
      } catch (err) {
        return { ok: false, error: describe(err) }
      }
    }
    const handle = handles.get(path)
    if (handle) {
      try {
        if (!(await ensurePermission(handle, 'read'))) return { ok: false, error: 'Permission to open this file was not granted.' }
        const file = await handle.getFile()
        lastModified.set(path, file.lastModified)
        watchedKey = path
        return { ok: true, path, text: await file.text() }
      } catch (err) {
        return { ok: false, error: describe(err) }
      }
    }
    const text = uploads.get(path)
    if (text !== undefined) {
      watchedKey = null
      return { ok: true, path, text }
    }
    return { ok: false, error: 'Open the file again with Open project.' }
  },

  async writeProject(path, project) {
    const dir = folders.get(path)
    if (dir || isFolderProjectPath(path)) {
      if (!dir) return { ok: false, error: 'Choose where to save with Save As first.' }
      let files: ProjectFiles
      try {
        files = splitProject(project)
      } catch (err) {
        return { ok: false, error: describe(err) }
      }
      const res = await writeFolder(path, dir, files)
      if (res.ok) watchedKey = path
      return res
    }
    let text: string
    try {
      text = serializeProject(project)
    } catch (err) {
      return { ok: false, error: describe(err) }
    }
    const res = await writeText(path, text)
    if (res.ok && handles.has(path)) watchedKey = path
    return res
  },

  async listRecent(): Promise<RecentProject[]> {
    const items = await listStored()
    for (const item of items) {
      if (item.handle.kind === 'directory') folders.set(item.path, item.handle)
      else handles.set(item.path, item.handle)
    }
    return items.map(({ path, name, openedAt }) => ({ path, name, openedAt, exists: true }))
  },

  async touchRecent(path, name) {
    const handle = handles.get(path) ?? folders.get(path)
    if (!handle) return // Uploads/downloads can't be reopened later, so they don't go in Recent.
    try {
      const existing = await listStored()
      // One entry per file: drop older keys that point at the same file.
      for (const item of existing) {
        if (item.path !== path && item.handle.kind === handle.kind && (await item.handle.isSameEntry?.(handle as never))) {
          await withStore('readwrite', (s) => s.delete(item.path))
        }
      }
      await withStore('readwrite', (s) => s.put({ path, name, openedAt: new Date().toISOString(), handle }))
      const all = await listStored()
      for (const old of all.slice(MAX_RECENT)) await withStore('readwrite', (s) => s.delete(old.path))
    } catch {
      // ignore: Recent is a convenience
    }
  },

  async removeRecent(path) {
    try {
      await withStore('readwrite', (s) => s.delete(path))
    } catch {
      // ignore
    }
  },

  async confirmDiscard(projectName): Promise<DiscardChoice> {
    if (window.confirm(`Save the changes to “${projectName}” first?\n\nOK saves them. Cancel lets you discard them.`)) return 'save'
    return window.confirm("Discard your unsaved changes?\n\nThey will be lost.") ? 'discard' : 'cancel'
  },

  async confirm(options) {
    return window.confirm(confirmText(options))
  },

  setDirty(isDirty) {
    dirty = isDirty
  },

  async exportDialog(suggestedName) {
    const name = withJsonExtension(fileNameOf(suggestedName) || 'game.json', '.json')
    if (hasFsAccess) {
      try {
        const handle = await fsWindow.showSaveFilePicker!({ suggestedName: name, types: EXPORT_TYPES, id: 'skein-export' })
        const key = newKey(withJsonExtension(handle.name, '.json'))
        handles.set(key, handle)
        return key
      } catch (err) {
        if (isAbort(err)) return null
        throw err
      }
    }
    const key = `${DOWNLOAD_PREFIX}/${name}`
    downloads.add(key)
    return key
  },

  exportWrite(path, text) {
    return writeText(path, text)
  },

  onMenuCommand(callback) {
    menuListeners.add(callback)
    return () => menuListeners.delete(callback)
  },

  onExternalChange(callback) {
    externalListeners.add(callback)
    return () => externalListeners.delete(callback)
  }
}
