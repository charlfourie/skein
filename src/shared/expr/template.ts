/**
 * Variables inside lines: `You have {Player.Coins} coins left.`
 *
 * A placeholder is an expression in braces, shown as its current value when the
 * line plays. `{{` and `}}` write a literal brace. Every runtime splits text the
 * same way (see docs/EXPORT.md), so this file is the reference.
 */

export type TemplatePart = { kind: 'text'; value: string } | { kind: 'expr'; source: string; start: number; end: number }

export interface TemplateProblem {
  message: string
  start: number
  end: number
}

/** Split a line into text and placeholders. `start`/`end` are the inner expression's offsets. */
export function parseTemplate(text: string): { parts: TemplatePart[]; problems: TemplateProblem[] } {
  const parts: TemplatePart[] = []
  const problems: TemplateProblem[] = []
  let buf = ''
  const flush = () => {
    if (buf) parts.push({ kind: 'text', value: buf })
    buf = ''
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '{' && text[i + 1] === '{') {
      buf += '{'
      i++
    } else if (c === '}' && text[i + 1] === '}') {
      buf += '}'
      i++
    } else if (c === '{') {
      const close = text.indexOf('}', i + 1)
      const open = text.indexOf('{', i + 1)
      if (close < 0 || (open >= 0 && open < close)) {
        problems.push({ message: 'A “{” has no matching “}”. Write {{ for a literal brace.', start: i, end: i + 1 })
        buf += c
        continue
      }
      const inner = text.slice(i + 1, close)
      if (!inner.trim()) problems.push({ message: 'Empty braces: put a value inside, such as {Player.Coins}.', start: i, end: close + 1 })
      else {
        flush()
        parts.push({ kind: 'expr', source: inner.trim(), start: i + 1, end: close })
      }
      i = close
    } else if (c === '}') {
      problems.push({ message: 'A “}” has no matching “{”. Write }} for a literal brace.', start: i, end: i + 1 })
      buf += c
    } else buf += c
  }
  flush()
  return { parts, problems }
}

/** The placeholders in a line, in order (each source once). */
export function placeholderSources(text: string): string[] {
  if (!text.includes('{')) return []
  const seen = new Set<string>()
  for (const p of parseTemplate(text).parts) if (p.kind === 'expr') seen.add(p.source)
  return [...seen]
}

/** Replace the k-th placeholder's expression, leaving the rest of the line untouched. */
export function replacePlaceholder(text: string, k: number, source: string): string {
  let n = 0
  for (const p of parseTemplate(text).parts) {
    if (p.kind !== 'expr') continue
    if (n++ === k) return text.slice(0, p.start) + source + text.slice(p.end)
  }
  return text
}
