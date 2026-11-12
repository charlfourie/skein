import { AlertTriangle, CaseSensitive, ChevronRight, Regex, Replace, ReplaceAll, Search, WholeWord } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import type { Project } from '@shared/schema'
import {
  applyReplace,
  canReplace,
  planReplace,
  SEARCH_CATEGORIES,
  searchProject,
  targetKey,
  type PlannedChange,
  type SearchCategory,
  type SearchMatch,
  type SearchOptions
} from '@shared/search'
import { cx } from '../../lib/cx'
import { goToTarget } from '../../lib/goto'
import { shortcut } from '../../lib/platform'
import { toast } from '../../lib/toast'
import { compareOrder } from '../../lib/tree'
import { useProjectStore } from '../../store/projectStore'
import { useUi } from '../../store/ui'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { Select } from '../ui/fields'

/** The search the panel shows: kept while switching tabs (never saved). */
interface SearchState {
  query: string
  replacement: string
  showReplace: boolean
  matchCase: boolean
  wholeWord: boolean
  regex: boolean
  categories: SearchCategory[]
  flowId: string | null
  speakerId: string | null
  set(patch: Partial<Omit<SearchState, 'set'>>): void
}

export const useSearch = create<SearchState>((set) => ({
  query: '',
  replacement: '',
  showReplace: false,
  matchCase: false,
  wholeWord: false,
  regex: false,
  categories: [...SEARCH_CATEGORIES],
  flowId: null,
  speakerId: null,
  set: (patch) => set(patch)
}))

const CATEGORY_LABELS: Record<SearchCategory, string> = { text: 'Lines', logic: 'Logic', notes: 'Notes', names: 'Names' }

/** The search the panel runs, debounced a little so typing stays smooth on big projects. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * Search the whole project (Ctrl+F), and find and replace. Results are grouped
 * by flow; click one to go there. Replace works on lines, labels, notes,
 * comments and logic (refusing anything that would break an expression).
 */
export function SearchPanel({ project }: { project: Project }) {
  const s = useSearch()
  const leftRequest = useUi((u) => u.leftRequest)
  const input = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<PlannedChange[] | null>(null)
  const query = useDebounced(s.query, 150)

  // Ctrl+F (or the Search tab) puts the cursor in the box, with the old query selected.
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [leftRequest])

  const opts: SearchOptions = useMemo(
    () => ({ query, matchCase: s.matchCase, wholeWord: s.wholeWord, regex: s.regex, categories: s.categories, flowId: s.flowId, speakerId: s.speakerId }),
    [query, s.matchCase, s.wholeWord, s.regex, s.categories, s.flowId, s.speakerId]
  )
  const result = useMemo(() => searchProject(project, opts), [project, opts])
  const groups = useMemo(() => groupByFlow(project, result.matches), [project, result.matches])
  const replaceable = result.matches.filter(canReplace)

  const flowOptions = Object.values(project.flows)
    .sort(compareOrder)
    .map((f) => ({ value: f.id, label: f.name }))
  const speakerIds = new Set(Object.values(project.flows).flatMap((f) => Object.values(f.nodes).map((n) => n.data.speakerId).filter((x): x is string => typeof x === 'string')))
  const speakerOptions = Object.values(project.entities)
    .filter((e) => speakerIds.has(e.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => ({ value: e.id, label: e.name }))

  const replaceOne = (m: SearchMatch) => {
    const plan = planReplace(project, [m], opts, s.replacement)
    if (!plan.length) return
    if (plan[0].refused) return void toast.warn("Didn't replace that one", plan[0].refused)
    useProjectStore.getState().edit('Replace', (d) => void applyReplace(d as Project, plan))
  }
  const replaceAll = () => setPreview(planReplace(project, replaceable, opts, s.replacement))
  const confirmAll = () => {
    if (!preview) return
    let n = 0
    useProjectStore.getState().edit(`Replace ${preview.length}`, (d) => {
      n = applyReplace(d as Project, preview)
    })
    const refused = preview.filter((c) => c.refused).length
    setPreview(null)
    toast.success(`Replaced in ${n} place${n === 1 ? '' : 's'}`, refused ? `${refused} left as they were: the replacement would have broken them.` : 'One undo (Ctrl+Z) puts them all back.')
  }

  const toggle = (on: boolean, title: string, Icon: typeof CaseSensitive, onClick: () => void) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={on}
      onClick={onClick}
      className={cx('grid h-6 w-6 place-items-center rounded transition-colors', on ? 'bg-accent/20 text-accent' : 'text-faint hover:bg-raised hover:text-fg')}
    >
      <Icon size={14} />
    </button>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-1.5 px-2 pb-2">
        <div className="flex items-start gap-1">
          <button
            type="button"
            aria-label={s.showReplace ? 'Hide replace' : 'Show replace'}
            title={s.showReplace ? 'Hide replace' : 'Replace'}
            onClick={() => s.set({ showReplace: !s.showReplace })}
            className="mt-1 grid h-6 w-5 shrink-0 place-items-center rounded text-faint hover:bg-raised hover:text-fg"
          >
            <ChevronRight size={13} className={cx('transition-transform', s.showReplace && 'rotate-90')} />
          </button>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center rounded-md border border-line bg-bg pr-1 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
              <Search size={13} className="ml-2 shrink-0 text-faint" />
              <input
                ref={input}
                value={s.query}
                onChange={(e) => s.set({ query: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && result.matches[0]) goToTarget(result.matches[0].target)
                  if (e.key === 'Escape') s.set({ query: '' })
                }}
                placeholder="Search the project"
                aria-label="Search the project"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-xs text-fg outline-none placeholder:text-faint"
              />
              {toggle(s.matchCase, 'Match case', CaseSensitive, () => s.set({ matchCase: !s.matchCase }))}
              {toggle(s.wholeWord, 'Whole word', WholeWord, () => s.set({ wholeWord: !s.wholeWord }))}
              {toggle(s.regex, 'Regular expression', Regex, () => s.set({ regex: !s.regex }))}
            </div>
            {s.showReplace && (
              <div className="flex items-center gap-1">
                <div className="flex min-w-0 flex-1 items-center rounded-md border border-line bg-bg focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
                  <Replace size={13} className="ml-2 shrink-0 text-faint" />
                  <input
                    value={s.replacement}
                    onChange={(e) => s.set({ replacement: e.target.value })}
                    placeholder={s.regex ? 'Replace with ($1 for a group)' : 'Replace with'}
                    aria-label="Replace with"
                    spellCheck={false}
                    className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-xs text-fg outline-none placeholder:text-faint"
                  />
                </div>
                <button
                  type="button"
                  title="Replace all…"
                  aria-label="Replace all"
                  disabled={!replaceable.length}
                  onClick={replaceAll}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted hover:bg-raised hover:text-fg disabled:opacity-40"
                >
                  <ReplaceAll size={14} />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-1 pl-6">
          {SEARCH_CATEGORIES.map((c) => {
            const on = s.categories.includes(c)
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() => s.set({ categories: on ? s.categories.filter((x) => x !== c) : [...s.categories, c] })}
                className={cx('rounded-md border px-1.5 py-0.5 text-2xs transition-colors', on ? 'border-accent/50 bg-accent/10 text-fg' : 'border-line text-faint hover:text-muted')}
              >
                {CATEGORY_LABELS[c]}
              </button>
            )
          })}
        </div>
        <div className="grid grid-cols-2 gap-1 pl-6">
          <Select value={s.flowId} placeholder="All flows" options={flowOptions} onChange={(flowId) => s.set({ flowId })} />
          <Select value={s.speakerId} placeholder="Any speaker" options={speakerOptions} onChange={(speakerId) => s.set({ speakerId })} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
        {result.error ? (
          <p className="flex gap-1.5 px-2 text-2xs text-warn">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            {result.error}
          </p>
        ) : !query ? (
          <p className="px-2 text-2xs leading-relaxed text-faint">
            Searches lines, choice text, labels, conditions and actions, notes, comments and names. {shortcut('F')} opens it from anywhere.
          </p>
        ) : result.matches.length === 0 ? (
          <p className="px-2 text-2xs text-faint">Nothing found.</p>
        ) : (
          <>
            <p className="px-2 pb-1 text-2xs text-faint">
              {result.matches.length.toLocaleString('en')}
              {result.truncated ? '+' : ''} result{result.matches.length === 1 ? '' : 's'}
              {result.truncated ? ': refine the search to see the rest' : ''}
            </p>
            {groups.map((g) => (
              <Group key={g.key} title={g.title} matches={g.matches} showReplace={s.showReplace} onReplace={replaceOne} />
            ))}
          </>
        )}
      </div>

      <ReplacePreview plan={preview} onClose={() => setPreview(null)} onConfirm={confirmAll} replacement={s.replacement} project={project} />
    </div>
  )
}

function Group({ title, matches, showReplace, onReplace }: { title: string; matches: SearchMatch[]; showReplace: boolean; onReplace(m: SearchMatch): void }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="mt-1">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-2xs font-semibold text-muted hover:bg-raised/60">
        <ChevronRight size={12} className={cx('shrink-0 transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="tabular-nums text-faint">{matches.length}</span>
      </button>
      {open && (
        <ul>
          {matches.map((m) => (
            <li key={`${targetKey(m.target)}#${m.index}`} className="group relative">
              <button
                type="button"
                onClick={() => goToTarget(m.target)}
                className="flex w-full flex-col rounded px-2 py-1 pl-5 text-left hover:bg-raised/60"
              >
                <span className="text-[10px] uppercase tracking-wider text-faint">{m.fieldLabel}</span>
                <Snippet m={m} />
              </button>
              {showReplace && canReplace(m) && (
                <button
                  type="button"
                  title="Replace this one"
                  aria-label="Replace this one"
                  onClick={() => onReplace(m)}
                  className="absolute right-1 top-1 hidden h-6 w-6 place-items-center rounded bg-panel text-muted shadow hover:text-fg group-hover:grid"
                >
                  <Replace size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The match with a little text either side, on one line. */
function Snippet({ m }: { m: SearchMatch }) {
  const before = m.value.slice(Math.max(0, m.start - 32), m.start).replace(/\s+/g, ' ')
  const after = m.value.slice(m.end, m.end + 48).replace(/\s+/g, ' ')
  const mono = m.category === 'logic' || m.category === 'names'
  return (
    <span className={cx('truncate text-xs text-muted', mono && 'font-mono text-2xs')}>
      {m.start > 32 && '…'}
      {before}
      <mark className="rounded-sm bg-accent/30 px-px text-fg">{m.value.slice(m.start, m.end)}</mark>
      {after}
    </span>
  )
}

function ReplacePreview({
  plan,
  onClose,
  onConfirm,
  replacement,
  project
}: {
  plan: PlannedChange[] | null
  onClose(): void
  onConfirm(): void
  replacement: string
  project: Project
}) {
  const ok = plan?.filter((c) => !c.refused) ?? []
  const refused = plan?.filter((c) => c.refused) ?? []
  const where = (c: PlannedChange) => (c.flowId ? (project.flows[c.flowId]?.name ?? '') : 'Rules')
  return (
    <Modal
      open={plan !== null}
      onClose={onClose}
      icon={ReplaceAll}
      title="Replace all"
      subtitle={
        <>
          {ok.length} place{ok.length === 1 ? '' : 's'} will change{replacement ? '' : ' (the matches will be removed)'}. Names aren&apos;t changed here: rename them in the explorer, so every use follows.
        </>
      }
      footer={
        <>
          <span className="min-w-0 flex-1 text-2xs text-faint">One undo (Ctrl+Z) puts them all back.</span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={ReplaceAll} disabled={!ok.length} onClick={onConfirm}>
            Replace {ok.length}
          </Button>
        </>
      }
    >
      {refused.length > 0 && (
        <div className="mb-3 rounded-lg border border-warn/40 bg-warn/[0.06] p-2.5">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-warn">
            <AlertTriangle size={13} /> {refused.length} won&apos;t be changed
          </p>
          <ul className="space-y-1">
            {refused.slice(0, 20).map((c) => (
              <li key={targetKey(c.target)} className="text-2xs leading-snug text-muted">
                <span className="text-faint">{where(c)} · </span>
                {c.refused}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul className="space-y-2">
        {ok.slice(0, 200).map((c) => (
          <li key={targetKey(c.target)} className="rounded-lg border border-line bg-bg/40 p-2">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-faint">
              {where(c)} · {c.fieldLabel}
              {c.count > 1 ? ` · ${c.count} matches` : ''}
            </p>
            <p className="whitespace-pre-wrap text-2xs text-faint line-through decoration-danger/60">{c.before}</p>
            <p className="whitespace-pre-wrap text-xs text-fg">{c.after}</p>
          </li>
        ))}
      </ul>
      {ok.length > 200 && <p className="mt-2 text-2xs text-faint">…and {ok.length - 200} more.</p>}
    </Modal>
  )
}

/** Matches grouped by flow, in flow order, then everything outside flows. */
function groupByFlow(project: Project, matches: SearchMatch[]): { key: string; title: string; matches: SearchMatch[] }[] {
  const groups = new Map<string, SearchMatch[]>()
  for (const m of matches) {
    const key = m.flowId ?? '-'
    const list = groups.get(key)
    if (list) list.push(m)
    else groups.set(key, [m])
  }
  return [...groups.entries()].map(([key, list]) => ({
    key,
    title: key === '-' ? 'Rules and names' : (project.flows[key]?.name ?? 'Flow'),
    matches: list
  }))
}

