import type { Project } from '../schema'
import type { CompileContext, Mode } from './check'
import { tokenize, type Token } from './syntax'
import { parseTemplate, replacePlaceholder } from './template'

/** Node data fields that hold expressions. */
export const NODE_EXPR_FIELDS = {
  expression: 'condition',
  script: 'action',
  requires: 'condition',
  effects: 'action'
} as const satisfies Record<string, Mode>

export type NodeExprField = keyof typeof NODE_EXPR_FIELDS

/** A Condition node's condition runs once per visit, so it may roll dice. */
export const CONDITION_NODE_CTX: CompileContext = Object.freeze({ allowRandom: true })

/** The compile context for a node's expression field. */
export function nodeFieldCtx(field: string): CompileContext {
  return field === 'expression' ? CONDITION_NODE_CTX : NO_CTX
}
const NO_CTX: CompileContext = Object.freeze({})

export const FIELD_LABELS: Record<string, string> = {
  expression: 'Condition',
  script: 'Instruction',
  requires: 'Requires',
  effects: 'Effects',
  condition: 'Condition',
  setup: 'Setup',
  checks: 'Checks',
  text: 'Line',
  menuText: 'Choice text'
}

/** Dialogue fields that may hold variables inside lines (`{Player.Coins}`). */
export const TEXT_FIELDS = ['text', 'menuText'] as const

/** Placeholders are shown, not tested, so they're plain values with no dice. */
export const VALUE_CTX: CompileContext = Object.freeze({})

export type SiteOwner =
  | { kind: 'node'; flowId: string; nodeId: string }
  | { kind: 'rule'; ruleId: string }
  | { kind: 'scenario'; scenarioId: string }
  | { kind: 'test'; testId: string }

/** The id of whatever owns an expression (a node, rule, scenario or test). */
export function siteOwnerId(owner: SiteOwner): string {
  switch (owner.kind) {
    case 'node':
      return owner.nodeId
    case 'rule':
      return owner.ruleId
    case 'scenario':
      return owner.scenarioId
    case 'test':
      return owner.testId
  }
}

/** Scenario setups set the starting state: no time travel (day and phase are their own fields). */
export const SETUP_CTX: CompileContext = Object.freeze({ allowAdvance: false })
/** Story test checks are plain conditions, checked once. */
export const CHECKS_CTX: CompileContext = Object.freeze({})

export interface ExprSite {
  owner: SiteOwner
  field: string
  mode: Mode
  source: string
  ctx: CompileContext
  set(source: string): void
}

/**
 * Every expression in the project, with a setter for rewriting it in place (works on Immer drafts).
 * Story material (scenario setups and test checks) is only included when asked for: it
 * follows renames, but it isn't part of the story, so it doesn't count as a use of state.
 */
export function forEachSite(project: Project, fn: (site: ExprSite) => void, options: { includeTests?: boolean } = {}): void {
  for (const flow of Object.values(project.flows)) {
    for (const node of Object.values(flow.nodes)) {
      for (const [field, mode] of Object.entries(NODE_EXPR_FIELDS)) {
        const source = node.data[field]
        if (typeof source !== 'string' || !source.trim()) continue
        fn({
          owner: { kind: 'node', flowId: flow.id, nodeId: node.id },
          field,
          mode,
          source,
          ctx: nodeFieldCtx(field),
          set: (s) => (node.data[field] = s)
        })
      }
      if (node.type !== 'dialogue') continue
      for (const field of TEXT_FIELDS) {
        const text = node.data[field]
        if (typeof text !== 'string' || !text.includes('{')) continue
        let k = 0
        for (const part of parseTemplate(text).parts) {
          if (part.kind !== 'expr') continue
          const index = k++
          fn({
            owner: { kind: 'node', flowId: flow.id, nodeId: node.id },
            field,
            mode: 'value',
            source: part.source,
            ctx: VALUE_CTX,
            // Placeholders are found again each time, so several renames in one line stay in step.
            set: (s) => (node.data[field] = replacePlaceholder(String(node.data[field] ?? ''), index, s))
          })
        }
      }
    }
  }
  for (const rule of Object.values(project.state.rules)) {
    const ctx: CompileContext = { selfTemplateId: rule.forEachTemplateId, allowAdvance: false }
    if (rule.condition.trim()) fn({ owner: { kind: 'rule', ruleId: rule.id }, field: 'condition', mode: 'condition', source: rule.condition, ctx, set: (s) => (rule.condition = s) })
    if (rule.effects.trim()) fn({ owner: { kind: 'rule', ruleId: rule.id }, field: 'effects', mode: 'action', source: rule.effects, ctx, set: (s) => (rule.effects = s) })
  }
  if (!options.includeTests) return
  for (const sc of Object.values(project.scenarios ?? {})) {
    if (sc.setup.trim()) fn({ owner: { kind: 'scenario', scenarioId: sc.id }, field: 'setup', mode: 'action', source: sc.setup, ctx: SETUP_CTX, set: (s) => (sc.setup = s) })
  }
  for (const t of Object.values(project.tests ?? {})) {
    if (t.checks.trim()) fn({ owner: { kind: 'test', testId: t.id }, field: 'checks', mode: 'condition', source: t.checks, ctx: CHECKS_CTX, set: (s) => (t.checks = s) })
  }
}

// ---------------------------------------------------------------------------
// Rename-following

export type RenameChange =
  | { kind: 'entity'; from: string; to: string }
  | { kind: 'variable'; fromNamespace: string; fromName: string; toNamespace: string; toName: string }
  | { kind: 'property'; templateId: string; from: string; to: string }
  | { kind: 'relationship'; fromTemplateId: string; toTemplateId: string; from: string; to: string }

/**
 * Rewrite expressions after a technical name changes, so renaming
 * “Keeper” to “OldKeeper” updates `Keeper.Mood` everywhere. Works token by
 * token, so comments, strings and spacing are left untouched.
 */
export function applyRename(project: Project, change: RenameChange): number {
  if ('from' in change && change.from === change.to) return 0
  const templateOf = (name: string, selfTemplateId: string | null | undefined): string | null => {
    if (name === 'self') return selfTemplateId ?? null
    const e = Object.values(project.entities).find((x) => x.technicalName === name)
    return e?.templateId ?? null
  }
  const isNamespace = (name: string) => Object.values(project.state.variables).some((v) => v.namespace === name)
  let changed = 0

  forEachSite(project, (site) => {
    const { tokens } = tokenize(site.source)
    const t = tokens.filter((x) => x.kind !== 'newline')
    const edits: Array<{ tok: Token; value: string }> = []
    const op = (i: number, v: string) => t[i]?.kind === 'op' && t[i].value === v
    const id = (i: number) => (t[i]?.kind === 'ident' ? t[i].value : null)

    for (let i = 0; i < t.length; i++) {
      if (t[i].kind !== 'ident') continue
      const afterDot = op(i - 1, '.')
      switch (change.kind) {
        case 'entity': {
          if (t[i].value !== change.from || afterDot) break
          const head = op(i + 1, '.') || op(i + 1, '->')
          const relTarget = op(i - 1, '->')
          if ((head && !isNamespace(change.from)) || relTarget) edits.push({ tok: t[i], value: change.to })
          break
        }
        case 'variable': {
          if (afterDot || t[i].value !== change.fromNamespace || !op(i + 1, '.') || id(i + 2) !== change.fromName) break
          if (change.toNamespace !== change.fromNamespace) edits.push({ tok: t[i], value: change.toNamespace })
          if (change.toName !== change.fromName) edits.push({ tok: t[i + 2], value: change.toName })
          break
        }
        case 'property': {
          if (afterDot || op(i - 1, '->') || !op(i + 1, '.') || id(i + 2) !== change.from || isNamespace(t[i].value)) break
          if (templateOf(t[i].value, site.ctx.selfTemplateId) === change.templateId) edits.push({ tok: t[i + 2], value: change.to })
          break
        }
        case 'relationship': {
          if (afterDot || !op(i + 1, '->') || id(i + 2) === null || !op(i + 3, '.') || id(i + 4) !== change.from) break
          if (
            templateOf(t[i].value, site.ctx.selfTemplateId) === change.fromTemplateId &&
            templateOf(t[i + 2].value, site.ctx.selfTemplateId) === change.toTemplateId
          ) {
            edits.push({ tok: t[i + 4], value: change.to })
          }
          break
        }
      }
    }
    if (!edits.length) return
    let out = site.source
    for (const e of edits.sort((a, b) => b.tok.start - a.tok.start)) out = out.slice(0, e.tok.start) + e.value + out.slice(e.tok.end)
    site.set(out)
    changed++
  }, { includeTests: true })
  return changed
}
