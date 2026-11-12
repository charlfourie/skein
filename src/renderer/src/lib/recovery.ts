/**
 * Recovery copies: while a project has unsaved changes, a copy of it is kept in
 * the browser's own storage, so a crash, a closed tab or a flat battery doesn't
 * lose the work. It is never written to the project files: the next visit
 * offers to restore it (over the saved files, as one undoable step) or discard it.
 *
 * Copies are kept per project, deleted once that project is saved or its
 * changes are discarded, and dropped after RECOVERY_MAX_AGE_DAYS. Opening a
 * project that has a copy asks first, so a new copy never silently replaces it.
 */
import { parseProject } from '@shared/parse'
import type { Project } from '@shared/schema'
import { selectDirty, useProjectStore } from '../store/projectStore'

export interface RecoveryRecord {
  projectId: string
  name: string
  /** Where the project was saved, or null if it never was. */
  path: string | null
  /** ISO time of the copy. */
  savedAt: string
  project: Project
}

/** Where copies live. IndexedDB in the browser; a Map in tests. */
export interface RecoveryBackend {
  list(): Promise<RecoveryRecord[]>
  put(record: RecoveryRecord): Promise<void>
  remove(projectId: string): Promise<void>
}

export const RECOVERY_DELAY_MS = 2000
export const RECOVERY_MAX_AGE_DAYS = 30

// ---- IndexedDB backend (its own database, so it never touches Recent) ----

const DB = 'skein-recovery'
const STORE = 'copies'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'projectId' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export const indexedDbBackend: RecoveryBackend = {
  list: () => run<RecoveryRecord[]>('readonly', (s) => s.getAll() as IDBRequest<RecoveryRecord[]>),
  put: (record) => run('readwrite', (s) => s.put(record)).then(() => undefined),
  remove: (projectId) => run('readwrite', (s) => s.delete(projectId)).then(() => undefined)
}

export function memoryBackend(): RecoveryBackend & { records: Map<string, RecoveryRecord> } {
  const records = new Map<string, RecoveryRecord>()
  return {
    records,
    list: async () => [...records.values()],
    put: async (r) => void records.set(r.projectId, r),
    remove: async (id) => void records.delete(id)
  }
}

// ---- Keeping copies up to date ----

let backend: RecoveryBackend = indexedDbBackend
/** Copy writes are best-effort: storage can be full or blocked (private windows). */
let failedOnce = false
/**
 * Projects whose earlier copy is waiting on a decision (restore or discard):
 * no new copy may replace it until then.
 */
const held = new Set<string>()

async function safely(op: () => Promise<void>): Promise<void> {
  try {
    await op()
  } catch (err) {
    if (!failedOnce) console.warn('Skein: could not keep a recovery copy', err)
    failedOnce = true
  }
}

/** Keep an existing copy of this project safe while its owner decides what to do with it. */
export function holdRecovery(projectId: string): () => void {
  held.add(projectId)
  return () => void held.delete(projectId)
}

/**
 * Start watching the project store. Returns a stop function (and `flush`, for
 * tests and for leaving the page). Call once at startup.
 */
export function startRecovery(using: RecoveryBackend = indexedDbBackend): { stop(): void; flush(): Promise<void> } {
  backend = using
  let timer: ReturnType<typeof setTimeout> | null = null
  let written: Project | null = null
  let pending: Promise<void> = Promise.resolve()
  const queue = (op: () => Promise<void>) => (pending = pending.then(() => safely(op)))

  const write = (): Promise<void> => {
    if (timer) clearTimeout(timer)
    timer = null
    const s = useProjectStore.getState()
    if (!s.project || !selectDirty(s) || s.project === written) return pending
    const id = s.project.meta.id
    if (held.has(id)) {
      timer = setTimeout(write, RECOVERY_DELAY_MS) // try again once the decision is made
      return pending
    }
    written = s.project
    const record: RecoveryRecord = { projectId: id, name: s.project.meta.name, path: s.filePath, savedAt: new Date().toISOString(), project: s.project }
    return queue(() => backend.put(record))
  }

  const unsubscribe = useProjectStore.subscribe((s, prev) => {
    if (s.project === prev.project && s.savedProject === prev.savedProject) return
    const wasDirty = selectDirty(prev)
    const prevId = prev.project?.meta.id ?? null
    const id = s.project?.meta.id ?? null
    // Its changes were saved, deliberately discarded (closed, or another project
    // opened over it), or undone back to the saved state: the files have it all.
    if (prevId && wasDirty && (prevId !== id || !selectDirty(s)) && !held.has(prevId)) {
      queue(() => backend.remove(prevId))
    }
    if (!selectDirty(s)) {
      if (timer) clearTimeout(timer)
      timer = null
      written = null
      return
    }
    // Throttle, not debounce: steady typing still gets a copy every couple of seconds.
    timer ??= setTimeout(write, RECOVERY_DELAY_MS)
  })

  const onHide = () => {
    if (document.visibilityState === 'hidden') void write()
  }
  const onPageHide = () => void write()
  const hasDocument = typeof document !== 'undefined'
  if (hasDocument) {
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
  }

  return {
    stop() {
      unsubscribe()
      if (timer) clearTimeout(timer)
      if (hasDocument) {
        document.removeEventListener('visibilitychange', onHide)
        window.removeEventListener('pagehide', onPageHide)
      }
    },
    flush: async () => {
      await write()
      await pending
    }
  }
}

/** Copies waiting to be restored, newest first. Old ones are deleted on the way. */
export async function listRecovery(): Promise<RecoveryRecord[]> {
  try {
    const all = await backend.list()
    const cutoff = Date.now() - RECOVERY_MAX_AGE_DAYS * 86_400_000
    const stale = all.filter((r) => Date.parse(r.savedAt) < cutoff)
    for (const r of stale) await backend.remove(r.projectId)
    return all.filter((r) => !stale.includes(r)).sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  } catch {
    return []
  }
}

export async function discardRecovery(projectId: string): Promise<void> {
  await safely(() => backend.remove(projectId))
}

/** The copy waiting for this project, if there is one. */
export async function findRecovery(projectId: string): Promise<RecoveryRecord | null> {
  return (await listRecovery()).find((r) => r.projectId === projectId) ?? null
}

/** Check a copy still reads as a project (and bring it up to the current format). */
export function readRecovered(record: RecoveryRecord): { ok: true; project: Project } | { ok: false; error: string } {
  const parsed = parseProject(JSON.stringify(record.project))
  return parsed.ok ? { ok: true, project: parsed.project } : { ok: false, error: parsed.error }
}
