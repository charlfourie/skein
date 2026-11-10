import { create } from 'zustand'

/** Per-machine canvas preferences (localStorage; never in the project file). */
interface CanvasPrefs {
  animateEdges: boolean
  snapToGrid: boolean
  set(patch: Partial<Pick<CanvasPrefs, 'animateEdges' | 'snapToGrid'>>): void
}

const KEY = 'skein.canvasPrefs.v1'

function load(): Partial<CanvasPrefs> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<CanvasPrefs>
  } catch {
    return {}
  }
}

const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export const usePrefs = create<CanvasPrefs>((set, get) => ({
  animateEdges: !reducedMotion,
  snapToGrid: true,
  ...(typeof localStorage !== 'undefined' ? load() : {}),
  set: (patch) => {
    set(patch)
    try {
      const { animateEdges, snapToGrid } = get()
      localStorage.setItem(KEY, JSON.stringify({ animateEdges, snapToGrid }))
    } catch {
      // Storage unavailable: preferences just won't persist.
    }
  }
}))
