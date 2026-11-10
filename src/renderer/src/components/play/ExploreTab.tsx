import { AlertTriangle, CheckCircle2, Crosshair, Flag, Loader2, Play, Repeat, Square, XCircle, Clock } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ExportFile } from '@shared/export/types'
import type { ExploreReport, PathExample } from '@shared/play/explore'
import { runExplore, type ExploreRun } from '../../lib/exploreRunner'
import { usePlay } from '../../store/play'
import { useProjectStore } from '../../store/projectStore'
import { Button } from '../ui/Button'
import { Select } from '../ui/fields'
import { combinationCount, currentStart, variationsFor } from './startState'

/**
 * Plays every sequence of choices through the flow (from the starting state,
 * optionally varied) and reports what can and can't happen.
 */
export function ExploreTab({ file, flowId, onReplay }: { file: ExportFile; flowId: string; onReplay(example: PathExample): void }) {
  const vary = usePlay((s) => s.vary)
  const maxPaths = usePlay((s) => s.maxPaths)
  const { setVary, setMaxPaths } = usePlay.getState()
  const [running, setRunning] = useState<{ run: ExploreRun; paths: number } | null>(null)
  const [report, setReport] = useState<{ report: ExploreReport; file: ExportFile; ms: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const runRef = useRef<ExploreRun | null>(null)
  useEffect(() => () => runRef.current?.cancel(), [])

  const { variations, problems } = variationsFor(file, vary)
  const starts = combinationCount(variations)
  const vars = Object.entries(file.state.variables).sort(([a], [b]) => a.localeCompare(b))
  const stale = report && report.file !== file

  const start = () => {
    setError(null)
    const t0 = performance.now()
    const run = runExplore(file, { flowId, start: currentStart(), vary: variations, maxPaths }, (paths) =>
      setRunning((r) => (r ? { ...r, paths } : r))
    )
    runRef.current = run
    setRunning({ run, paths: 0 })
    run.promise.then(
      (r) => {
        setReport({ report: r, file, ms: performance.now() - t0 })
        setRunning(null)
      },
      (e: Error) => {
        if (e.message !== 'cancelled') setError(e.message)
        setRunning(null)
      }
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-muted">
        Plays every combination of choices from the starting state and reports what can happen, what can&apos;t, and where
        numbers end up.
      </p>

      <section className="rounded-lg border border-line bg-bg/40 p-2.5">
        <h3 className="mb-1 text-2xs font-semibold uppercase tracking-wider text-faint">Vary the start</h3>
        <p className="mb-2 text-2xs text-faint">Each combination is explored as its own starting state.</p>
        <div className="flex max-h-56 flex-col gap-1 overflow-y-auto pr-1">
          {vars.map(([name, def]) => {
            const key = `var:${name}`
            const spec = vary[key] ?? ''
            return (
              <div key={key} className="flex items-center gap-2">
                <span className={`min-w-0 flex-1 truncate font-mono text-2xs ${spec ? 'text-accent' : 'text-muted'}`} title={name}>
                  {name}
                </span>
                {def.type === 'boolean' || def.type === 'enum' ? (
                  <label className="flex shrink-0 items-center gap-1.5 text-2xs text-muted">
                    <input
                      type="checkbox"
                      className="accent-[rgb(var(--c-accent))]"
                      checked={Boolean(spec)}
                      onChange={(e) => setVary(key, e.target.checked ? (def.type === 'boolean' ? 'both' : 'all') : undefined)}
                    />
                    {def.type === 'boolean' ? 'true and false' : `all ${def.options?.length ?? 0}`}
                  </label>
                ) : (
                  <input
                    className="w-28 shrink-0 rounded-md border border-line bg-bg px-2 py-0.5 font-mono text-2xs text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none"
                    placeholder={def.type === 'number' ? 'e.g. 0, 3, 5' : 'a, b'}
                    defaultValue={spec}
                    onBlur={(e) => setVary(key, e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                )}
              </div>
            )
          })}
        </div>
        {problems.map((p) => (
          <p key={p} className="mt-1.5 text-2xs text-warn">
            {p}
          </p>
        ))}
      </section>

      <div className="flex items-center gap-2">
        {running ? (
          <Button icon={Square} onClick={() => running.run.cancel()}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" icon={Play} onClick={start}>
            Explore {starts > 1 ? `${starts} starts` : 'all paths'}
          </Button>
        )}
        <div className="w-32">
          <Select
            value={String(maxPaths)}
            options={[2000, 20000, 100000, 500000].map((n) => ({ value: String(n), label: `up to ${n.toLocaleString()} paths` }))}
            onChange={(v) => v && setMaxPaths(Number(v))}
          />
        </div>
        {running && (
          <span className="flex items-center gap-1.5 text-2xs text-muted">
            <Loader2 size={12} className="animate-spin" /> {running.paths.toLocaleString()} paths…
          </span>
        )}
      </div>

      {error && <p className="rounded-md border border-danger/40 bg-danger/10 px-2.5 py-2 text-xs text-danger">{error}</p>}
      {stale && <p className="text-2xs text-warn">The project changed since this report. Explore again to update it.</p>}
      {report && <Report flowId={flowId} report={report.report} file={report.file} ms={report.ms} onReplay={onReplay} />}
    </div>
  )
}

function Report({ flowId, report, file, ms, onReplay }: { flowId: string; report: ExploreReport; file: ExportFile; ms: number; onReplay(e: PathExample): void }) {
  const focusNode = useProjectStore((s) => s.focusNode)
  const flow = file.flows[flowId]
  const total = Object.keys(flow?.nodes ?? {}).length
  const reached = total - report.unreached.length
  const unmarked = report.endings.filter((e) => !e.marked)
  const nodeLabel = (id: string) => {
    const n = flow?.nodes[id]
    if (!n) return id
    if (n.type === 'dialogue') return n.menuText || n.text || 'Dialogue'
    if (n.type === 'hub') return n.label || 'Hub'
    return n.type[0].toUpperCase() + n.type.slice(1)
  }
  const okish = report.errors.length === 0 && !report.stuck && unmarked.length === 0 && report.unreached.length === 0 && report.fullDays.length === 0

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-1.5">
        <Stat label="paths" value={report.paths.toLocaleString()} sub={report.capped ? 'stopped at the cap' : `${report.starts} start${report.starts === 1 ? '' : 's'}`} warn={report.capped} />
        <Stat label="nodes reached" value={`${reached}/${total}`} sub={`${Math.round((reached / Math.max(1, total)) * 100)}%`} warn={reached < total} />
        <Stat label="endings" value={String(report.endings.length)} sub={`${(ms / 1000).toFixed(1)} s`} />
      </div>

      {okish && (
        <p className="flex items-center gap-1.5 text-xs text-ok">
          <CheckCircle2 size={13} /> Every node is reachable, every path ends at an End node, and nothing loops forever.
        </p>
      )}

      {report.errors.map((e) => (
        <Finding key={e.message} tone="danger" icon={XCircle} title={`${e.count.toLocaleString()} path${e.count === 1 ? '' : 's'} hit an error`} detail={e.message} onReplay={() => onReplay(e.example)} />
      ))}
      {report.stuck && (
        <Finding
          tone="warn"
          icon={Repeat}
          title={`${report.stuck.count.toLocaleString()} path${report.stuck.count === 1 ? '' : 's'} never end`}
          detail="The player can keep choosing options that lead back around forever. Make sure every loop has a way out (a choice that hides itself once used, or a requirement that stops holding)."
          onReplay={() => onReplay(report.stuck!.example)}
        />
      )}
      {report.fullDays.map((f) => (
        <Finding
          key={`${f.nodeId ?? '-'}|${f.phase}`}
          tone="warn"
          icon={Clock}
          title={`${f.count.toLocaleString()} path${f.count === 1 ? '' : 's'} skip a whole day`}
          detail={`${f.nodeId ? `“${nodeLabel(f.nodeId)}”` : 'A node'} runs “advance to ${f.phase}” while it's already ${f.phase}, so time moves on to the next ${f.phase}. If you meant “make it ${f.phase} if it isn't yet”, use “advance until ${f.phase}”.`}
          onFocus={f.nodeId ? () => focusNode(flowId, f.nodeId!) : undefined}
          onReplay={() => onReplay(f.example)}
        />
      ))}
      {unmarked.map((e) => (
        <Finding
          key={e.nodeId ?? '-'}
          tone="warn"
          icon={AlertTriangle}
          title={`${e.count.toLocaleString()} path${e.count === 1 ? '' : 's'} stop at a node that isn't marked End`}
          detail={e.nodeId ? `“${nodeLabel(e.nodeId)}”: nothing that follows is available. Mark it End if that's intended.` : e.text}
          onFocus={e.nodeId ? () => focusNode(flowId, e.nodeId!) : undefined}
          onReplay={() => onReplay(e.example)}
        />
      ))}

      {report.unreached.length > 0 && (
        <section>
          <h3 className="mb-1 text-2xs font-semibold uppercase tracking-wider text-faint">Never reached ({report.unreached.length})</h3>
          <p className="mb-1.5 text-2xs text-faint">No path from this starting state gets here. Try varying the start, or check the requirements leading in.</p>
          <div className="flex flex-col gap-1">
            {report.unreached.slice(0, 40).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => focusNode(flowId, id)}
                className="flex items-center gap-1.5 truncate rounded-md border border-line bg-bg px-2 py-1 text-left text-xs text-fg hover:border-accent/50"
              >
                <Crosshair size={11} className="shrink-0 text-faint" />
                <span className="truncate">{nodeLabel(id)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {report.endings.length > 0 && (
        <section>
          <h3 className="mb-1 text-2xs font-semibold uppercase tracking-wider text-faint">Where paths end</h3>
          {report.random && <p className="mb-1.5 text-2xs text-faint">Shares count each choice path once, split by the odds of every chance() and roll() along it.</p>}
          <div className="flex flex-col gap-1">
            {report.endings.map((e) => (
              <div key={e.nodeId ?? '-'} className="rounded-md border border-line bg-bg px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  {e.marked ? <Flag size={11} className="shrink-0 text-muted" /> : <AlertTriangle size={11} className="shrink-0 text-warn" />}
                  <button type="button" className="min-w-0 flex-1 truncate text-left text-xs text-fg hover:underline" onClick={() => e.nodeId && focusNode(flowId, e.nodeId)}>
                    {e.text}
                  </button>
                  <span className="shrink-0 tabular-nums text-2xs text-muted">{Math.round((e.weight / Math.max(1e-12, report.weight)) * 1000) / 10}%</span>
                  <button type="button" onClick={() => onReplay(e.example)} className="shrink-0 text-2xs text-accent hover:underline" title="Play this path in the Play tab">
                    Replay
                  </button>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded bg-raised">
                  <div className="h-full rounded bg-accent/60" style={{ width: `${Math.max(2, (e.weight / Math.max(1e-12, report.weight)) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {report.ranges.length > 0 && (
        <section>
          <h3 className="mb-1 text-2xs font-semibold uppercase tracking-wider text-faint">Numbers</h3>
          <p className="mb-1.5 text-2xs text-faint">Where each number ends up, and how far it swings along the way. A change past a min or max is cut short there.</p>
          <div className="flex flex-col">
            {report.ranges.map((r) => (
              <RangeRow key={r.key} r={r} />
            ))}
          </div>
        </section>
      )}

      {report.times.length > 0 && (
        <p className="text-2xs text-faint">
          Paths end on {report.times.slice(0, 4).map((t) => `${t.label} (${t.count.toLocaleString()})`).join(', ')}
          {report.times.length > 4 ? ', …' : ''}.
        </p>
      )}
    </div>
  )
}

function RangeRow({ r }: { r: ExploreReport['ranges'][number] }) {
  const unbounded = r.defMin === undefined && r.defMax === undefined
  const span = (a: number, b: number) => (a === b ? String(a) : `${a} … ${b}`)
  const pct = (x: number) => (x >= 0.995 ? 'every path' : x < 0.005 ? '<1% of paths' : `${Math.round(x * 100)}% of paths`)
  const swings = r.low < r.min || r.high > r.max
  return (
    <div className="border-b border-line/60 py-1.5 last:border-0">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 break-words font-mono text-2xs text-muted" title={r.key}>
          {r.label}
        </span>
        <span className="shrink-0 tabular-nums text-xs text-fg" title="At the end of a path">
          {span(r.min, r.max)}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs">
        {swings && <span className="text-faint">along the way {span(r.low, r.high)}</span>}
        {unbounded ? (
          <span className="text-warn" title="No min or max set, so nothing stops it drifting">no range set</span>
        ) : (
          <span className="text-faint">
            range {r.defMin ?? '−∞'} to {r.defMax ?? '∞'}
          </span>
        )}
        {r.cappedHigh > 0 && <span className="text-loop">held at max {r.defMax} on {pct(r.cappedHigh)}</span>}
        {r.cappedLow > 0 && <span className="text-loop">held at min {r.defMin} on {pct(r.cappedLow)}</span>}
      </div>
    </div>
  )
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-bg/40 px-2.5 py-2">
      <p className={`text-base font-semibold tabular-nums ${warn ? 'text-warn' : 'text-fg'}`}>{value}</p>
      <p className="text-2xs text-muted">{label}</p>
      <p className="text-2xs text-faint">{sub}</p>
    </div>
  )
}

function Finding({
  tone,
  icon: Icon,
  title,
  detail,
  onReplay,
  onFocus
}: {
  tone: 'warn' | 'danger'
  icon: typeof AlertTriangle
  title: string
  detail: string
  onReplay?: () => void
  onFocus?: () => void
}) {
  const color = tone === 'danger' ? 'border-danger/40 bg-danger/10 text-danger' : 'border-warn/40 bg-warn/10 text-warn'
  return (
    <div className={`rounded-md border px-2.5 py-2 ${color}`}>
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <Icon size={13} className="shrink-0" /> {title}
      </p>
      <p className="mt-1 text-2xs leading-relaxed text-muted">{detail}</p>
      <div className="mt-1.5 flex gap-3">
        {onFocus && (
          <button type="button" onClick={onFocus} className="text-2xs text-accent hover:underline">
            Show node
          </button>
        )}
        {onReplay && (
          <button type="button" onClick={onReplay} className="text-2xs text-accent hover:underline">
            Replay an example
          </button>
        )}
      </div>
    </div>
  )
}
