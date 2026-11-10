import { z } from 'zod'

/**
 * Skein project file schema (on-disk format).
 *
 * Design rules that keep the file merge-friendly when shared by hand or via git:
 *  - Every collection is a flat dictionary keyed by a persistent UUID
 *    (`{ "<uuid>": { "id": "<uuid>", ... } }`), never an array. Adding or editing
 *    one item only touches that item's lines, and key order is stable because the
 *    serializer sorts keys.
 *  - Hierarchy is expressed by reference (`parentId`, `folderId`), never by nesting.
 *  - No volatile data: no "lastSaved" timestamps, no viewport/zoom, no selection.
 *    Those would change on every save and cause pointless conflicts.
 *  - Unknown fields are preserved (`passthrough`) so a file opened in an older
 *    build does not silently lose data written by a newer one.
 */

export const PROJECT_FORMAT = 'skein.project' as const
export const SCHEMA_VERSION = 5 as const

export const SECTION_IDS = ['flows', 'entities', 'templates'] as const
export type SectionId = (typeof SECTION_IDS)[number]

const Id = z.string().min(1)
const Order = z.number().finite()

export const PositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite()
})

export const ProjectMetaSchema = z
  .object({
    id: Id,
    name: z.string(),
    description: z.string().default(''),
    createdAt: z.string()
  })
  .passthrough()

export const FolderSchema = z
  .object({
    id: Id,
    name: z.string(),
    section: z.enum(SECTION_IDS),
    parentId: Id.nullable().default(null),
    order: Order.default(0)
  })
  .passthrough()

/** Fields shared by everything that appears in the navigation tree. */
const treeItemShape = {
  id: Id,
  name: z.string(),
  folderId: Id.nullable().default(null),
  order: Order.default(0)
}

export const FlowNodeSchema = z
  .object({
    id: Id,
    type: z.string().min(1),
    position: PositionSchema,
    data: z.record(z.unknown()).default({})
  })
  .passthrough()

export const FlowEdgeSchema = z
  .object({
    id: Id,
    source: Id,
    target: Id,
    sourceHandle: z.string().nullable().default(null),
    targetHandle: z.string().nullable().default(null),
    /**
     * Position among the connections leaving the same output: the order
     * choices are offered in. Lower first. (v5; earlier files derived it from
     * canvas positions, and the v4 → v5 migration stores what that produced.)
     */
    order: Order.optional()
  })
  .passthrough()

export const FlowSchema = z
  .object({
    ...treeItemShape,
    nodes: z.record(FlowNodeSchema).default({}),
    edges: z.record(FlowEdgeSchema).default({})
  })
  .passthrough()

// ---------------------------------------------------------------------------
// Templates & entities
//
// A template defines a data structure (e.g. "Character" with Age, Faction, Bio).
// An entity is an instance of a template. Values are keyed by *property id*,
// not by name, so renaming a property never touches entity data, and only
// values the designer explicitly set are stored: anything absent falls back
// to the property's default. Both keep diffs small and merges clean.

export const PROPERTY_TYPES = ['text', 'longText', 'number', 'boolean', 'enum', 'reference', 'color'] as const
export type PropertyType = (typeof PROPERTY_TYPES)[number]

export const PropertyValueSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()])

export const EnumOptionSchema = z
  .object({
    id: Id,
    label: z.string(),
    order: Order.default(0)
  })
  .passthrough()

export const PropertyDefSchema = z
  .object({
    id: Id,
    name: z.string(),
    /** Stable identifier for scripts and game engines (e.g. "IsAlive"). */
    technicalName: z.string().default(''),
    type: z.enum(PROPERTY_TYPES),
    order: Order.default(0),
    description: z.string().default(''),
    /** Value used by entities that haven't set their own. Absent = the type's empty value. */
    defaultValue: PropertyValueSchema.optional(),
    // Type-specific settings: present only for the type that uses them.
    /** enum: the allowed options, keyed by option id (entity values store the id). */
    options: z.record(EnumOptionSchema).optional(),
    /** reference: restrict targets to entities of this template; null/absent = any entity. */
    referenceTemplateId: Id.nullable().optional(),
    /** number */
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    integer: z.boolean().optional(),
    /** State: the value can change during play (actions, rules). Absent = fixed design data. */
    mutable: z.boolean().optional()
  })
  .passthrough()

export const TemplateSchema = z
  .object({
    ...treeItemShape,
    technicalName: z.string().default(''),
    description: z.string().default(''),
    color: z.string().default('#818cf8'),
    icon: z.string().default('box'),
    properties: z.record(PropertyDefSchema).default({})
  })
  .passthrough()

export const EntitySchema = z
  .object({
    ...treeItemShape,
    technicalName: z.string().default(''),
    templateId: Id,
    /** Explicitly set values, keyed by property id. */
    values: z.record(PropertyValueSchema).default({}),
    /**
     * Starting values of one-way relationships from this entity:
     * relationship id → target entity id → value. Only set values are stored.
     */
    relations: z.record(z.record(PropertyValueSchema)).optional()
  })
  .passthrough()

// ---------------------------------------------------------------------------
// State
//
// Everything that can change during play:
//  - world variables (World.StormRaging, Player.Reputation), grouped by namespace;
//  - state properties on templates (Keeper.Mood), marked `mutable`;
//  - one-way relationships between entities (Keeper->Stranger.Trust);
//  - world time: a day counter plus named phases (Dawn, Day, Dusk, Night);
//  - rules that change state automatically as time passes.

export const StateVariableSchema = PropertyDefSchema.extend({
  /** First part of the variable's path: `World` in `World.StormRaging`. */
  namespace: z.string().default('World')
})

export const RelationshipDefSchema = PropertyDefSchema.extend({
  fromTemplateId: Id,
  toTemplateId: Id
})

export const TimePhaseSchema = z
  .object({ id: Id, label: z.string(), technicalName: z.string().default(''), order: Order.default(0) })
  .passthrough()

export const RULE_TRIGGERS = ['phase', 'day'] as const

export const RuleSchema = z
  .object({
    id: Id,
    name: z.string(),
    order: Order.default(0),
    enabled: z.boolean().default(true),
    /** phase: whenever a phase begins (`phaseId` null = every phase); day: whenever a new day begins. */
    trigger: z.enum(RULE_TRIGGERS).default('phase'),
    phaseId: Id.nullable().default(null),
    /** Run once per entity of this template, with `self` bound to it. */
    forEachTemplateId: Id.nullable().default(null),
    condition: z.string().default(''),
    effects: z.string().default('')
  })
  .passthrough()

export const StateSchema = z
  .object({
    variables: z.record(StateVariableSchema).default({}),
    relationships: z.record(RelationshipDefSchema).default({}),
    time: z
      .object({
        phases: z.record(TimePhaseSchema).default({}),
        startDay: z.number().int().default(1),
        startPhaseId: Id.nullable().default(null)
      })
      .passthrough()
      .default({}),
    rules: z.record(RuleSchema).default({})
  })
  .passthrough()

export const ProjectSchema = z
  .object({
    format: z.literal(PROJECT_FORMAT),
    schemaVersion: z.literal(SCHEMA_VERSION),
    meta: ProjectMetaSchema,
    folders: z.record(FolderSchema).default({}),
    flows: z.record(FlowSchema).default({}),
    templates: z.record(TemplateSchema).default({}),
    entities: z.record(EntitySchema).default({}),
    state: StateSchema.default({})
  })
  .passthrough()

export type Position = z.output<typeof PositionSchema>
export type ProjectMeta = z.output<typeof ProjectMetaSchema>
export type Folder = z.output<typeof FolderSchema>
export type FlowNode = z.output<typeof FlowNodeSchema>
export type FlowEdge = z.output<typeof FlowEdgeSchema>
export type Flow = z.output<typeof FlowSchema>
export type PropertyValue = z.output<typeof PropertyValueSchema>
export type EnumOption = z.output<typeof EnumOptionSchema>
export type PropertyDef = z.output<typeof PropertyDefSchema>
export type Template = z.output<typeof TemplateSchema>
export type Entity = z.output<typeof EntitySchema>
export type StateVariable = z.output<typeof StateVariableSchema>
export type RelationshipDef = z.output<typeof RelationshipDefSchema>
export type TimePhase = z.output<typeof TimePhaseSchema>
export type Rule = z.output<typeof RuleSchema>
export type RuleTrigger = (typeof RULE_TRIGGERS)[number]
export type ProjectState = z.output<typeof StateSchema>
export type Project = z.output<typeof ProjectSchema>

/** Minimal shape every tree item satisfies, whatever its section. */
export interface TreeItem {
  id: string
  name: string
  folderId: string | null
  order: number
}

export const COLLECTIONS = ['folders', ...SECTION_IDS] as const
export type CollectionId = (typeof COLLECTIONS)[number]
