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
  tab: 'play' | 'explore' | 'start' | 'tests'
  current: string | null
  visited: ReadonlySet<string>
  /** Starting values to test with, by state key ("var:World.Storm"). Kept per project session. */
  overrides: Record<StateKey, ExportValue>
  startDay: number | null
  startPhase: string | null
  /** Seed for chance() and roll() (null: the runtime's default seed). */
  seed: number | null
  /** The saved scenario last loaded into the Start state tab (it may have been edited since). */
  scenarioId: string | null
  /** Explore tab: variables to vary ("both", "all", or a list of numbers like "0, 3, 5"), and the path cap. */
  vary: Record<StateKey, string>
  maxPaths: number
  /** Play tab: keep the canvas centred on the current node. */
  follow: boolean
  /** Play tab: the start node to begin at, for a flow with several (null: the first available, as the game does). */
  startNodeId: string | null
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
  setSeed(seed: number | null): void
  resetStart(): void
  setVary(key: StateKey, spec: string | undefined): void
  setMaxPaths(n: number): void
  setFollow(follow: boolean): void
  setStartNode(startNodeId: string | null): void
  /** Forget the play-through and test settings (a project closed or another one opened). */
  reset(): void
}

const EMPTY: ReadonlySet<string> = new Set()

/** Everything about a play-through that belongs to one project (cleared when a project closes or another opens). */
const PER_PROJECT = {
  open: false,
  flowId: null,
  tab: 'play',
  current: null,
  visited: EMPTY,
  overrides: {},
  startDay: null,
  startPhase: null,
  seed: null,
  scenarioId: null,
  vary: {},
  startNodeId: null,
  session: null
} as const satisfies Partial<PlayState>

export const usePlay = create<PlayState>((set) => ({
  open: false,
  flowId: null,
  tab: 'play',
  current: null,
  visited: EMPTY,
  overrides: {},
  startDay: null,
  startPhase: null,
  seed: null,
  scenarioId: null,
  vary: {},
  maxPaths: 20000,
  follow: true,
  startNodeId: null,
  session: null,
  version: 0,
  setSession: (session) =>
    set((s) => ({ session, version: s.version + 1, current: session?.currentNodeId ?? null, visited: new Set(session?.visited ?? []) })),
  touch: () =>
    set((s) => ({ version: s.version + 1, current: s.session?.currentNodeId ?? null, visited: new Set(s.session?.visited ?? []) })),
  openFor: (flowId, tab) => set((s) => ({ open: true, flowId, tab: tab ?? s.tab, ...(s.flowId !== flowId ? { current: null, visited: EMPTY, startNodeId: null } : {}) })),
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
  setSeed: (seed) => set({ seed }),
  reset: () => set((s) => ({ ...PER_PROJECT, version: s.version + 1 })),
  resetStart: () => set({ overrides: {}, startDay: null, startPhase: null, seed: null, scenarioId: null }),
  setVary: (key, spec) =>
    set((s) => {
      const vary = { ...s.vary }
      if (spec === undefined || spec.trim() === '') delete vary[key]
      else vary[key] = spec
      return { vary }
    }),
  setMaxPaths: (maxPaths) => set({ maxPaths }),
  setFollow: (follow) => set({ follow }),
  setStartNode: (startNodeId) => set({ startNodeId })
}))

/** How a canvas node should be marked while its flow is being played. */
export function usePlayMark(flowId: string, nodeId: string): 'current' | 'visited' | null {
  return usePlay((s) => (s.open && s.flowId === flowId ? (s.current === nodeId ? 'current' : s.visited.has(nodeId) ? 'visited' : null) : null))
}
