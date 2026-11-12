interface Orderable {
  id: string
  name: string
  order: number
}

/** Stable display order: explicit order, then name (natural), then id as a tiebreaker. */
export function compareOrder(a: Orderable, b: Orderable): number {
  return (
    a.order - b.order ||
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}
