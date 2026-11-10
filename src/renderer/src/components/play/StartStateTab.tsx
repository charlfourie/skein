import { Dices, RotateCcw } from 'lucide-react'
import { useMemo } from 'react'
import { DEFAULT_SEED } from '@shared/export/runtime'
import type { ExportDef, ExportFile, ExportValue } from '@shared/export/types'
import { usePlay } from '../../store/play'
import { formatValue } from '../../lib/playSession'
import { IconButton } from '../ui/IconButton'
import { NumberInput, Select, TextInput, Toggle } from '../ui/fields'
import { usesRandom } from './startState'

/**
 * The state a test play-through (and the explorer) starts from: the time, and
 * any world variable set to something other than its default. Kept for this
 * session only; it never changes the project.
 */
export function StartStateTab({ file }: { file: ExportFile }) {
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs leading-relaxed text-muted">
          Test from any situation without touching the project. Play and Explore both start from here.
        </p>
        {changed > 0 && (
          <button type="button" onClick={resetStart} className="shrink-0 text-2xs text-accent hover:underline">
            Reset all ({changed})
          </button>
        )}
      </div>

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
    </div>
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
