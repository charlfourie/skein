import type { ExportFile } from '@shared/export/types'
import { explore, type ExploreOptions, type ExploreReport } from '@shared/play/explore'

export interface ExploreRun {
  promise: Promise<ExploreReport>
  cancel(): void
}

/**
 * Explore in a worker when the platform allows it; otherwise on this thread,
 * after a frame so the "running" state can paint first.
 */
export function runExplore(file: ExportFile, options: Omit<ExploreOptions, 'onProgress'>, onProgress: (paths: number) => void): ExploreRun {
  let worker: Worker | null = null
  try {
    worker = new Worker(new URL('./explore.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    worker = null
  }
  if (worker) {
    const w = worker
    let settle: { resolve(r: ExploreReport): void; reject(e: Error): void } | null = null
    const promise = new Promise<ExploreReport>((resolve, reject) => {
      settle = { resolve, reject }
      w.onmessage = (e: MessageEvent<{ kind: string; paths?: number; report?: ExploreReport; message?: string }>) => {
        if (e.data.kind === 'progress') onProgress(e.data.paths ?? 0)
        else if (e.data.kind === 'done') {
          resolve(e.data.report!)
          w.terminate()
        } else {
          reject(new Error(e.data.message ?? 'Exploring failed'))
          w.terminate()
        }
      }
      // A worker that can't load (e.g. a restrictive file:// origin) falls back to this thread.
      w.onerror = (ev) => {
        ev.preventDefault()
        w.terminate()
        inline(file, options).then(resolve, reject)
      }
      w.postMessage({ file, options })
    })
    return {
      promise,
      cancel: () => {
        w.terminate()
        settle?.reject(new Error('cancelled'))
      }
    }
  }
  let cancelled = false
  return {
    promise: new Promise((resolve, reject) =>
      setTimeout(() => (cancelled ? reject(new Error('cancelled')) : inline(file, options).then(resolve, reject)), 30)
    ),
    cancel: () => {
      cancelled = true
    }
  }
}

function inline(file: ExportFile, options: Omit<ExploreOptions, 'onProgress'>): Promise<ExploreReport> {
  try {
    return Promise.resolve(explore(file, options))
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)))
  }
}
