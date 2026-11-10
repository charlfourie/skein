import { AnimatePresence, motion } from 'framer-motion'
import { FilePlus2, FolderOpen, PackageOpen, PanelLeft, PanelRight, Redo2, Save, SaveAll, Undo2, X } from 'lucide-react'
import { closeProject, newProject, openProject, saveProject, saveProjectAs } from '../../lib/projectIO'
import { isMac, shortcut } from '../../lib/platform'
import { selectCanRedo, selectCanUndo, selectDirty, useProjectStore } from '../../store/projectStore'
import { useUi } from '../../store/ui'
import { IconButton } from '../ui/IconButton'
import { Logo } from '../ui/Logo'

interface TopBarProps {
  leftOpen: boolean
  rightOpen: boolean
  onToggleLeft(): void
  onToggleRight(): void
}

export function TopBar({ leftOpen, rightOpen, onToggleLeft, onToggleRight }: TopBarProps) {
  const name = useProjectStore((s) => s.project?.meta.name ?? '')
  const saved = useProjectStore((s) => s.filePath !== null)
  const dirty = useProjectStore(selectDirty)
  const select = useProjectStore((s) => s.select)
  const canUndo = useProjectStore(selectCanUndo)
  const canRedo = useProjectStore(selectCanRedo)
  const undo = useProjectStore((s) => s.undo)
  const redo = useProjectStore((s) => s.redo)

  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b border-line bg-panel px-2">
      <IconButton icon={PanelLeft} label="Toggle explorer" active={leftOpen} onClick={onToggleLeft} />

      <div className="flex min-w-0 items-center gap-2 px-2">
        <Logo size={18} />
        <button
          type="button"
          onClick={() => select({ kind: 'project' })}
          className="truncate rounded px-1 font-semibold text-fg transition-colors hover:bg-raised"
        >
          {name}
        </button>
        <AnimatePresence>
          {dirty && (
            <motion.span
              key="dirty"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 600, damping: 25 }}
              className="h-2 w-2 shrink-0 rounded-full bg-warn"
              title="Unsaved changes"
            />
          )}
        </AnimatePresence>
        {!saved && <span className="shrink-0 rounded bg-raised px-1.5 py-0.5 text-2xs text-muted">Not saved yet</span>}
      </div>

      <div className="flex-1" />

      <IconButton icon={Undo2} label={`Undo (${shortcut('Z')})`} disabled={!canUndo} onClick={undo} />
      <IconButton icon={Redo2} label={`Redo (${isMac ? shortcut('Z', true) : 'Ctrl+Y'})`} disabled={!canRedo} onClick={redo} />
      <div className="mx-1 h-5 w-px bg-line" />

      <IconButton icon={FilePlus2} label={`New project (${shortcut('N')})`} onClick={() => void newProject()} />
      <IconButton icon={FolderOpen} label={`Open project (${shortcut('O')})`} onClick={() => void openProject()} />
      <IconButton
        icon={Save}
        label={`Save (${shortcut('S')})`}
        tone={dirty ? 'accent' : 'default'}
        onClick={() => void saveProject()}
      />
      <IconButton icon={SaveAll} label={`Save as… (${shortcut('S', true)})`} onClick={() => void saveProjectAs()} />
      <IconButton icon={PackageOpen} label={`Export for game engine (${shortcut('E')})`} onClick={() => useUi.getState().setExportOpen(true)} />
      <IconButton icon={X} label="Close project" onClick={() => void closeProject()} />
      <div className="mx-1 h-5 w-px bg-line" />
      <IconButton icon={PanelRight} label="Toggle inspector" active={rightOpen} onClick={onToggleRight} />
    </header>
  )
}
