import { AlertTriangle, FolderTree, Search } from 'lucide-react'
import type { Project } from '@shared/schema'
import { cx } from '../../lib/cx'
import { shortcut } from '../../lib/platform'
import { useProjectStore } from '../../store/projectStore'
import { useTests } from '../../store/tests'
import { useUi, type LeftTab } from '../../store/ui'
import { NavTree } from '../nav/NavTree'
import { ProblemsPanel, useProblems } from '../problems/ProblemsPanel'
import { SearchPanel } from '../search/SearchPanel'

/** The left panel: the explorer, project-wide search, or the problems list. */
export function LeftPanel() {
  const project = useProjectStore((s) => s.project) as Project
  const tab = useUi((s) => s.leftTab)
  const setTab = useUi((s) => s.setLeftTab)
  const tests = useTests((s) => s.results)
  const problems = useProblems(project, tests)
  const errors = problems.some((p) => p.level === 'error')

  const tabs: { id: LeftTab; label: string; icon: typeof Search; badge?: number }[] = [
    { id: 'explorer', label: 'Explorer', icon: FolderTree },
    { id: 'search', label: `Search (${shortcut('F')})`, icon: Search },
    { id: 'problems', label: 'Problems', icon: AlertTriangle, badge: problems.length }
  ]

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-0.5 px-1.5" role="tablist" aria-label="Left panel">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            title={t.label}
            onClick={() => (t.id === 'search' ? useUi.getState().showLeft('search') : setTab(t.id))}
            className={cx(
              'flex h-7 items-center gap-1.5 rounded-md px-2 text-2xs font-semibold uppercase tracking-wider transition-colors',
              tab === t.id ? 'bg-raised text-fg' : 'text-faint hover:text-muted'
            )}
          >
            <t.icon size={12} />
            {tab === t.id && <span>{t.label.replace(/ \(.*\)$/, '')}</span>}
            {t.badge ? (
              <span className={cx('rounded px-1 text-[10px] tabular-nums', errors ? 'bg-danger/15 text-danger' : 'bg-warn/15 text-warn')}>{t.badge}</span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'explorer' && <NavTree />}
        {tab === 'search' && <SearchPanel project={project} />}
        {tab === 'problems' && <ProblemsPanel project={project} />}
      </div>
    </div>
  )
}
