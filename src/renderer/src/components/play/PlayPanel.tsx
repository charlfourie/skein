import { ExprText } from '../defs/ExprText'
import { formatDuration } from '@shared/time'
import { motion } from 'framer-motion'
import { AlertTriangle, ArrowRightCircle, Clock, Crosshair, Flag, FlaskConical, Lock, Play, RotateCcw, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { buildExport, type ExportResult } from '@shared/export/build'
import type { ExportFile } from '@shared/export/types'
import type { PathExample } from '@shared/play/explore'
import type { Project, RouteStep } from '@shared/schema'
import { nodeLabel, playRoute, scenarioStart } from '@shared/play/storyTests'
import { cx } from '../../lib/cx'
import { formatValue, PlaySession, type PlayEntry, clockText } from '../../lib/playSession'
import { usePlay } from '../../store/play'
import { useProjectStore } from '../../store/projectStore'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Select } from '../ui/fields'
import { ExploreTab } from './ExploreTab'
import { StartStateTab } from './StartStateTab'
import { TestsTab } from './TestsTab'
import { saveSessionAsTest, valuesToChecks } from '../../lib/scenarios'
import { toast } from '../../lib/toast'
import { runTestsNow, useTests } from '../../store/tests'
import { TextArea, TextInput } from '../ui/fields'
import { currentStart } from './startState'

/** One export per project version, shared by every panel, so a play-through only reads as stale after a real edit. */
const exports = new WeakMap<Project, ReturnType<typeof buildExport>>()
function exportFor(project: Project): ReturnType<typeof buildExport> {
  let build = exports.get(project)
  if (!build) {
    build = buildExport(project)
    exports.set(project, build)
  }
  return build
}

/**
 * Play panel: test a flow exactly as the game will run it (the same export
 * and runtime), explore every path through it, and set up the state to test from.
 */
export function PlayPanel({ project, flowId }: { project: Project; flowId: string }) {
  const tab = usePlay((s) => s.tab)
  const session = usePlay((s) => s.session)
  usePlay((s) => s.version) // re-render when the session advances
  const { setTab, close } = usePlay.getState()
  const build = exportFor(project)

  const follow = useCallback((s: PlaySession | null) => {
    const id = s?.currentNodeId
    if (s && id && usePlay.getState().follow) useProjectStore.getState().focusNode(s.flowId, id)
  }, [])

  const restart = useCallback(
    (example?: PathExample) => {
      if (!build.file.flows[flowId]) return
      const s = new PlaySession(build.file, flowId, currentStart(), example?.start ?? {}, example?.picks)
      if (example) s.replay()
      usePlay.getState().setSession(s)
      if (s.flowId !== flowId) usePlay.setState({ flowId: s.flowId }) // the path ended in another flow
      follow(s)
    },
    [build.file, flowId, follow]
  )

  /** Play a story test's route in the Play tab, from the test's own start. */
  const playTest = useCallback(
    (testFlowId: string, scenarioId: string | null, route: RouteStep[]) => {
      const start = scenarioStart(project, build, scenarioId)
      if (!start.ok) return toast.warn("Couldn't start the test", start.message)
      if (!build.file.flows[testFlowId]) return
      const s = new PlaySession(build.file, testFlowId, start.start, {}, undefined, route)
      s.followRoute()
      usePlay.getState().setSession(s)
      usePlay.setState({ flowId: s.flowId, tab: 'play' })
      follow(s)
    },
    [build, follow, project]
  )

  // Start playing when the panel opens on a flow with no play-through yet.
  useEffect(() => {
    const s = usePlay.getState().session
    if (!s || !s.file.flows[flowId] || s.flowId !== flowId) restart()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId])

  const act = (fn: (s: PlaySession) => void) => {
    const s = usePlay.getState().session
    if (!s) return
    const before = s.flowId
    fn(s)
    // Carrying on into another flow: the panel follows the story to that flow's canvas.
    if (s.flowId !== before) usePlay.setState({ flowId: s.flowId })
    usePlay.getState().touch()
    follow(s)
  }

  // Take keyboard focus on open, so Enter and 1–9 play the story straight away.
  const panelRef = useRef<HTMLElement>(null)
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true })
  }, [])

  const flowProblems = build.problems.filter((p) => p.at && 'flowId' in p.at && p.at.flowId === flowId)

  return (
    <motion.aside
      ref={panelRef}
      tabIndex={-1}
      data-play-panel=""
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 36 }}
      className="absolute bottom-3 right-3 top-14 z-20 flex outline-none w-[392px] max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-xl border border-line bg-panel/95 shadow-pop backdrop-blur"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <header className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        {(['play', 'explore', 'start', 'tests'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cx(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              tab === t ? 'bg-raised text-fg' : 'text-muted hover:text-fg'
            )}
          >
            {t === 'play' ? 'Play' : t === 'explore' ? 'Explore' : t === 'start' ? 'Start state' : <TestsLabel flowId={flowId} />}
          </button>
        ))}
        <div className="flex-1" />
        <IconButton size="sm" icon={X} label="Close the Play panel" onClick={close} />
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {tab === 'play' && session && (
          <PlayTab
            project={project}
            session={session}
            build={build.file}
            exportResult={build}
            problems={flowProblems.map((p) => p.message)}
            act={act}
            restart={() => restart()}
            onSaved={() => setTab('tests')}
          />
        )}
        {tab === 'explore' && (
          <ExploreTab
            file={build.file}
            flowId={flowId}
            onReplay={(example) => {
              restart(example)
              setTab('play')
            }}
          />
        )}
        {tab === 'start' && <StartStateTab project={project} build={build} />}
        {tab === 'tests' && (
          <TestsTab
            project={project}
            build={build}
            flowId={flowId}
            onReplay={(example) => {
              restart(example)
              setTab('play')
            }}
            onPlayRoute={playTest}
          />
        )}
      </div>
    </motion.aside>
  )
}

/** The Tests tab's name, with a dot when a test of this flow is failing. */
function TestsLabel({ flowId }: { flowId: string }) {
  const failing = useTests((s) => Object.values(s.results).some((r) => r.flowId === flowId && r.status !== 'pass'))
  return (
    <span className="flex items-center gap-1">
      Tests
      {failing && <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-label="(failing)" />}
    </span>
  )
}

function PlayTab({
  project,
  session,
  build,
  exportResult,
  problems,
  act,
  restart,
  onSaved
}: {
  project: Project
  session: PlaySession
  build: ExportFile
  exportResult: ExportResult
  problems: string[]
  act(fn: (s: PlaySession) => void): void
  restart(): void
  onSaved(): void
}) {
  const follow = usePlay((s) => s.follow)
  const focusNode = useProjectStore((s) => s.focusNode)
  const [nextFlow, setNextFlow] = useState<string | null>(null)
  const beat = session.beat
  const options = session.options()
  const stale = session.file !== build
  const w = session.world
  const time = clockText(w)
  const changed = session.changed()
  const endEntry = session.ended ? [...session.entries].reverse().find((e): e is Extract<PlayEntry, { kind: 'end' }> => e.kind === 'end') : undefined
  const transcriptEnd = useRef<HTMLDivElement>(null)

  // Keep the newest transcript line in view, scrolling only the transcript box (never the panel,
  // which would push the current line and its choices out of sight).
  useEffect(() => {
    const box = transcriptEnd.current?.parentElement
    if (box) box.scrollTop = box.scrollHeight
  }, [session.entries.length])

  // Keyboard: 1–9 picks a choice, Enter continues.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return
      // A focused button handles Enter itself (and the toolbar's Play button would close the panel).
      if (e.key === 'Enter' && (t.tagName === 'BUTTON' || t.tagName === 'A')) {
        if (!t.closest('[data-play-panel]')) {
          e.preventDefault()
          t.blur()
        } else return
      }
      const available = options.filter((o) => o.available)
      if (e.key === 'Enter' && available.length === 1) {
        e.preventDefault()
        act((s) => s.choose(available[0].index!))
      } else if (e.key === 'Enter' && available.length === 0 && !session.ended) {
        e.preventDefault()
        act((s) => s.choose(0)) // the End button
      } else if (/^[1-9]$/.test(e.key) && available.length > 1) {
        const o = available[Number(e.key) - 1]
        if (o) {
          e.preventDefault()
          act((s) => s.choose(o.index!))
        }
      }
    }
    // Capture phase: the panel stops key events bubbling (so canvas shortcuts don't fire while typing in it).
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const flowOptions = Object.values(project.flows)
    .filter((f) => f.id !== session.flowId)
    .map((f) => ({ value: f.id, label: f.name }))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        <span className="flex items-center gap-1.5 rounded-md bg-raised px-2 py-1 text-xs tabular-nums text-fg" title="Time in the story">
          <Clock size={12} className="text-muted" /> {time}
        </span>
        <IconButton size="sm" icon={ArrowRightCircle} label="Advance time one phase (as a game clock would)" onClick={() => act((s) => s.advance(1))} />
        <div className="flex-1" />
        <IconButton size="sm" icon={Crosshair} label={follow ? 'Following the story on the canvas' : 'Follow the story on the canvas'} active={follow} onClick={() => usePlay.getState().setFollow(!follow)} />
        <IconButton size="sm" icon={RotateCcw} label="Restart from the starting state" onClick={restart} />
      </div>

      <Hud project={project} session={session} />

      {stale && (
        <button type="button" onClick={restart} className="rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-left text-2xs text-accent">
          You&apos;ve edited the project since this play-through began. Restart to play the new version.
        </button>
      )}
      {problems.length > 0 && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-2.5 py-2 text-2xs leading-relaxed text-warn">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle size={12} /> {problems.length} problem{problems.length === 1 ? '' : 's'} in this flow
          </p>
          {problems.slice(0, 3).map((p) => (
            <p key={p} className="mt-1 text-muted">
              {p}
            </p>
          ))}
        </div>
      )}

      {/* The current beat */}
      {beat.kind === 'line' && (
        <div className="rounded-lg border border-line bg-bg/60 p-3">
          <p className={cx('text-2xs font-semibold uppercase tracking-wider', beat.speaker ? 'text-accent' : 'text-faint')}>
            {session.speakerName(beat.speaker) ?? 'Narration'}
          </p>
          <p className={cx('mt-1 whitespace-pre-wrap text-sm leading-relaxed', beat.speaker ? 'text-fg' : 'italic text-muted')}>{beat.text}</p>
        </div>
      )}
      {beat.kind === 'choice' && (
        <p className="text-2xs font-semibold uppercase tracking-wider text-faint">{beat.node.type === 'hub' ? beat.node.label || 'Choose' : 'Choose'}</p>
      )}

      {!session.ended && (
        <div className="flex flex-col gap-1">
          {options.filter((o) => o.available).length === 1 && options.length <= 1 ? (
            <Button variant="primary" icon={Play} onClick={() => act((s) => s.choose(0))}>
              Continue <span className="ml-1 text-2xs opacity-70">Enter</span>
            </Button>
          ) : options.filter((o) => o.available).length === 0 && beat.kind === 'line' ? (
            <Button variant="primary" icon={Flag} onClick={() => act((s) => s.choose(0))}>
              End
            </Button>
          ) : (
            (() => {
              let n = 0
              return options.map((o) => {
                const key = o.available ? ++n : null
                return o.available ? (
                  <button
                    key={o.nodeId}
                    type="button"
                    onClick={() => act((s) => s.choose(o.index!))}
                    className="group flex items-start gap-2 rounded-md border border-line bg-bg px-2.5 py-1.5 text-left text-xs text-fg transition-colors hover:border-accent/60 hover:bg-raised"
                  >
                    <span className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded bg-raised text-[10px] font-semibold tabular-nums text-muted group-hover:text-accent">{key}</span>
                    <span className="min-w-0 flex-1">{o.text}</span>
                    {o.takes ? (
                      <span className="shrink-0 whitespace-nowrap text-2xs text-loop" title={o.activity ? `${o.activity}: takes ${formatDuration(o.takes)}` : `Takes ${formatDuration(o.takes)}`}>
                        ◷ {formatDuration(o.takes)}
                      </span>
                    ) : null}
                  </button>
                ) : (
                  <div key={o.nodeId} className="flex items-start gap-2 rounded-md border border-dashed border-line px-2.5 py-1.5 text-xs text-faint" title="Not offered right now">
                    <Lock size={11} className="mt-0.5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      {o.text}
                      {o.requires && (
                        <span className="mt-0.5 block font-mono text-2xs text-faint/80">
                          needs <ExprText source={o.requires} />
                        </span>
                      )}
                    </span>
                  </div>
                )
              })
            })()
          )}
        </div>
      )}

      {session.ended && (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-bg/60 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-fg">
            <Flag size={12} className="text-muted" /> The flow ended
          </p>
          {endEntry && !endEntry.marked && (
            <p className="flex items-start gap-1.5 text-2xs leading-relaxed text-warn">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              It stopped at a node that isn&apos;t marked End: nothing after it was available.
              {endEntry.nodeId && (
                <button type="button" className="text-accent hover:underline" onClick={() => focusNode(session.flowId, endEntry.nodeId!)}>
                  Show
                </button>
              )}
            </p>
          )}
          {flowOptions.length > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="min-w-0 flex-1">
                <Select value={nextFlow} placeholder="Continue in another flow…" options={flowOptions} onChange={setNextFlow} />
              </div>
              <Button icon={Play} disabled={!nextFlow} onClick={() => nextFlow && act((s) => s.continueIn(nextFlow))}>
                Go
              </Button>
            </div>
          )}
        </div>
      )}

      <SaveAsTest project={project} session={session} build={exportResult} stale={stale} onSaved={onSaved} />

      {/* State */}
      <section>
        <h3 className="mb-1 text-2xs font-semibold uppercase tracking-wider text-faint">Changed since the start</h3>
        {changed.length === 0 ? (
          <p className="text-2xs text-faint">Nothing yet.</p>
        ) : (
          <table className="w-full text-xs">
            <tbody>
              {changed.map((c) => (
                <tr key={c.key} className="border-b border-line/60 last:border-0">
                  <td className="truncate py-0.5 pr-2 font-mono text-2xs text-muted" title={c.key}>
                    {c.label}
                  </td>
                  <td className="whitespace-nowrap py-0.5 text-right tabular-nums">
                    <span className="text-faint">{formatValue(c.from)}</span>
                    <span className="mx-1 text-faint">→</span>
                    <span className="text-fg">{formatValue(c.to)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Transcript */}
      <section>
        <h3 className="mb-1 text-2xs font-semibold uppercase tracking-wider text-faint">Transcript</h3>
        <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto rounded-md border border-line/60 bg-bg/30 p-1">
          {session.entries.map((e, i) => (
            <TranscriptLine key={i} entry={e} onFocus={(id) => focusNode(session.flowId, id)} />
          ))}
          <div ref={transcriptEnd} />
        </div>
      </section>
    </div>
  )
}

/**
 * Variables marked "Show in Play" (State › World variables), pinned like a game HUD.
 * A value that has changed since the start is highlighted, with where it began.
 */
function Hud({ project, session }: { project: Project; session: PlaySession }) {
  // In the order the designer listed them under State › World variables.
  const position = new Map(Object.values(project.state.variables).map((v) => [`${v.namespace}.${v.technicalName}`, v.order]))
  const shown = Object.entries(session.file.state.variables)
    .filter(([, def]) => def.hud)
    .sort(([a], [b]) => (position.get(a) ?? 0) - (position.get(b) ?? 0) || (a < b ? -1 : 1))
  if (shown.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Shown in Play">
      {shown.map(([key, def]) => {
        const now = session.world.read({ get: 'var', var: key })
        const start = def.default
        const moved = now !== start
        const name = key.slice(key.indexOf('.') + 1)
        return (
          <span
            key={key}
            title={moved ? `${key}: ${formatValue(start)} at the start` : key}
            className={cx(
              'flex items-baseline gap-1.5 rounded-md border px-2 py-1 text-xs tabular-nums',
              moved ? 'border-accent/50 bg-accent/10' : 'border-line bg-raised'
            )}
          >
            <span className="text-2xs text-muted">{name}</span>
            <span className="font-semibold text-fg">{formatValue(now)}</span>
            {typeof def.max === 'number' && <span className="text-2xs text-faint">/ {def.max}</span>}
          </span>
        )
      })}
    </div>
  )
}

function TranscriptLine({ entry: e, onFocus }: { entry: PlayEntry; onFocus(id: string): void }) {
  switch (e.kind) {
    case 'line':
      return (
        <button type="button" onClick={() => onFocus(e.nodeId)} className="rounded px-1 py-0.5 text-left text-xs hover:bg-raised">
          {e.speaker ? <span className="font-medium text-accent">{e.speaker}: </span> : null}
          <span className={e.speaker ? 'text-fg' : 'italic text-muted'}>{e.text}</span>
        </button>
      )
    case 'pick':
      return (
        <button type="button" onClick={() => onFocus(e.nodeId)} className="rounded px-1 py-0.5 text-left text-xs text-ok hover:bg-raised">
          ▸ {e.text}
        </button>
      )
    case 'change':
      return (
        <p className="px-1 font-mono text-2xs text-faint">
          {e.label}: {formatValue(e.from)} → <span className="text-muted">{formatValue(e.to)}</span>
        </p>
      )
    case 'time':
      return <p className="px-1 text-2xs text-loop">◷ {e.text}</p>
    case 'rule':
      return <p className="px-1 text-2xs text-faint">⚙ {e.text}</p>
    case 'end':
      return <p className={cx('px-1 text-2xs', e.marked ? 'text-muted' : 'text-warn')}>■ {e.marked ? 'End' : 'Stopped (not marked End)'}</p>
    case 'note':
      return <p className="px-1 text-2xs text-accent">{e.text}</p>
    case 'pass':
      return (
        <p className="px-1 text-2xs text-loop">
          ◷ {formatDuration(e.minutes)}
          {e.activity ? ` · ${e.activity}` : ''} <span className="text-faint">→ {e.clock}</span>
        </p>
      )
    case 'dice':
      return <p className="px-1 text-2xs text-accent">🎲 {e.text}</p>
    case 'warn':
      return (
        <button
          type="button"
          disabled={!e.nodeId}
          onClick={() => e.nodeId && onFocus(e.nodeId)}
          className="rounded px-1 py-0.5 text-left text-2xs text-warn hover:bg-raised"
        >
          ⚠ {e.text}
        </button>
      )
  }
}

/**
 * Save this play-through as a story test: the route taken (choices and dice),
 * where it stops, and a few checks that start out as what changed. The test
 * re-runs after every edit, so a later change that breaks this path shows up.
 */
function SaveAsTest({ project, session, build, stale, onSaved }: { project: Project; session: PlaySession; build: ExportResult; stale: boolean; onSaved(): void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [checks, setChecks] = useState('')
  const disabled = session.continued ? 'A test covers one flow. Restart to record a play-through you can save.' : stale ? 'Restart to play the current version first.' : null

  // Where the test runner would stop on this route (a final line ends the story; a choice waits).
  const [ends, setEnds] = useState(true)
  const begin = () => {
    const start = { ...session.start, values: { ...(session.start.values ?? {}), ...session.extra } }
    const run = playRoute(build.file, session.startFlowId, start, session.route)
    const label = run.stop.nodeId ? nodeLabel(build.file, run.stop.nodeId).replace(/^“|”$/g, '') : 'the start'
    setEnds(run.stop.ended)
    setName(`${run.stop.ended ? 'Ends' : 'Waits'}: ${label.length > 40 ? `${label.slice(0, 39)}…` : label}`)
    setChecks(valuesToChecks(build.file, session.changed().filter((c) => !c.key.startsWith('visit:'))))
    setOpen(true)
  }
  const save = () => {
    const r = saveSessionAsTest(project, build, session, name.trim() || 'Untitled test', checks)
    if (!r.ok) return toast.warn("Couldn't save the test", r.message)
    setOpen(false)
    const latest = latestProject()
    if (latest) runTestsNow(latest)
    toast.success('Test saved', r.newScenario ? `Its starting state was saved as the scenario ${r.newScenario}.` : 'It re-runs whenever you edit the story.')
    onSaved()
  }

  if (!open)
    return (
      <div className="flex items-center gap-2">
        <Button icon={FlaskConical} disabled={!!disabled} title={disabled ?? 'Save this play-through as a story test'} onClick={begin}>
          Save as test
        </Button>
        {disabled ? (
          <span className="text-2xs text-faint">{disabled}</span>
        ) : (
          <span className="text-2xs text-faint">
            {session.route.length} step{session.route.length === 1 ? '' : 's'} so far
          </span>
        )}
      </div>
    )

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-accent/5 p-2.5">
      <h3 className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-accent">
        <FlaskConical size={11} /> Save as test
      </h3>
      <TextInput value={name} autoFocus placeholder="Test name" onCommit={setName} />
      <div>
        <p className="mb-1 text-2xs text-muted">
          {ends ? 'It should end here' : 'It should wait at this choice'}, and these should be true there (one per line):
        </p>
        <TextArea value={checks} rows={Math.min(6, Math.max(2, checks.split('\n').length))} placeholder="Player.Coins == 1" onCommit={setChecks} />
      </div>
      <div className="flex items-center gap-1.5">
        <Button variant="primary" icon={FlaskConical} onClick={save}>
          Save test
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </section>
  )
}

/** The project as it is right now (after an edit made in the same handler). */
function latestProject(): Project | null {
  return useProjectStore.getState().project
}
