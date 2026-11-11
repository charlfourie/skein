import { Bookmark, Dices, RotateCcw, Save, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ExportResult } from '@shared/export/build'
import { DEFAULT_SEED } from '@shared/export/runtime'
import type { ExportDef, ExportValue } from '@shared/export/types'
import { sortedScenarios } from '@shared/play/storyTests'
import type { Project } from '@shared/schema'
import { usePlay } from '../../store/play'
import { addScenario, removeScenario, updateScenario } from '../../store/ops'
import { formatValue } from '../../lib/playSession'
import { currentAsScenario, keyToExpr, loadScenario, startMatches } from '../../lib/scenarios'
import { toast } from '../../lib/toast'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { NumberInput, Select, TextInput, Toggle } from '../ui/fields'
import { currentStart, usesRandom } from './startState'

/**
 * The state a test play-through (and the explorer) starts from: the time, and
 * any world variable set to something other than its default. Kept for this
 * session only; it never changes the project.
 */
export function StartStateTab({ project, build }: { project: Project; build: ExportResult }) {
  const file = build.file
  const overrides = usePlay((s) => s.overrides)
  const startDay = usePlay((s) => s.startDay)
  const startPhase = usePlay((s) => s.startPhase)
  const seed = usePlay((s) => s.seed)
  const { setOverride, setStartTime, setSeed, resetStart } = usePlay.getState()
  const dice = useMemo(() => usesRandom(file), [file])
  const time = file.state.time
  const vars = Object.entries(file.state.variables).sort(([a], [b]) => a.localeCompare(b))
  const groups = new Map<string, [string, ExportDef][]>()
  for (const [name, def] of vars) {
    const ns = name.split('.')[0]
    groups.set(ns, [...(groups.get(ns) ?? []), [name, def]])
  }
  const changed = Object.keys(overrides).length + (startDay !== null ? 1 : 0) + (startPhase !== null ? 1 : 0) + (seed !== null ? 1 : 0)
  // Values a scenario's setup sets that this tab has no field for (entity state, relationships).
  const others = Object.entries(overrides).filter(([k]) => !k.startsWith('var:'))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs leading-relaxed text-muted">
          Test from any situation without touching the story. Play, Explore and new tests all start from here.
        </p>
        {changed > 0 && (
          <button type="button" onClick={resetStart} className="shrink-0 text-2xs text-accent hover:underline">
            Reset all ({changed})
          </button>
        )}
      </div>

      <ScenarioBar project={project} build={build} changed={changed} />

      <section className="rounded-lg border border-line bg-bg/40 p-2.5">
        <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-faint">Time</h3>
        <div className="flex items-center gap-2">
          <span className="w-10 text-xs text-muted">Day</span>
          <div className="w-20">
            <NumberInput value={startDay ?? time.start.day} onCommit={(d) => setStartTime(d === null || d === time.start.day ? null : Math.round(d), startPhase)} />
          </div>
          {time.phases.length > 0 && (
            <div className="min-w-0 flex-1">
              <Select
                value={startPhase ?? time.start.phase ?? time.phases[0]}
                options={time.phases.map((p, i) => ({ value: p, label: time.labels[i] ?? p }))}
                onChange={(p) => setStartTime(startDay, p === (time.start.phase ?? time.phases[0]) ? null : p)}
              />
            </div>
          )}
        </div>
      </section>

      {dice && (
        <section className="rounded-lg border border-line bg-bg/40 p-2.5">
          <h3 className="mb-1 text-2xs font-semibold uppercase tracking-wider text-faint">Dice</h3>
          <p className="mb-2 text-2xs text-faint">The same seed rolls the same chance() and roll() results, so a play-through can be repeated. Explore tries every outcome regardless.</p>
          <div className="flex items-center gap-2">
            <span className="w-10 text-xs text-muted">Seed</span>
            <div className="w-28">
              <NumberInput value={seed ?? DEFAULT_SEED} onCommit={(n) => setSeed(n === null || Math.round(n) === DEFAULT_SEED ? null : Math.round(Math.abs(n)) >>> 0)} />
            </div>
            <IconButton size="sm" icon={Dices} label="Roll a new seed" onClick={() => setSeed((Math.random() * 2 ** 32) >>> 0)} />
            <IconButton size="sm" icon={RotateCcw} label={`Back to the default seed (${DEFAULT_SEED})`} disabled={seed === null} onClick={() => setSeed(null)} />
          </div>
        </section>
      )}

      {[...groups.entries()].map(([ns, list]) => (
        <section key={ns} className="rounded-lg border border-line bg-bg/40 p-2.5">
          <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">{ns}</h3>
          <div className="flex flex-col gap-1.5">
            {list.map(([name, def]) => {
              const key = `var:${name}`
              const set = key in overrides
              const value = set ? overrides[key] : def.default
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className={`min-w-0 flex-1 truncate font-mono text-2xs ${set ? 'text-accent' : 'text-muted'}`} title={name}>
                    {name.slice(ns.length + 1)}
                  </span>
                  <div className="w-[136px] shrink-0">
                    <ValueInput def={def} value={value} onChange={(v) => setOverride(key, v === def.default ? undefined : v)} />
                  </div>
                  <IconButton
                    size="sm"
                    icon={RotateCcw}
                    label={`Back to the default (${formatValue(def.default)})`}
                    disabled={!set}
                    onClick={() => setOverride(key, undefined)}
                  />
                </div>
              )
            })}
          </div>
        </section>
      ))}
      {vars.length === 0 && <p className="text-xs text-faint">This project has no world variables yet.</p>}
      {others.length > 0 && (
        <section className="rounded-lg border border-line bg-bg/40 p-2.5">
          <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">Also set by the scenario</h3>
          {others.map(([k, v]) => (
            <p key={k} className="font-mono text-2xs text-accent">
              {keyToExpr(k) ?? k} = {formatValue(v)}
            </p>
          ))}
        </section>
      )}
    </div>
  )
}

/**
 * Saved scenarios: named starting states the whole team shares (they're kept
 * in the project file). Load one to test from it; save the current settings
 * as a new one, or update the one you loaded.
 */
function ScenarioBar({ project, build, changed }: { project: Project; build: ExportResult; changed: number }) {
  const scenarioId = usePlay((s) => s.scenarioId)
  const [naming, setNaming] = useState(false)
  usePlay((s) => s.seed) // the rest of the start re-renders this through the tab above
  const scenarios = sortedScenarios(project)
  const active = scenarioId ? project.scenarios?.[scenarioId] : undefined
  const play = usePlay.getState()
  const edited = active ? !startMatches(project, build, active, currentStart()) || (active.seed ?? null) !== play.seed : false
  const usedBy = active ? Object.values(project.tests ?? {}).filter((t) => t.scenarioId === active.id).length : 0

  const load = (id: string | null) => {
    const problem = loadScenario(project, build, id)
    if (problem) toast.warn("Couldn't load the scenario", problem)
  }
  const fields = () => {
    const f = currentAsScenario(project, build.file)
    if (f.skipped.length) toast.info('Some values were left out', `Empty references can't be saved in a scenario yet: ${f.skipped.join(', ')}.`)
    return f
  }
  const saveNew = (name: string) => {
    setNaming(false)
    if (!name) return
    const { skipped: _skipped, ...f } = fields()
    const id = addScenario({ ...f, name })
    if (id) usePlay.setState({ scenarioId: id })
  }
  const update = () => {
    if (!active) return
    const { skipped: _skipped, ...f } = fields()
    updateScenario(active.id, { setup: f.setup, day: f.day ?? null, phaseId: f.phaseId ?? null, seed: f.seed ?? null })
  }
  const remove = async () => {
    if (!active) return
    if (
      usedBy > 0 &&
      !(await window.api.confirm({
        message: `Delete the scenario “${active.name}”?`,
        detail: `${usedBy} story test${usedBy === 1 ? ' starts' : 's start'} from it and will need a new start.\nYou can undo this with Ctrl+Z.`,
        confirmLabel: 'Delete',
        danger: true
      }))
    )
      return
    removeScenario(active.id)
    usePlay.setState({ scenarioId: null })
  }

  return (
    <section className="rounded-lg border border-line bg-bg/40 p-2.5">
      <h3 className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">
        <Bookmark size={11} /> Scenario
      </h3>
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <Select
            value={active ? active.id : null}
            placeholder={changed > 0 && !active ? 'Unsaved start' : 'The project’s own start'}
            options={scenarios.map((sc) => ({ value: sc.id, label: sc.name || '(unnamed)' }))}
            onChange={load}
          />
        </div>
        {active && <IconButton size="sm" icon={Trash2} tone="danger" label={`Delete the scenario “${active.name}”`} onClick={remove} />}
      </div>
      {active && (
        <div className="mt-1.5">
          <TextInput value={active.name} required placeholder="Scenario name" onCommit={(name) => updateScenario(active.id, { name })} />
        </div>
      )}
      {naming ? (
        <div className="mt-1.5">
          <TextInput value="" autoFocus placeholder="Name it, e.g. Day 4, storm, 1 coin" onCommit={saveNew} />
        </div>
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {active && edited && (
            <>
              <span className="text-2xs text-warn">Edited since you loaded it.</span>
              <Button icon={Save} onClick={update}>
                Update “{active.name}”
              </Button>
            </>
          )}
          {(changed > 0 && (!active || edited)) && (
            <Button icon={Bookmark} variant={active ? 'ghost' : 'subtle'} onClick={() => setNaming(true)}>
              Save as a new scenario
            </Button>
          )}
          {active && usedBy > 0 && !edited && <span className="text-2xs text-faint">Used by {usedBy} test{usedBy === 1 ? '' : 's'}.</span>}
          {!active && changed === 0 && scenarios.length === 0 && (
            <span className="text-2xs leading-relaxed text-faint">Change the values below, then save them as a scenario the team can reuse.</span>
          )}
        </div>
      )}
    </section>
  )
}

function ValueInput({ def, value, onChange }: { def: ExportDef; value: ExportValue; onChange(v: ExportValue): void }) {
  switch (def.type) {
    case 'boolean':
      return (
        <div className="flex items-center gap-2">
          <Toggle checked={value === true} onChange={onChange} label={String(value)} />
          <span className="text-2xs text-faint">{value === true ? 'true' : 'false'}</span>
        </div>
      )
    case 'number':
      return <NumberInput value={typeof value === 'number' ? value : null} onCommit={(n) => onChange(n ?? def.default)} />
    case 'enum':
      return (
        <Select
          value={typeof value === 'string' ? value : null}
          placeholder="—"
          options={(def.options ?? []).map((o, i) => ({ value: o, label: def.labels?.[i] ?? o }))}
          onChange={(v) => onChange(v)}
        />
      )
    default:
      return <TextInput value={typeof value === 'string' ? value : ''} onCommit={(t) => onChange(t)} />
  }
}
