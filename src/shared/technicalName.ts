/**
 * Technical names are the identifiers scripts and game engines use to refer to
 * templates, properties and entities (e.g. `Keeper.IsAlive`). They default to a
 * PascalCase form of the display name and stay in sync with it until the
 * designer edits them by hand.
 */

export const TECHNICAL_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

export function toTechnicalName(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // strip accents: "Café" → "Cafe"
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
  let result = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('')
  if (!result) result = 'Unnamed'
  if (/^[0-9]/.test(result)) result = `_${result}`
  return result
}

/** `base`, or `base2`, `base3`… — whichever isn't taken (case-insensitive). */
export function uniqueTechnicalName(base: string, taken: Iterable<string>): string {
  const used = new Set(Array.from(taken, (t) => t.toLowerCase()))
  if (!used.has(base.toLowerCase())) return base
  for (let i = 2; ; i++) {
    const candidate = `${base}${i}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}

/** True when `technicalName` is still the auto-generated form of `name` (so it should follow renames). */
export function isDerivedTechnicalName(technicalName: string, name: string): boolean {
  const base = toTechnicalName(name)
  return technicalName === base || new RegExp(`^${base}\\d+$`).test(technicalName)
}
