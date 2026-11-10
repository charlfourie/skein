import type { Project } from './schema'

/**
 * Canonical, deterministic JSON writer.
 *
 * Guarantees, for any two structurally equal values:
 *  - byte-identical output,
 *  - object keys sorted by UTF-16 code unit at every depth (including
 *    integer-like keys, which JSON.stringify would hoist and sort numerically),
 *  - two-space indentation, LF line endings, one trailing newline,
 *  - `undefined` members dropped, `-0` written as `0`.
 *
 * It rejects anything that would not survive a JSON round trip unchanged
 * (NaN/Infinity, Dates, Maps, class instances, functions, cycles) instead of
 * silently coercing it, so corrupt state never reaches the disk.
 */

export class SerializationError extends Error {
  constructor(
    message: string,
    readonly path: string
  ) {
    super(`${message} at ${path}`)
    this.name = 'SerializationError'
  }
}

const INDENT = '  '

export function serializeCanonical(value: unknown, options: { compact?: boolean } = {}): string {
  const out = write(value, options.compact ? null : '', '$', new Set())
  if (out === undefined) throw new SerializationError('Top-level value is not serialisable', '$')
  return out + '\n'
}

export function serializeProject(project: Project): string {
  return serializeCanonical(project)
}

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** `indent` null = compact (no whitespace). */
function write(value: unknown, indent: string | null, path: string, ancestors: Set<object>): string | undefined {
  if (value === null) return 'null'

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value)
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) throw new SerializationError(`Non-finite number (${value})`, path)
      return JSON.stringify(Object.is(value, -0) ? 0 : value)
    case 'undefined':
      return undefined
    case 'object':
      break
    default:
      throw new SerializationError(`Unsupported value of type ${typeof value}`, path)
  }

  const obj = value as object
  if (ancestors.has(obj)) throw new SerializationError('Circular reference', path)
  ancestors.add(obj)
  try {
    const inner = indent === null ? null : indent + INDENT

    if (Array.isArray(obj)) {
      if (obj.length === 0) return '[]'
      const items = obj.map((item, i) => write(item, inner, `${path}[${i}]`, ancestors) ?? 'null')
      if (inner === null) return `[${items.join(',')}]`
      return `[\n${items.map((s) => inner + s).join(',\n')}\n${indent}]`
    }

    const proto = Object.getPrototypeOf(obj)
    if (proto !== Object.prototype && proto !== null) {
      const name = (obj as { constructor?: { name?: string } }).constructor?.name ?? 'unknown'
      throw new SerializationError(`Unsupported object type (${name})`, path)
    }

    const record = obj as Record<string, unknown>
    const entries: string[] = []
    for (const key of Object.keys(record).sort(compareKeys)) {
      const s = write(record[key], inner, `${path}.${key}`, ancestors)
      if (s !== undefined) entries.push(inner === null ? `${JSON.stringify(key)}:${s}` : `${inner}${JSON.stringify(key)}: ${s}`)
    }
    if (entries.length === 0) return '{}'
    if (inner === null) return `{${entries.join(',')}}`
    return `{\n${entries.join(',\n')}\n${indent}}`
  } finally {
    ancestors.delete(obj)
  }
}
