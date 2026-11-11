import { useEffect } from 'react'
import { create } from 'zustand'
import { runStoryTests, type TestResult } from '@shared/play/storyTests'
import type { Project } from '@shared/schema'
import { useProjectStore } from './projectStore'

/**
 * Story test results for the open project. Tests re-run in the background a
 * moment after the designer stops editing; `checked` is the project snapshot
 * the results belong to, so the UI can tell fresh results from ones being redone.
 */
interface TestsState {
  results: Record<string, TestResult>
  checked: Project | null
  running: boolean
  error: string | null
}

export const useTests = create<TestsState>(() => ({ results: {}, checked: null, running: false, error: null }))

/** How long after the last edit tests re-run. */
const SETTLE_MS = 600

/** Mount once (in the Shell): keeps `useTests` up to date with the open project. */
export function useStoryTestRunner(): void {
  const project = useProjectStore((s) => s.project)
  useEffect(() => {
    if (!project) {
      useTests.setState({ results: {}, checked: null, running: false, error: null })
      return
    }
    if (!project.tests || Object.keys(project.tests).length === 0) {
      useTests.setState({ results: {}, checked: project, running: false, error: null })
      return
    }
    useTests.setState({ running: true })
    let cancel = () => {}
    const timer = setTimeout(() => {
      cancel = run(project, (results) => useTests.setState({ results: byId(results), checked: project, running: false, error: null }), (message) =>
        useTests.setState({ running: false, error: message, checked: project })
      )
    }, SETTLE_MS)
    return () => {
      clearTimeout(timer)
      cancel()
    }
  }, [project])
}

/** Run now (e.g. right after saving a test), without waiting for the editor to settle. */
export function runTestsNow(project: Project): void {
  useTests.setState({ results: byId(runStoryTests(project)), checked: project, running: false, error: null })
}

function byId(list: TestResult[]): Record<string, TestResult> {
  return Object.fromEntries(list.map((r) => [r.testId, r]))
}

/** In a worker when the platform allows it; otherwise on this thread. Returns a cancel function. */
function run(project: Project, done: (r: TestResult[]) => void, fail: (message: string) => void): () => void {
  let worker: Worker | null = null
  try {
    worker = new Worker(new URL('../lib/storyTests.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    worker = null
  }
  const inline = () => {
    try {
      done(runStoryTests(project))
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err))
    }
  }
  if (!worker) {
    inline()
    return () => {}
  }
  const w = worker
  let over = false
  w.onmessage = (e: MessageEvent<{ kind: string; results?: TestResult[]; message?: string }>) => {
    over = true
    w.terminate()
    if (e.data.kind === 'done') done(e.data.results ?? [])
    else fail(e.data.message ?? 'The story tests could not run.')
  }
  // A worker that can't load (e.g. a restrictive file:// origin) falls back to this thread.
  w.onerror = (ev) => {
    ev.preventDefault()
    w.terminate()
    if (!over) inline()
    over = true
  }
  w.postMessage({ project })
  return () => {
    over = true
    w.terminate()
  }
}
