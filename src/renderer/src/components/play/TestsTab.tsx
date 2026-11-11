import { Eye, FlaskConical, Play, Plus, Route, Trash2 } from 'lucide-react'
import type { ExportResult } from '@shared/export/build'
import type { ExportNode } from '@shared/export/types'
import type { PathExample } from '@shared/play/explore'
import { nodeLabel, sortedScenarios, sortedTests, type TestResult } from '@shared/play/storyTests'
import type { Project, RouteStep, StoryTest } from '@shared/schema'
import { cx } from '../../lib/cx'
import { addTest, removeTest, updateTest } from '../../store/ops'
import { usePlay } from '../../store/play'
import { useProjectStore } from '../../store/projectStore'
import { useTests } from '../../store/tests'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Select, TextArea, TextInput, Toggle } from '../ui/fields'
import { TestStatusIcon } from './TestStatus'

/**
 * Story tests for this flow. They re-run in the background a moment after
 * every edit, so a change that breaks a saved play-through, leaves a path
 * without an ending or makes a node unreachable shows up straight away.
 */
export function TestsTab({
  project,
  build,
  flowId,
  onReplay,
  onPlayRoute
}: {
  project: Project
  build: ExportResult
  flowId: string
  onReplay(example: PathExample): void
  onPlayRoute(flowId: string, scenarioId: string | null, route: RouteStep[]): void
}) {
  const results = useTests((s) => s.results)
  const fresh = useTests((s) => s.checked === project)
  const error = useTests((s) => s.error)
  const all = sortedTests(project)
  const tests = all.filter((t) => t.flowId === flowId)
  const elsewhere = all.length - tests.length
  const scenarioId = usePlay((s) => s.scenarioId)

  const addExplore = () => {
    const sc = scenarioId ? project.scenarios?.[scenarioId] : undefined
    addTest({
      name: sc ? `Every path from “${sc.name}”` : 'Every path',
      flowId,
      scenarioId: sc?.id ?? null,
      kind: 'explore',
      allEnd: true,
      checks: ''
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-relaxed text-muted">
        Saved checks that this flow still plays the way you meant. They re-run after every edit and live in the project file, so the whole team shares them.
      </p>
      {error && <p className="rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-2xs text-danger">The tests couldn&apos;t run: {error}</p>}

      {tests.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line p-3 text-2xs leading-relaxed text-faint">
          No tests for this flow yet. Play it and press <span className="text-muted">Save as test</span> to keep a play-through, or add a check that covers
          every path.
        </div>
      ) : (
        tests.map((t) => (
          <TestCard
            key={t.id}
            project={project}
            build={build}
            test={t}
            result={fresh ? results[t.id] : undefined}
            onReplay={onReplay}
            onPlayRoute={onPlayRoute}
          />
        ))
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <Button icon={Plus} onClick={addExplore} title="Check every path through this flow, from the start state's scenario">
          Check every path
        </Button>
        <Button icon={Play} variant="ghost" onClick={() => usePlay.getState().setTab('play')}>
          Record a play-through
        </Button>
      </div>
      {elsewhere > 0 && (
        <p className="text-2xs text-faint">
          {elsewhere} more test{elsewhere === 1 ? '' : 's'} in other flows. The status bar shows how they&apos;re doing.
        </p>
      )}
    </div>
  )
}

function TestCard({
  project,
  build,
  test: t,
  result,
  onReplay,
  onPlayRoute
}: {
  project: Project
  build: ExportResult
  test: StoryTest
  result: TestResult | undefined
  onReplay(example: PathExample): void
  onPlayRoute(flowId: string, scenarioId: string | null, route: RouteStep[]): void
}) {
  const focusNode = useProjectStore((s) => s.focusNode)
  const status = result?.status ?? 'pending'
  const scenarios = sortedScenarios(project)
  const scenarioMissing = t.scenarioId !== null && !project.scenarios?.[t.scenarioId]
  const endings = endNodes(build, t.flowId)

  const remove = async () => {
    const ok = await window.api.confirm({ message: `Delete the test “${t.name}”?`, detail: 'You can undo this with Ctrl+Z.', confirmLabel: 'Delete', danger: true })
    if (ok) removeTest(t.id)
  }

  return (
    <section
      className={cx(
        'flex flex-col gap-2 rounded-lg border p-2.5',
        status === 'fail' ? 'border-danger/40 bg-danger/5' : status === 'broken' ? 'border-warn/40 bg-warn/5' : 'border-line bg-bg/40'
      )}
    >
      <div className="flex items-center gap-1.5">
        <TestStatusIcon status={status} />
        <div className="min-w-0 flex-1">
          <TextInput value={t.name} required placeholder="Test name" onCommit={(name) => updateTest(t.id, { name })} className="h-7 border-transparent bg-transparent px-1 py-0.5 text-xs font-medium hover:border-line" />
        </div>
        {t.kind === 'play' && (
          <IconButton size="sm" icon={Play} label="Play this test's route" onClick={() => onPlayRoute(t.flowId, t.scenarioId, t.route ?? [])} />
        )}
        <IconButton size="sm" icon={Trash2} tone="danger" label={`Delete the test “${t.name}”`} onClick={remove} />
      </div>

      <p className="flex items-center gap-1.5 text-2xs text-faint">
        {t.kind === 'play' ? <Route size={11} /> : <FlaskConical size={11} />}
        {t.kind === 'play'
          ? `Play-through · ${(t.route ?? []).length} step${(t.route ?? []).length === 1 ? '' : 's'} · ${t.ends === false ? 'waits at' : 'ends at'} ${nodeLabel(build.file, t.stopsAt ?? null)}`
          : `Every path${result?.paths !== undefined ? ` · ${result.paths.toLocaleString('en')} played` : ''}`}
      </p>

      {result && result.failures.length > 0 && (
        <ul className="flex flex-col gap-1">
          {result.failures.map((f, i) => (
            <li key={i} className={cx('text-2xs leading-relaxed', status === 'broken' ? 'text-warn' : 'text-danger')}>
              {f.message}
              <span className="ml-1 inline-flex gap-1.5">
                {f.nodeId && (
                  <button type="button" className="text-accent hover:underline" onClick={() => focusNode(t.flowId, f.nodeId!)}>
                    Show
                  </button>
                )}
                {f.example && (
                  <button type="button" className="text-accent hover:underline" onClick={() => onReplay(f.example!)}>
                    Replay
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-2xs text-muted">Starts</span>
        <div className="min-w-0 flex-1">
          <Select
            value={t.scenarioId}
            placeholder="The project’s own start"
            invalid={scenarioMissing}
            options={scenarios.map((sc) => ({ value: sc.id, label: sc.name || '(unnamed)' }))}
            onChange={(scenarioId) => updateTest(t.id, { scenarioId })}
          />
        </div>
      </div>

      {t.kind === 'explore' && (
        <div className="flex flex-col gap-1.5">
          <Switch label="Every path ends at an End node" checked={t.allEnd === true} onChange={(allEnd) => updateTest(t.id, { allEnd })} />
          <Switch label="Every node is reached" checked={t.allReached === true} onChange={(allReached) => updateTest(t.id, { allReached })} />
          {endings.length > 0 && (
            <div>
              <p className="mb-1 text-2xs text-muted">Must be reachable:</p>
              <div className="flex flex-wrap gap-1">
                {endings.map((n) => {
                  const on = (t.reach ?? []).includes(n.id)
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => updateTest(t.id, { reach: on ? (t.reach ?? []).filter((x) => x !== n.id) : [...(t.reach ?? []), n.id] })}
                      className={cx(
                        'max-w-full truncate rounded-md border px-1.5 py-0.5 text-2xs transition-colors',
                        on ? 'border-accent/60 bg-accent/10 text-fg' : 'border-line text-faint hover:text-muted'
                      )}
                      title={on ? 'Required: click to stop requiring it' : 'Click to require a path that ends here'}
                    >
                      {nodeLabel(build.file, n.id)}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div>
        <p className="mb-1 text-2xs text-muted">{t.kind === 'play' ? 'True where it stops' : 'True at the end of every path'} (one per line):</p>
        <div className="font-mono text-xs">
          <TextArea value={t.checks} rows={Math.min(5, Math.max(1, t.checks.split('\n').length))} placeholder="Player.Coins >= 0" onCommit={(checks) => updateTest(t.id, { checks })} />
        </div>
      </div>

      {t.kind === 'play' && status === 'fail' && (
        <p className="flex items-center gap-1 text-2xs text-faint">
          <Eye size={11} /> If the story changed on purpose, play the new path and save it as a test, then delete this one.
        </p>
      )}
    </section>
  )
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="flex items-center justify-between gap-2 text-2xs text-muted">
      {label}
      <Toggle checked={checked} onChange={onChange} label={label} />
    </label>
  )
}

/** Nodes in a flow marked End, in a stable order. */
function endNodes(build: ExportResult, flowId: string): ExportNode[] {
  const flow = build.file.flows[flowId]
  if (!flow) return []
  return Object.values(flow.nodes)
    .filter((n) => n.end)
    .sort((a, b) => nodeLabel(build.file, a.id).localeCompare(nodeLabel(build.file, b.id)))
}
