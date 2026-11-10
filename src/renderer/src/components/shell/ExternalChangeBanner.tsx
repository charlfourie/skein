import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { reloadFromDisk, saveProject } from '../../lib/projectIO'
import { selectDirty, useProjectStore } from '../../store/projectStore'
import { Button } from '../ui/Button'

/**
 * Shown when the open file changes on disk outside Skein — typically a
 * `git pull`, or a teammate's copy landing in a shared folder.
 */
export function ExternalChangeBanner() {
  const change = useProjectStore((s) => s.externalChange)
  const dirty = useProjectStore(selectDirty)
  const dismiss = () => useProjectStore.getState().setExternalChange(null)

  const reload = async () => {
    if (dirty) {
      const ok = await window.api.confirm({
        message: 'Reload the project from disk?',
        detail: 'Your unsaved changes in Skein will be discarded and replaced with the version on disk.',
        confirmLabel: 'Reload',
        danger: true
      })
      if (!ok) return
    }
    await reloadFromDisk()
  }

  return (
    <AnimatePresence initial={false}>
      {change && (
        <motion.div
          key="external-change"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          className="shrink-0 overflow-hidden border-b border-warn/25 bg-warn/[0.08]"
          role="alert"
        >
          <div className="flex items-center gap-3 px-3 py-2">
            <AlertTriangle size={15} className="shrink-0 text-warn" />
            <p className="min-w-0 flex-1 text-xs text-fg">
              {change.deleted ? (
                <>The project file was moved or deleted on disk. Save to write it back.</>
              ) : (
                <>
                  The project file changed on disk (for example, a git pull or a teammate&apos;s copy).
                  {dirty && <span className="text-warn"> You also have unsaved changes here.</span>}
                </>
              )}
            </p>
            {change.deleted ? (
              <Button variant="primary" onClick={() => void saveProject()}>
                Save
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void reload()}>
                Reload from disk
              </Button>
            )}
            <Button variant="ghost" onClick={dismiss}>
              {change.deleted ? 'Dismiss' : 'Keep my version'}
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
