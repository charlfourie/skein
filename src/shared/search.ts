/**
 * Project-wide search, and find and replace.
 *
 * Search looks through everything a writer types: lines, choice text, hub and
 * frame labels, conditions and actions, designer notes, comments, and the
 * names of flows, entities, templates and variables. Each result is one match,
 * with where it is and the text around it.
 *
 * Replace works on lines, labels, notes and comments, and on conditions and
 * actions with a safety check: a replacement that would leave an expression
 * with an error it didn't have before is refused, and reported. Names are
 * never replaced here: renaming them goes through rename, which follows every
 * use. Pure functions; the editor applies replacements as one undo step.
 */
import { compile, type Mode } from './expr/check'
import { NODE_EXPR_FIELDS, nodeFieldCtx } from './expr/sites'
import type { Project } from './schema'

/** What a field holds, for filtering. Only `names` can't be replaced here. */
export type SearchCategory = 'text' | 'logic' | 'notes' | 'names'
export const SEARCH_CATEGORIES: readonly SearchCategory[] = ['text', 'logic', 'notes', 'names']

/** Where a match is. Enough to show it, jump to it, and change it. */
export type SearchTarget =
  | { kind: 'node'; flowId: string; nodeId: string; field: string }
  | { kind: 'frame'; flowId: string; frameId: string }
  | { kind: 'comment'; flowId: string; nodeId: string; commentId: string }
  | { kind: 'rule'; ruleId: string; field: 'name' | 'condition' | 'effects' }
  | { kind: 'flow'; flowId: string }
  | { kind: 'entity'; entityId: string; field: 'name' | 'technicalName' }
  | { kind: 'template'; templateId: string }
  | { kind: 'variable'; variableId: string }

export interface SearchOptions {
  query: string
  matchCase?: boolean
  wholeWord?: boolean
  regex?: boolean
  /** Only these kinds of field (default: all). */
  categories?: readonly SearchCategory[]
  /** Only this flow (rules and names are outside every flow, so they're left out). */
  flowId?: string | null
  /** Only lines spoken by this entity (and the comments on them). */
  speakerId?: string | null
}

export interface SearchMatch {
  target: SearchTarget
  category: SearchCategory
  /** "Line", "Choice text", "Condition", "Note"… */
  fieldLabel: string
  /** The flow it's in, if any, for grouping. */
  flowId: string | null
  /** The whole field, and where the match is in it. */
  value: string
  start: number
  end: number
  /** The n-th match in this field (for replacing just this one). */
  index: number
}

export interface SearchResult {
  matches: SearchMatch[]
  /** The query couldn't be used (an invalid regular expression). */
  error?: string
  /** Stopped at the limit: refine the search to see the rest. */
  truncated: boolean
}

export const MAX_MATCHES = 2000

const FIELD_LABELS: Record<string, string> = {
  text: 'Line',
  menuText: 'Choice text',
  label: 'Label',
  expression: 'Condition',
  script: 'Instruction',
  requires: 'Requires',
  effects: 'Effects',
  note: 'Note',
  tag: 'Tag'
}

/** Node data fields, in the order they read on a node. */
const NODE_FIELDS: readonly { field: string; category: SearchCategory }[] = [
  { field: 'text', category: 'text' },
  { field: 'menuText', category: 'text' },
  { field: 'label', category: 'text' },
  { field: 'expression', category: 'logic' },
  { field: 'script', category: 'logic' },
  { field: 'requires', category: 'logic' },
  { field: 'effects', category: 'logic' },
  { field: 'note', category: 'notes' },
  { field: 'tag', category: 'names' }
]

/** The pattern for a search, or an error message. Matches are always global. */
export function searchPattern(opts: Pick<SearchOptions, 'query' | 'matchCase' | 'wholeWord' | 'regex'>): RegExp | { error: string } | null {
  if (!opts.query) return null
  let source = opts.regex ? opts.query : opts.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (opts.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`
  try {
    const re = new RegExp(source, `gu${opts.matchCase ? '' : 'i'}`)
    // A pattern that matches nothing at all (e.g. `a*` on "") would loop forever: refuse empty matches.
    if (re.test('')) return { error: 'This pattern matches empty text. Make it match at least one character.' }
    re.lastIndex = 0
    return re
  } catch (err) {
    return { error: `Not a valid regular expression: ${err instanceof Error ? err.message.replace(/^Invalid regular expression: /, '') : String(err)}` }
  }
}

interface Field {
  target: SearchTarget
  category: SearchCategory
  fieldLabel: string
  flowId: string | null
  value: string
}

/** Every searchable field, in a stable order: flows (by order), then rules, then names. */
export function searchableFields(project: Project, opts: Pick<SearchOptions, 'flowId' | 'speakerId'> = {}): Field[] {
  const out: Field[] = []
  const flows = Object.values(project.flows)
    .filter((f) => !opts.flowId || f.id === opts.flowId)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1))
  for (const flow of flows) {
    const nodes = Object.values(flow.nodes).sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x || (a.id < b.id ? -1 : 1))
    const spoken = (nodeId: string) => !opts.speakerId || flow.nodes[nodeId]?.data.speakerId === opts.speakerId
    for (const node of nodes) {
      if (!spoken(node.id)) continue
      for (const { field, category } of NODE_FIELDS) {
        const v = node.data[field]
        if (typeof v !== 'string' || !v) continue
        out.push({ target: { kind: 'node', flowId: flow.id, nodeId: node.id, field }, category, fieldLabel: FIELD_LABELS[field], flowId: flow.id, value: v })
      }
    }
    for (const c of Object.values(flow.comments ?? {}).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.id < b.id ? -1 : 1))) {
      if (!c.text || !flow.nodes[c.nodeId] || !spoken(c.nodeId)) continue
      out.push({ target: { kind: 'comment', flowId: flow.id, nodeId: c.nodeId, commentId: c.id }, category: 'notes', fieldLabel: c.parentId ? 'Reply' : 'Comment', flowId: flow.id, value: c.text })
    }
    if (opts.speakerId) continue
    for (const fr of Object.values(flow.frames ?? {})) {
      if (fr.label) out.push({ target: { kind: 'frame', flowId: flow.id, frameId: fr.id }, category: 'text', fieldLabel: 'Frame', flowId: flow.id, value: fr.label })
    }
    out.push({ target: { kind: 'flow', flowId: flow.id }, category: 'names', fieldLabel: 'Flow name', flowId: flow.id, value: flow.name })
  }
  if (opts.flowId || opts.speakerId) return out
  for (const r of Object.values(project.state.rules).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))) {
    if (r.name) out.push({ target: { kind: 'rule', ruleId: r.id, field: 'name' }, category: 'names', fieldLabel: 'Rule name', flowId: null, value: r.name })
    if (r.condition) out.push({ target: { kind: 'rule', ruleId: r.id, field: 'condition' }, category: 'logic', fieldLabel: 'Rule condition', flowId: null, value: r.condition })
    if (r.effects) out.push({ target: { kind: 'rule', ruleId: r.id, field: 'effects' }, category: 'logic', fieldLabel: 'Rule effects', flowId: null, value: r.effects })
  }
  for (const e of Object.values(project.entities).sort((a, b) => a.name.localeCompare(b.name))) {
    out.push({ target: { kind: 'entity', entityId: e.id, field: 'name' }, category: 'names', fieldLabel: 'Entity', flowId: null, value: e.name })
    if (e.technicalName && e.technicalName !== e.name)
      out.push({ target: { kind: 'entity', entityId: e.id, field: 'technicalName' }, category: 'names', fieldLabel: 'Technical name', flowId: null, value: e.technicalName })
  }
  for (const t of Object.values(project.templates).sort((a, b) => a.name.localeCompare(b.name))) {
    out.push({ target: { kind: 'template', templateId: t.id }, category: 'names', fieldLabel: 'Template', flowId: null, value: t.name })
  }
  for (const v of Object.values(project.state.variables).sort((a, b) => a.namespace.localeCompare(b.namespace) || a.technicalName.localeCompare(b.technicalName))) {
    out.push({ target: { kind: 'variable', variableId: v.id }, category: 'names', fieldLabel: 'Variable', flowId: null, value: `${v.namespace}.${v.technicalName}` })
  }
  return out
}

export function searchProject(project: Project, opts: SearchOptions): SearchResult {
  const pattern = searchPattern(opts)
  if (!pattern) return { matches: [], truncated: false }
  if (!(pattern instanceof RegExp)) return { matches: [], truncated: false, error: pattern.error }
  const allowed = new Set(opts.categories ?? SEARCH_CATEGORIES)
  const matches: SearchMatch[] = []
  for (const f of searchableFields(project, opts)) {
    if (!allowed.has(f.category)) continue
    pattern.lastIndex = 0
    let index = 0
    for (const m of f.value.matchAll(pattern)) {
      if (matches.length >= MAX_MATCHES) return { matches, truncated: true }
      matches.push({ ...f, start: m.index, end: m.index + m[0].length, index: index++ })
    }
  }
  return { matches, truncated: false }
}

// ---------------------------------------------------------------------------
// Replace

export function canReplace(m: Pick<SearchMatch, 'category'>): boolean {
  return m.category !== 'names'
}

/** The replacement for one match: `$1`, `$&` and `$<name>` work with regular expressions; elsewhere the text is used as written. */
function substitute(pattern: RegExp, match: string, replacement: string, regex: boolean): string {
  if (!regex) return replacement
  const one = new RegExp(pattern.source, pattern.flags.replace('g', ''))
  return match.replace(one, replacement)
}

/** Replace in one field's text: every match, or only the ones numbered in `only` (0 = the first match). */
export function replaceInText(value: string, pattern: RegExp, replacement: string, regex: boolean, only?: ReadonlySet<number>): string {
  let out = ''
  let last = 0
  let n = 0
  pattern.lastIndex = 0
  for (const m of value.matchAll(pattern)) {
    const i = n++
    if (only && !only.has(i)) continue
    out += value.slice(last, m.index) + substitute(pattern, m[0], replacement, regex)
    last = m.index + m[0].length
  }
  return out + value.slice(last)
}

/** A field a replacement would change, before and after. */
export interface PlannedChange {
  target: SearchTarget
  fieldLabel: string
  flowId: string | null
  before: string
  after: string
  /** How many matches in this field change. */
  count: number
  /** Why this one won't be changed (an expression the replacement would break). */
  refused?: string
}

/**
 * Work out what replacing these matches would do, field by field, without
 * changing anything. Fields that can't be replaced here (names) are skipped.
 */
export function planReplace(project: Project, matches: readonly SearchMatch[], opts: SearchOptions, replacement: string): PlannedChange[] {
  const pattern = searchPattern(opts)
  if (!(pattern instanceof RegExp)) return []
  const byField = new Map<string, { m: SearchMatch; indexes: number[] }>()
  for (const m of matches) {
    if (!canReplace(m)) continue
    const key = targetKey(m.target)
    const entry = byField.get(key) ?? { m, indexes: [] }
    entry.indexes.push(m.index)
    byField.set(key, entry)
  }
  const plan: PlannedChange[] = []
  for (const { m, indexes } of byField.values()) {
    const before = readTarget(project, m.target)
    if (before === null) continue
    const wanted = new Set(indexes)
    const after = replaceInText(before, pattern, replacement, opts.regex === true, wanted)
    if (after === before) continue
    const change: PlannedChange = { target: m.target, fieldLabel: m.fieldLabel, flowId: m.flowId, before, after, count: wanted.size }
    const mode = expressionMode(m.target)
    if (mode) {
      const ctx = expressionCtx(project, m.target)
      const was = compile(project, before, mode, ctx).diagnostics.filter((d) => d.level === 'error').length
      const now = compile(project, after, mode, ctx).diagnostics.find((d) => d.level === 'error')
      if (now && was === 0) change.refused = `${m.fieldLabel} would stop working: ${now.message}`
    }
    plan.push(change)
  }
  return plan
}

/** Apply a plan's changes (except refused ones) to a project. Works on Immer drafts. Returns how many fields changed. */
export function applyReplace(project: Project, plan: readonly PlannedChange[]): number {
  let n = 0
  for (const c of plan) {
    if (c.refused) continue
    // Only change a field that still says what the plan saw, so a stale plan never overwrites newer text.
    if (readTarget(project, c.target) !== c.before) continue
    if (writeTarget(project, c.target, c.after)) n++
  }
  return n
}

export function targetKey(t: SearchTarget): string {
  switch (t.kind) {
    case 'node':
      return `node:${t.flowId}:${t.nodeId}:${t.field}`
    case 'frame':
      return `frame:${t.flowId}:${t.frameId}`
    case 'comment':
      return `comment:${t.flowId}:${t.commentId}`
    case 'rule':
      return `rule:${t.ruleId}:${t.field}`
    case 'flow':
      return `flow:${t.flowId}`
    case 'entity':
      return `entity:${t.entityId}:${t.field}`
    case 'template':
      return `template:${t.templateId}`
    case 'variable':
      return `variable:${t.variableId}`
  }
}

export function readTarget(project: Project, t: SearchTarget): string | null {
  switch (t.kind) {
    case 'node': {
      const v = project.flows[t.flowId]?.nodes[t.nodeId]?.data[t.field]
      return typeof v === 'string' ? v : null
    }
    case 'frame':
      return project.flows[t.flowId]?.frames?.[t.frameId]?.label ?? null
    case 'comment':
      return project.flows[t.flowId]?.comments?.[t.commentId]?.text ?? null
    case 'rule': {
      const r = project.state.rules[t.ruleId]
      return r ? r[t.field] : null
    }
    default:
      return null // names aren't replaced here
  }
}

function writeTarget(project: Project, t: SearchTarget, value: string): boolean {
  switch (t.kind) {
    case 'node': {
      const node = project.flows[t.flowId]?.nodes[t.nodeId]
      if (!node) return false
      // Empty text is stored as absent, like everywhere else in the file.
      if (value) node.data[t.field] = value
      else delete node.data[t.field]
      return true
    }
    case 'frame': {
      const fr = project.flows[t.flowId]?.frames?.[t.frameId]
      if (!fr) return false
      fr.label = value
      return true
    }
    case 'comment': {
      const c = project.flows[t.flowId]?.comments?.[t.commentId]
      if (!c || !value.trim()) return false // a comment can't be emptied by a replace
      c.text = value
      return true
    }
    case 'rule': {
      const r = project.state.rules[t.ruleId]
      if (!r) return false
      r[t.field] = value
      return true
    }
    default:
      return false
  }
}

function expressionMode(t: SearchTarget): Mode | null {
  if (t.kind === 'node') return (NODE_EXPR_FIELDS as Record<string, Mode>)[t.field] ?? null
  if (t.kind === 'rule' && t.field !== 'name') return t.field === 'condition' ? 'condition' : 'action'
  return null
}

function expressionCtx(project: Project, t: SearchTarget) {
  if (t.kind === 'node') return nodeFieldCtx(t.field)
  if (t.kind === 'rule') return { selfTemplateId: project.state.rules[t.ruleId]?.forEachTemplateId ?? null, allowAdvance: false }
  return {}
}
