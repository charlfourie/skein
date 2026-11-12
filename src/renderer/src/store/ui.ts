import { create } from 'zustand'

export type LeftTab = 'explorer' | 'search' | 'problems'

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
  lineFocus: { nodeId: string; nonce: number } | null
  focusLine(nodeId: string): void
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
  focusLine: (nodeId) => set((s) => ({ lineFocus: { nodeId, nonce: (s.lineFocus?.nonce ?? 0) + 1 } })),
  reveal: null,
  revealNode: (nodeId) => set((s) => ({ reveal: { nodeId, nonce: (s.reveal?.nonce ?? 0) + 1 } }))
}))
