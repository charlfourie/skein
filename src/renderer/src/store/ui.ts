import { create } from 'zustand'
import type { Position } from '@shared/schema'

export type LeftTab = 'explorer' | 'search' | 'problems'
/** How a flow is shown: the node canvas, or read as a script. */
export type FlowView = 'canvas' | 'script'
/** Where the cursor goes for a new line: the inspector, or the script view. */
export type LineFocusTarget = 'inspector' | 'script'

/** A scene pasted as text, waiting in the preview before it becomes lines. */
export interface ScenePaste {
  flowId: string
  text: string
  /** Where the lines go on the canvas (flow coordinates). */
  at: { x: number; y: number } | Position
  /** A node the first line should follow. */
  after: string | null
}

/** Transient UI state shared across components (never saved). */
interface UiState {
  exportOpen: boolean
  setExportOpen(open: boolean): void
  /** Which view the left panel shows. */
  leftTab: LeftTab
  /** Bumped when something asks for the left panel (so a collapsed panel opens, and Search takes focus). */
  leftRequest: number
  showLeft(tab: LeftTab): void
  setLeftTab(tab: LeftTab): void
  shortcutsOpen: boolean
  setShortcutsOpen(open: boolean): void
  /** Asks the inspector to put the cursor in a node's line (quick line entry). */
  lineFocus: { nodeId: string; nonce: number; where: LineFocusTarget } | null
  focusLine(nodeId: string, where?: LineFocusTarget): void
  flowView: FlowView
  setFlowView(view: FlowView): void
  scenePaste: ScenePaste | null
  setScenePaste(paste: ScenePaste | null): void
  /** Asks the canvas to bring a node into view if it's off screen (keeping the zoom). */
  reveal: { nodeId: string; nonce: number } | null
  revealNode(nodeId: string): void
}

export const useUi = create<UiState>((set) => ({
  exportOpen: false,
  setExportOpen: (exportOpen) => set({ exportOpen }),
  leftTab: 'explorer',
  leftRequest: 0,
  showLeft: (leftTab) => set((s) => ({ leftTab, leftRequest: s.leftRequest + 1 })),
  setLeftTab: (leftTab) => set({ leftTab }),
  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  lineFocus: null,
  focusLine: (nodeId, where = 'inspector') => set((s) => ({ lineFocus: { nodeId, where, nonce: (s.lineFocus?.nonce ?? 0) + 1 } })),
  flowView: 'canvas',
  setFlowView: (flowView) => set({ flowView }),
  scenePaste: null,
  setScenePaste: (scenePaste) => set({ scenePaste }),
  reveal: null,
  revealNode: (nodeId) => set((s) => ({ reveal: { nodeId, nonce: (s.reveal?.nonce ?? 0) + 1 } }))
}))
