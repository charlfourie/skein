/// <reference lib="webworker" />
import { runStoryTests } from '@shared/play/storyTests'
import type { Project } from '@shared/schema'

/** Runs story tests off the main thread, so re-checking after an edit never stalls the editor. */
const scope = self as unknown as DedicatedWorkerGlobalScope

scope.onmessage = (e: MessageEvent<{ project: Project }>) => {
  try {
    scope.postMessage({ kind: 'done', results: runStoryTests(e.data.project) })
  } catch (err) {
    scope.postMessage({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
