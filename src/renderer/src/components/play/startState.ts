import type { ExportDef, ExportFile } from '@shared/export/types'
import type { StartState, StateKey, Variation } from '@shared/play/explore'
import { usePlay } from '../../store/play'

/** The starting state the designer set up in the Start state tab. */
export function currentStart(): StartState {
  const s = usePlay.getState()
  return {
    values: { ...s.overrides },
    ...(s.startDay !== null ? { day: s.startDay } : {}),
    ...(s.startPhase !== null ? { phase: s.startPhase } : {}),
    ...(s.seed !== null ? { seed: s.seed } : {})
  }
}

/**
 * Turn the Explore tab's "vary" settings into variations:
 *   "both" (booleans) → [false, true]
 *   "all"  (enums)    → every option
 *   "0, 3, 5"         → those numbers (or words, for text values)
 */
export function variationsFor(file: ExportFile, vary: Record<StateKey, string>): { variations: Variation[]; problems: string[] } {
  const variations: Variation[] = []
  const problems: string[] = []
  for (const [key, spec] of Object.entries(vary)) {
    const def = defFor(file, key)
    if (!def) continue
    const s = spec.trim().toLowerCase()
    if (def.type === 'boolean') variations.push({ key, values: [false, true] })
    else if (def.type === 'enum' && s === 'all') variations.push({ key, values: [...(def.options ?? [])] })
    else {
      const parts = spec.split(',').map((p) => p.trim()).filter(Boolean)
      if (def.type === 'number') {
        const nums = parts.map(Number)
        if (nums.some((n) => !Number.isFinite(n))) problems.push(`${key.slice(4)}: “${spec}” isn't a list of numbers.`)
        else if (nums.length) variations.push({ key, values: [...new Set(nums)] })
      } else if (parts.length) variations.push({ key, values: [...new Set(parts)] })
    }
  }
  return { variations, problems }
}

/** The export rolls dice somewhere (chance() or roll()). */
export function usesRandom(file: ExportFile): boolean {
  let found = false
  JSON.stringify(file, (k, v) => {
    if (k === 'chance' || k === 'roll') found = true
    return found ? undefined : v
  })
  return found
}

export function defFor(file: ExportFile, key: StateKey): ExportDef | undefined {
  return key.startsWith('var:') ? file.state.variables[key.slice(4)] : undefined
}

/** How many starting states the variations produce. */
export function combinationCount(variations: Variation[]): number {
  return variations.reduce((n, v) => n * Math.max(1, v.values.length), 1)
}

