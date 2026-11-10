import { Fragment, type ReactNode } from 'react'

/**
 * An expression as written, made easier to read on the canvas:
 *   - `->` shows as →, and `>=` `<=` `!=` as ≥ ≤ ≠
 *   - long names only wrap after an arrow or a dot, never mid-word or at "-"
 *   - keywords, numbers and comments are tinted
 * The text itself is unchanged (copy still gives the source).
 */
const TOKEN =
  /(#[^\n]*)|([A-Za-z_]\w*(?:\s*(?:\.|->|→)\s*[A-Za-z_]\w*)*)|(\d+(?:\.\d+)?)|(->|>=|<=|!=|==|&&|\|\|)|("[^"\n]*"?|'[^'\n]*'?)/g

const KEYWORDS = new Set(['and', 'or', 'not', 'is', 'true', 'false', 'advance', 'to', 'until'])
const DICE = new Set(['chance', 'roll'])
const OPS: Record<string, string> = { '->': '→', '>=': '≥', '<=': '≤', '!=': '≠' }

export function ExprText({ source }: { source: string }) {
  const out: ReactNode[] = []
  let last = 0
  let k = 0
  for (const m of source.matchAll(TOKEN)) {
    const i = m.index ?? 0
    if (i > last) out.push(source.slice(last, i))
    const [all, comment, name, num, op, str] = m
    if (comment) out.push(<span key={k++} className="italic text-faint">{comment}</span>)
    else if (name) {
      if (KEYWORDS.has(name)) out.push(<span key={k++} className="text-accent">{name}</span>)
      else if (DICE.has(name)) out.push(<span key={k++} className="text-loop">{name}</span>)
      else out.push(<Name key={k++} text={name} />)
    } else if (num) out.push(<span key={k++} className="text-ok">{num}</span>)
    else if (op) out.push(<span key={k++} className="text-muted">{OPS[op] ?? op}</span>)
    else if (str) out.push(<span key={k++} className="text-warn">{str}</span>)
    else out.push(all)
    last = i + all.length
  }
  if (last < source.length) out.push(source.slice(last))
  return <>{out}</>
}

/** A dotted / arrowed name with break points only after → and "." (and nowhere inside a word). */
function Name({ text }: { text: string }) {
  const parts = text.replace(/\s+/g, '').split(/(->|→|\.)/)
  return (
    <span className="[overflow-wrap:anywhere]">
      {parts.map((p, i) =>
        p === '->' || p === '→' ? (
          <Fragment key={i}>
            <span className="text-muted">→</span>
            <wbr />
          </Fragment>
        ) : p === '.' ? (
          <Fragment key={i}>
            .<wbr />
          </Fragment>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        )
      )}
    </span>
  )
}
