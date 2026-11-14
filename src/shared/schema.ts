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
export const SCHEMA_VERSION = 8 as const

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
    order: Order.optional(),
    /**
     * v8: a connection leaving a line or hub on its main output is a choice, and
     * carries its own choice text, "only once" and requirement (see choices.ts).
     */
    choiceText: z.string().optional(),
    once: z.literal(true).optional(),
    requires: z.string().optional(),
    choiceLineId: z.string().optional()
  })
  .passthrough()

/**
 * A labelled box on the canvas that groups nodes visually (a scene, a beat, a
 * conversation). Editor-only: it has no effect on play and isn't exported.
 * Moving a frame moves the nodes inside it.
 */
export const FlowFrameSchema = z
  .object({
    id: Id,
    label: z.string().default(''),
    position: PositionSchema,
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    /** A colour from the frame palette (see FRAME_COLORS); absent = neutral. */
    color: z.string().optional()
  })
  .passthrough()

/**
 * A comment on a node (v7). A thread is a comment with no `parentId` plus its
 * replies. The author is the name set in Skein's own settings: there are no
 * accounts. Comments are for the team, never exported.
 */
export const CommentSchema = z
  .object({
    id: Id,
    nodeId: Id,
    /** The comment this one replies to (a thread's first comment). Absent: it starts a thread. */
    parentId: Id.optional(),
    author: z.string().default(''),
    text: z.string().default(''),
    /** When it was written (ISO 8601). Written once, so it never churns the file. */
    createdAt: z.string().default(''),
    /** On a thread's first comment: the thread is done. */
    resolved: z.boolean().optional()
  })
  .passthrough()

export const FlowSchema = z
  .object({
    ...treeItemShape,
    nodes: z.record(FlowNodeSchema).default({}),
    edges: z.record(FlowEdgeSchema).default({}),
    frames: z.record(FlowFrameSchema).optional(),
    /** Start of the line IDs of new lines in this flow (v7). Absent: made from the flow's name. */
    linePrefix: z.string().optional(),
    /** Comment threads on this flow's nodes (v7). */
    comments: z.record(CommentSchema).optional()
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
  namespace: z.string().default('World'),
  /** Show this variable's live value at the top of the Play panel (and flag it as HUD-worthy in the export). */
  showInPlay: z.boolean().optional()
})

export const RelationshipDefSchema = PropertyDefSchema.extend({
  fromTemplateId: Id,
  toTemplateId: Id
})

export const TimePhaseSchema = z
  .object({
    id: Id,
    label: z.string(),
    technicalName: z.string().default(''),
    order: Order.default(0),
    /** How long the phase lasts, in minutes. Absent: phases without a length share what's left of 24 hours. */
    minutes: z.number().finite().positive().optional()
  })
  .passthrough()

/** Something that takes time ("Repair the radio: 2h"). Nodes refer to it by id. */
export const ActivitySchema = z
  .object({
    id: Id,
    name: z.string(),
    /** Duration in minutes. */
    minutes: z.number().finite().min(0),
    order: Order.default(0)
  })
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
    effects: z.string().default(''),
    /** Only run while this flow is being played (v2 export). Absent = always. */
    flowId: Id.nullable().optional()
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
        startPhaseId: Id.nullable().default(null),
        /** Minutes into the starting phase the game begins. */
        startMinute: z.number().finite().min(0).optional(),
        /** Minutes after midnight when the first phase begins (for Time.Hour). Absent: midnight. */
        dayStart: z.number().finite().min(0).max(1439).optional(),
        /** Dialogue lines take time to speak: words per minute. Absent or 0: lines take no time. */
        speakingRate: z.number().finite().min(0).optional(),
        activities: z.record(ActivitySchema).optional()
      })
      .passthrough()
      .default({}),
    rules: z.record(RuleSchema).default({})
  })
  .passthrough()

// ---------------------------------------------------------------------------
// Story tests (v6)
//
// A scenario is a named starting situation ("Day 4, storm, 1 coin"). A story
// test plays a flow from a scenario and says what must be true. Both live in
// the project file so the whole team shares them, and both refer to things by
// id (flows, nodes, phases) or by expression (setup, checks), so renames are
// followed and deleted nodes are reported, never silently skipped.

export const ScenarioSchema = z
  .object({
    id: Id,
    name: z.string(),
    order: Order.default(0),
    /** Day the scenario starts on. Absent: the project's start day. */
    day: z.number().int().optional(),
    /** Phase it starts in. Absent: the project's start phase. */
    phaseId: Id.nullable().optional(),
    /** Seed for chance() and roll() in Play. Absent: the runtime's default seed. */
    seed: z.number().int().optional(),
    /** Actions that set up the situation, one per line (`Player.Coins = 1`). */
    setup: z.string().default('')
  })
  .passthrough()

/** One step of a recorded play-through: a choice (by the node it leads to) or a dice outcome (outcome index). */
export const RouteStepSchema = z.union([z.object({ choose: Id }), z.object({ dice: z.number().int().min(0) })])

export const TEST_KINDS = ['play', 'explore'] as const
export type TestKind = (typeof TEST_KINDS)[number]

export const StoryTestSchema = z
  .object({
    id: Id,
    name: z.string(),
    order: Order.default(0),
    flowId: Id,
    /** The scenario it starts from. Null: the project's own starting state. */
    scenarioId: Id.nullable().default(null),
    /** play: follow a recorded route. explore: check every path. */
    kind: z.enum(TEST_KINDS),
    // --- play ---
    /** The choices and dice outcomes, in order. An ordered value, so an array. */
    route: z.array(RouteStepSchema).optional(),
    /** Where the story should stop once the route is used up: the last node reached. */
    stopsAt: Id.nullable().optional(),
    /** Whether the story should have ended there (false: it waits at a choice). */
    ends: z.boolean().optional(),
    // --- explore ---
    /** Every path ends at a node marked End, with no errors or endless loops. */
    allEnd: z.boolean().optional(),
    /** Every node in the flow is reached by some path. */
    allReached: z.boolean().optional(),
    /** Endings (node ids) that some path must reach. Sorted. */
    reach: z.array(Id).optional(),
    // --- both ---
    /** Conditions, one per line, that must hold where the play-through stops (play) or at the end of every path (explore). */
    checks: z.string().default('')
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
    state: StateSchema.default({}),
    scenarios: z.record(ScenarioSchema).optional(),
    tests: z.record(StoryTestSchema).optional()
  })
  .passthrough()

export type Position = z.output<typeof PositionSchema>
export type ProjectMeta = z.output<typeof ProjectMetaSchema>
export type Folder = z.output<typeof FolderSchema>
export type FlowNode = z.output<typeof FlowNodeSchema>
export type FlowEdge = z.output<typeof FlowEdgeSchema>
export type FlowFrame = z.output<typeof FlowFrameSchema>
export type NodeComment = z.output<typeof CommentSchema>
export type Activity = z.output<typeof ActivitySchema>
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
export type Scenario = z.output<typeof ScenarioSchema>
export type RouteStep = z.output<typeof RouteStepSchema>
export type StoryTest = z.output<typeof StoryTestSchema>

/** Minimal shape every tree item satisfies, whatever its section. */
export interface TreeItem {
  id: string
  name: string
  folderId: string | null
  order: number
}

export const COLLECTIONS = ['folders', ...SECTION_IDS] as const
export type CollectionId = (typeof COLLECTIONS)[number]
