import { create } from 'zustand'

/** Transient UI state shared across components (never saved). */
interface UiState {
  exportOpen: boolean
  setExportOpen(open: boolean): void
}

export const useUi = create<UiState>((set) => ({
  exportOpen: false,
  setExportOpen: (exportOpen) => set({ exportOpen })
}))
