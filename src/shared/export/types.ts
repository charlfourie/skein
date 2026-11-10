/**
 * The game-engine export format ("skein.export", version 1).
 *
 * Designed to be read without Skein: no canvas data (positions, colours,
 * folders, notes), every reference by technical name, and every expression
 * pre-compiled to a small JSON tree so engines don't need a parser.
 * See docs/EXPORT.md for the full specification and run-time semantics.
 */

export const EXPORT_FORMAT = 'skein.export' as const
/** The newest format version this exporter writes. Each file carries the lowest version that can read it. */
export const EXPORT_VERSION = 2 as const

export type ExportValue = number | boolean | string | null

// --- Expressions ------------------------------------------------------------

/** A piece of state. `entity: "$self"` means the entity a rule is running for. */
export type StatePath =
  | { get: 'var'; var: string } // "World.StormRaging"
  | { get: 'prop'; entity: string; prop: string } // Keeper.Mood
  | { get: 'rel'; rel: string; from: string; to: string } // Character->Character.Trust, Keeper → Stranger
  | { get: 'time'; field: 'day' | 'phase' }
  /** v2: how many times the story has entered this node (only nodes with `count: true` are counted). */
  | { get: 'visit'; node: string }

export type ExprNode =
  | { lit: ExportValue }
  | StatePath
  | { not: ExprNode }
  | { neg: ExprNode }
  | {
      op: 'and' | 'or' | '==' | '!=' | '<' | '<=' | '>' | '>=' | 'phase<' | 'phase<=' | 'phase>' | 'phase>=' | '+' | '-' | '*' | '/'
      a: ExprNode
      b: ExprNode
    }

export type Statement =
  | { set: StatePath; op: '=' | '+=' | '-='; value: ExprNode }
  | { advance: number }
  /** `stay` (v2): do nothing if already in that phase, instead of moving a whole day. */
  | { advanceTo: string; stay?: true }

/** A compiled condition, plus (optionally) its source text for debugging. */
export interface ExportCondition {
  expr: ExprNode
  source?: string
}

export interface ExportEffects {
  do: Statement[]
  source?: string
}

// --- Definitions ------------------------------------------------------------

export type ExportType = 'text' | 'number' | 'boolean' | 'enum' | 'entity' | 'color'

export interface ExportDef {
  type: ExportType
  default: ExportValue
  /** enum: option technical names, in order. */
  options?: string[]
  /** enum: display labels, parallel to `options`. */
  labels?: string[]
  /** entity: restrict to this template. */
  template?: string
  min?: number
  max?: number
  integer?: true
}

export interface ExportTemplate {
  id: string
  name: string
  properties: Record<string, ExportDef & { state?: true }>
}

export interface ExportEntity {
  id: string
  name: string
  template: string
  /** Every property, defaults applied. Enums as option names, links as entity names. */
  values: Record<string, ExportValue>
}

export interface ExportRelationship extends ExportDef {
  name: string
  from: string
  to: string
  /** Starting values that differ from `default`: from entity → to entity → value. */
  values: Record<string, Record<string, ExportValue>>
}

export interface ExportRule {
  id: string
  name: string
  trigger: 'phase' | 'day'
  /** trigger "phase": the phase that triggers it, or null for every phase. */
  phase: string | null
  /** Run once per entity of this template, with "$self" bound to each. */
  forEach: string | null
  /** v2: only run while this flow is being played (its id). Absent or null: always. */
  flow?: string | null
  when?: ExportCondition
  effects: ExportEffects
}

// --- Flows -------------------------------------------------------------------

interface NodeBase {
  id: string
  start?: true
  end?: true
  /** The node is only available while this holds. */
  requires?: ExportCondition
  /** Applied when the story enters the node. */
  effects?: ExportEffects
  /** v2: count how many times the story enters this node (read with { get: "visit" }). */
  count?: true
  /** v2: the node's tag in Skein (Seen.Tag / Visits.Tag), for engines that want to look it up. */
  tag?: string
}

export type ExportNode =
  | (NodeBase & { type: 'dialogue'; speaker: string | null; text: string; menuText?: string; next: string[] })
  | (NodeBase & { type: 'condition'; condition: ExportCondition | null; onTrue: string | null; onFalse: string | null })
  | (NodeBase & { type: 'instruction'; instruction: ExportEffects | null; next: string[] })
  | (NodeBase & { type: 'hub'; label: string; next: string[] })
  | (NodeBase & { type: 'jump'; jumpTo: string | null })

export interface ExportFlow {
  id: string
  name: string
  /** Start nodes, top to bottom. */
  start: string[]
  nodes: Record<string, ExportNode>
}

export interface ExportFile {
  format: typeof EXPORT_FORMAT
  version: 1 | 2
  project: { id: string; name: string }
  templates: Record<string, ExportTemplate>
  entities: Record<string, ExportEntity>
  state: {
    variables: Record<string, ExportDef>
    relationships: Record<string, ExportRelationship>
    time: { phases: string[]; labels: string[]; start: { day: number; phase: string | null } }
    rules: ExportRule[]
  }
  flows: Record<string, ExportFlow>
}
