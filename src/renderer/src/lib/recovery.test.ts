import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyProject } from '@shared/factory'
import { renameItem } from '../store/ops'
import { useProjectStore } from '../store/projectStore'
import { holdRecovery, listRecovery, memoryBackend, readRecovered, RECOVERY_DELAY_MS, startRecovery } from './recovery'

const s = () => useProjectStore.getState()
const firstFlow = () => Object.keys(s().project!.flows)[0]

let backend: ReturnType<typeof memoryBackend>
let watcher: ReturnType<typeof startRecovery>

beforeEach(() => {
  vi.useFakeTimers()
  s().closeProject()
  backend = memoryBackend()
  watcher = startRecovery(backend)
})
afterEach(() => {
  watcher.stop()
  vi.useRealTimers()
})

describe('recovery copies', () => {
  it('keeps a copy a moment after a change, and drops it once saved', async () => {
    s().loadProject(createEmptyProject('Rescue'), '/p/Rescue.skein/project.json')
    const id = s().project!.meta.id
    await watcher.flush()
    expect(backend.records.size).toBe(0) // nothing unsaved yet

    renameItem('flow', firstFlow(), 'Opening')
    expect(backend.records.size).toBe(0)
    await vi.advanceTimersByTimeAsync(RECOVERY_DELAY_MS)
    const record = backend.records.get(id)!
    expect(record).toMatchObject({ name: 'Rescue', path: '/p/Rescue.skein/project.json' })
    expect(record.project).toBe(s().project)

    s().markSaved('/p/Rescue.skein/project.json', s().project!)
    await watcher.flush()
    expect(backend.records.size).toBe(0)
  })

  it('drops the copy when changes are undone, or discarded by closing', async () => {
    s().loadProject(createEmptyProject('Undo'), null)
    renameItem('flow', firstFlow(), 'A')
    await watcher.flush()
    expect(backend.records.size).toBe(1)
    s().undo()
    await watcher.flush()
    expect(backend.records.size).toBe(0)

    renameItem('flow', firstFlow(), 'B')
    await watcher.flush()
    expect(backend.records.size).toBe(1)
    s().closeProject()
    await watcher.flush()
    expect(backend.records.size).toBe(0)
  })

  it('never replaces a held copy, and catches up once released', async () => {
    s().loadProject(createEmptyProject('Held'), null)
    const id = s().project!.meta.id
    backend.records.set(id, { projectId: id, name: 'Held', path: null, savedAt: '2026-01-01T00:00:00.000Z', project: s().project! })
    const release = holdRecovery(id)
    renameItem('flow', firstFlow(), 'New')
    await vi.advanceTimersByTimeAsync(RECOVERY_DELAY_MS * 3)
    expect(backend.records.get(id)!.savedAt).toBe('2026-01-01T00:00:00.000Z')
    release()
    await vi.advanceTimersByTimeAsync(RECOVERY_DELAY_MS)
    expect(backend.records.get(id)!.savedAt).not.toBe('2026-01-01T00:00:00.000Z')
  })

  it('lists copies newest first, forgets old ones, and reads them back as projects', async () => {
    const p = createEmptyProject('Old')
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'))
    backend.records.set('a', { projectId: 'a', name: 'A', path: null, savedAt: '2026-05-31T10:00:00.000Z', project: p })
    backend.records.set('b', { projectId: 'b', name: 'B', path: null, savedAt: '2026-06-01T10:00:00.000Z', project: p })
    backend.records.set('c', { projectId: 'c', name: 'C', path: null, savedAt: '2026-01-01T10:00:00.000Z', project: p })
    const list = await listRecovery()
    expect(list.map((r) => r.name)).toEqual(['B', 'A'])
    expect(backend.records.has('c')).toBe(false)
    const read = readRecovered(list[0])
    expect(read.ok && read.project.meta.name).toBe('Old')
  })
})

describe('restoring', () => {
  it('reopens the saved project and puts the changes back as one undoable step', async () => {
    const { serializeProject } = await import('@shared/serialize')
    const saved = createEmptyProject('Saved')
    const path = '/p/Saved.skein.json'
    const changed = JSON.parse(serializeProject(saved))
    const flowId = Object.keys(changed.flows)[0]
    changed.flows[flowId].name = 'Recovered name'
    const confirm = vi.fn(async () => true)
    vi.stubGlobal('window', {
      api: {
        readProject: async (p: string) => ({ ok: true, path: p, text: serializeProject(saved) }),
        touchRecent: async () => undefined,
        confirm,
        confirmDiscard: async () => 'discard'
      }
    })
    try {
      const { restoreRecovery } = await import('./projectIO') // reads window.api at import time
      const ok = await restoreRecovery({ projectId: saved.meta.id, name: 'Saved', path, savedAt: new Date().toISOString(), project: changed })
      expect(ok).toBe(true)
      expect(confirm).not.toHaveBeenCalled() // restoring from the start screen doesn't ask again
      expect(s().filePath).toBe(path)
      expect(s().project!.flows[flowId].name).toBe('Recovered name')
      s().undo()
      expect(s().project!.flows[flowId].name).toBe(saved.flows[flowId].name)
      expect(s().project).toBe(s().savedProject) // back to exactly the saved files
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
