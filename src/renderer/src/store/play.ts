import { create } from 'zustand'
import type { ExportValue } from '@shared/export/types'
import type { StateKey } from '@shared/play/explore'
import type { PlaySession } from '../lib/playSession'

/**
 * Play panel state that other parts of the editor read (never saved):
 * which flow is being played, the node the story is on and the nodes it has
 * passed through (for highlighting on the canvas), and the starting-state
 * overrides the designer set up for testing.
 */
interface PlayState {
  open: boolean
  flowId: string | null
  tab: 'play' | 'explore' | 'start'
  current: string | null
  visited: ReadonlySet<string>
  /** Starting values to test with, by state key ("var:World.Storm"). Kept per project session. */
  overrides: Record<StateKey, ExportValue>
  startDay: number | null
  startPhase: string | null
  /** Explore tab: variables to vary ("both", "all", or a list of numbers like "0, 3, 5"), and the path cap. */
  vary: Record<StateKey, string>
  maxPaths: number
  /** Play tab: keep the canvas centred on the current node. */
  follow: boolean
  /** The current play-through (lives here so it survives switching to another flow's canvas). */
  session: PlaySession | null
  /** Bumped whenever the session changes, so components re-render. */
  version: number
  setSession(session: PlaySession | null): void
  touch(): void
  openFor(flowId: string, tab?: PlayState['tab']): void
  close(): void
  setTab(tab: PlayState['tab']): void
  setPosition(current: string | null, visited: ReadonlySet<string>): void
  setOverride(key: StateKey, value: ExportValue | undefined): void
  setStartTime(day: number | null, phase: string | null): void
  resetStart(): void
  setVary(key: StateKey, spec: string | undefined): void
  setMaxPaths(n: number): void
  setFollow(follow: boolean): void
}

const EMPTY: ReadonlySet<string> = new Set()

export const usePlay = create<PlayState>((set) => ({
  open: false,
  flowId: null,
  tab: 'play',
  current: null,
  visited: EMPTY,
  overrides: {},
  startDay: null,
  startPhase: null,
  vary: {},
  maxPaths: 20000,
  follow: true,
  session: null,
  version: 0,
  setSession: (session) =>
    set((s) => ({ session, version: s.version + 1, current: session?.currentNodeId ?? null, visited: new Set(session?.visited ?? []) })),
  touch: () =>
    set((s) => ({ version: s.version + 1, current: s.session?.currentNodeId ?? null, visited: new Set(s.session?.visited ?? []) })),
  openFor: (flowId, tab) => set((s) => ({ open: true, flowId, tab: tab ?? s.tab, ...(s.flowId !== flowId ? { current: null, visited: EMPTY } : {}) })),
  close: () => set({ open: false, current: null, visited: EMPTY, session: null }),
  setTab: (tab) => set({ tab }),
  setPosition: (current, visited) => set({ current, visited }),
  setOverride: (key, value) =>
    set((s) => {
      const overrides = { ...s.overrides }
      if (value === undefined) delete overrides[key]
      else overrides[key] = value
      return { overrides }
    }),
  setStartTime: (startDay, startPhase) => set({ startDay, startPhase }),
  resetStart: () => set({ overrides: {}, startDay: null, startPhase: null }),
  setVary: (key, spec) =>
    set((s) => {
      const vary = { ...s.vary }
      if (spec === undefined || spec.trim() === '') delete vary[key]
      else vary[key] = spec
      return { vary }
    }),
  setMaxPaths: (maxPaths) => set({ maxPaths }),
  setFollow: (follow) => set({ follow })
}))

/** How a canvas node should be marked while its flow is being played. */
export function usePlayMark(flowId: string, nodeId: string): 'current' | 'visited' | null {
  return usePlay((s) => (s.open && s.flowId === flowId ? (s.current === nodeId ? 'current' : s.visited.has(nodeId) ? 'visited' : null) : null))
}
