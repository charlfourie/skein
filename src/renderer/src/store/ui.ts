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
}

export const useUi = create<UiState>((set) => ({
  exportOpen: false,
  setExportOpen: (exportOpen) => set({ exportOpen }),
  leftTab: 'explorer',
  leftRequest: 0,
  showLeft: (leftTab) => set((s) => ({ leftTab, leftRequest: s.leftRequest + 1 })),
  setLeftTab: (leftTab) => set({ leftTab }),
  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen })
}))
