/// <reference lib="webworker" />
import type { ExportFile } from '@shared/export/types'
import { explore, type ExploreOptions } from '@shared/play/explore'

/** Runs the path explorer off the main thread so big flows don't freeze the editor. */
const scope = self as unknown as DedicatedWorkerGlobalScope

scope.onmessage = (e: MessageEvent<{ file: ExportFile; options: Omit<ExploreOptions, 'onProgress'> }>) => {
  const { file, options } = e.data
  try {
    const report = explore(file, { ...options, onProgress: (paths) => scope.postMessage({ kind: 'progress', paths }) })
    scope.postMessage({ kind: 'done', report })
  } catch (err) {
    scope.postMessage({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
