import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { ExportDialog } from './components/export/ExportDialog'
import { ScenePasteDialog } from './components/script/ScenePasteDialog'
import { ShortcutsSheet } from './components/shell/ShortcutsSheet'
import { Shell } from './components/shell/Shell'
import { Toaster } from './components/ui/Toaster'
import { Welcome } from './components/Welcome'
import { useAppCommands } from './hooks/useAppCommands'
import { useProjectStore } from './store/projectStore'

export default function App() {
  useAppCommands()
  // Key on the project id so opening a different project remounts the shell cleanly.
  const projectId = useProjectStore((s) => s.project?.meta.id ?? null)

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={projectId ?? 'welcome'}
          className="h-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {projectId ? <Shell /> : <Welcome />}
        </motion.div>
      </AnimatePresence>
      <ExportDialog />
      <ScenePasteDialog />
      <ShortcutsSheet />
      <Toaster />
    </MotionConfig>
  )
}
