import { useEffect } from 'react'
import { closeProject, newProject, openProject, openProjectFile, saveProject, saveProjectAs } from '../lib/projectIO'
import { selectDirty, useProjectStore } from '../store/projectStore'
import { useUi } from '../store/ui'

function isTextEditing(el: Element | null): boolean {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly
  if (el instanceof HTMLInputElement) {
    return !el.readOnly && !['checkbox', 'radio', 'button', 'submit', 'color', 'range', 'file'].includes(el.type)
  }
  return el instanceof HTMLElement && el.isContentEditable
}

/** Text fields keep their own native undo; everywhere else undo walks the project history. */
function runHistoryCommand(command: 'undo' | 'redo'): void {
  if (isTextEditing(document.activeElement)) {
    document.execCommand(command)
    return
  }
  const s = useProjectStore.getState()
  if (command === 'undo') s.undo()
  else s.redo()
}

/** Wires keyboard commands, external-change notices and the tab's title and unsaved-changes guard. */
export function useAppCommands(): void {
  useEffect(() => {
    const offMenu = window.api.onMenuCommand((command) => {
      const hasProject = useProjectStore.getState().project !== null
      switch (command) {
        case 'new':
          void newProject()
          break
        case 'open':
          void openProject()
          break
        case 'open-file':
          void openProjectFile()
          break
        case 'save':
          if (hasProject) void saveProject()
          break
        case 'save-as':
          if (hasProject) void saveProjectAs()
          break
        case 'close-project':
          if (hasProject) void closeProject()
          break
        case 'export':
          if (hasProject) useUi.getState().setExportOpen(true)
          break
        case 'undo':
        case 'redo':
          if (hasProject) runHistoryCommand(command)
          break
      }
    })

    const onKeyDown = (e: KeyboardEvent) => {
      const mod = window.api.platform === 'darwin' ? e.metaKey : e.ctrlKey
      // Ctrl+Shift+Z is the other common Redo shortcut on Windows/Linux.
      if (window.api.platform !== 'darwin' && e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        runHistoryCommand('redo')
      }
      // Ctrl+F: search the project (instead of the browser's find-in-page, which can't see the canvas).
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f' && useProjectStore.getState().project) {
        e.preventDefault()
        useUi.getState().showLeft('search')
      }
      // ?: the keyboard shortcuts, when not typing.
      if (e.key === '?' && !isTextEditing(document.activeElement) && !mod) {
        e.preventDefault()
        useUi.getState().setShortcutsOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)

    const offExternal = window.api.onExternalChange((change) => {
      const s = useProjectStore.getState()
      if (s.filePath && change.path === s.filePath) s.setExternalChange(change)
    })

    return () => {
      offMenu()
      offExternal()
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const dirty = useProjectStore(selectDirty)
  const name = useProjectStore((s) => s.project?.meta.name ?? null)

  useEffect(() => {
    window.api.setDirty(dirty, name)
    document.title = name ? `${dirty ? '● ' : ''}${name} — Skein` : 'Skein'
  }, [dirty, name])
}
