import { motion } from 'framer-motion'
import { FilePlus2, FileWarning, FolderOpen, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { RecentProject } from '@shared/ipc'
import { newProject, openProject } from '../lib/projectIO'
import { dirname, shortcut } from '../lib/platform'
import { Logo } from './ui/Logo'

export function Welcome() {
  const [recent, setRecent] = useState<RecentProject[] | null>(null)

  useEffect(() => {
    let live = true
    void window.api.listRecent().then((list) => live && setRecent(list))
    return () => {
      live = false
    }
  }, [])

  const removeRecent = async (path: string) => {
    await window.api.removeRecent(path)
    setRecent((list) => list?.filter((r) => r.path !== path) ?? null)
  }

  return (
    <div className="relative grid h-full place-items-center overflow-y-auto bg-bg">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle at 50% 30%, rgb(var(--c-accent) / 0.12), transparent 55%), radial-gradient(rgb(255 255 255 / 0.05) 1px, transparent 1px)',
          backgroundSize: '100% 100%, 22px 22px'
        }}
      />

      <motion.main
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 30 }}
        className="relative w-[560px] max-w-[calc(100%-32px)] py-10"
      >
        <div className="flex items-center gap-3">
          <Logo size={36} />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Skein</h1>
            <p className="text-xs text-muted">Narrative design, stored as plain files you own.</p>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3">
          <ActionCard
            icon={FilePlus2}
            title="New project"
            hint={shortcut('N')}
            onClick={() => void newProject()}
            delay={0.05}
          />
          <ActionCard
            icon={FolderOpen}
            title="Open project…"
            hint={shortcut('O')}
            onClick={() => void openProject()}
            delay={0.1}
          />
        </div>

        <section className="mt-8">
          <h2 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-faint">Recent</h2>
          {recent === null ? null : recent.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-faint">
              Projects you open or save will appear here.
            </p>
          ) : (
            <ul className="overflow-hidden rounded-lg border border-line bg-panel/70">
              {recent.map((item, i) => (
                <motion.li
                  key={item.path}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.12 + i * 0.03 }}
                  className="group flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0 hover:bg-raised/60"
                >
                  <button
                    type="button"
                    disabled={!item.exists}
                    onClick={() => void openProject(item.path)}
                    className="flex min-w-0 flex-1 flex-col items-start text-left disabled:cursor-not-allowed"
                  >
                    <span className="flex items-center gap-1.5 truncate font-medium text-fg">
                      {!item.exists && <FileWarning size={13} className="shrink-0 text-warn" />}
                      <span className={item.exists ? '' : 'text-muted line-through decoration-faint'}>{item.name}</span>
                    </span>
                    <span className="w-full truncate font-mono text-2xs text-faint" title={item.path}>
                      {item.exists ? dirname(item.path) : 'File not found: ' + item.path}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeRecent(item.path)}
                    aria-label={`Remove ${item.name} from recent`}
                    className="grid h-6 w-6 place-items-center rounded text-faint opacity-0 transition hover:bg-raised hover:text-fg group-hover:opacity-100"
                  >
                    <X size={13} />
                  </button>
                </motion.li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-8 text-xs leading-relaxed text-faint">
          No accounts, no cloud. A project is a single <code className="font-mono text-muted">.skein.json</code> file.
          Share it through git, a shared drive or email. Skein writes it deterministically (sorted keys, stable ids), so
          teammates&apos; changes merge as small, readable diffs.
        </p>
      </motion.main>
    </div>
  )
}

function ActionCard({
  icon: Icon,
  title,
  hint,
  onClick,
  delay
}: {
  icon: typeof FilePlus2
  title: string
  hint: string
  onClick(): void
  delay: number
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, type: 'spring', stiffness: 400, damping: 30 }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      className="group flex flex-col gap-6 rounded-xl border border-line bg-panel/80 p-4 text-left transition-colors hover:border-accent/50 hover:bg-raised/70 focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <Icon size={20} strokeWidth={1.6} className="text-accent transition-transform group-hover:scale-110" />
      <span className="flex items-end justify-between">
        <span className="font-medium text-fg">{title}</span>
        <kbd className="rounded bg-bg px-1.5 py-0.5 font-mono text-2xs text-faint">{hint}</kbd>
      </span>
    </motion.button>
  )
}
