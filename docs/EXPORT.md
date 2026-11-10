# Skein game export — format `skein.export` v2

**File › Export for Game Engine… (Ctrl+E)** writes a JSON file for your game. It has
everything the game needs and nothing the editor needs. There are no canvas positions,
colours, icons, folders, ordering, descriptions or designer notes.

Properties of the file:

- **Deterministic.** The same project always produces the same file (keys sorted,
  arrays in a defined order), so exports diff cleanly in version control.
- **Names, not ids.** Templates, entities, properties, variables, phases and enum
  options are referred to by their **technical names**. Flows and nodes, which have no
  technical names, keep their ids. Each template and entity also carries its `id`
  (stable across renames) and display `name`.
- **No parser needed.** Every condition and action is exported pre-compiled as a small
  JSON tree (`expr` / `do`). The original text is kept in `source` for debugging,
  unless you untick **Include expression text**.

`src/shared/export/runtime.ts` is a dependency-free reference implementation of
everything below. Use it directly in a JS/TS game, or port it. Its tests check that it
behaves exactly like the editor.

A C# port for Unity, Godot .NET and plain .NET lives in `runtimes/csharp/Skein`
(C# 9, no dependencies), with Unity components in `runtimes/unity`. Its conformance
harness replays the same seeded exports through both runtimes and requires
byte-identical traces:

```bash
npx tsx runtimes/csharp/tests/conformance.ts /tmp/skein-conformance
dotnet run --project runtimes/csharp/tests -- /tmp/skein-conformance
```

You can also export from the command line, for build pipelines:

```bash
npm run export -- path/to/project.skein.json out/game.json [--compact] [--no-source]
```

## Versions

Each file carries the **lowest** version that can read it, so a project that doesn't
use a newer feature keeps loading in older runtimes.

| Version | Adds |
| --- | --- |
| 1 | Everything not listed below |
| 2 | Visit counts (`{ "get": "visit" }`, node `count` / `tag`), flow-scoped rules (rule `flow`), `advanceTo` with `stay`, dice (`chance`, `roll`), `call` nodes and `jumpFlow` |

A runtime should refuse a file whose `version` is higher than it knows.

## Top level

```jsonc
{
  "format": "skein.export",
  "version": 2,                     // the lowest version that reads this file
  "project": { "id": "…", "name": "The Lighthouse Keeper" },
  "templates": { "<Template>": … },
  "entities":  { "<Entity>": … },
  "state": { "variables": …, "relationships": …, "time": …, "rules": [ … ] },
  "flows": { "<flow id>": … }
}
```

## Definitions

A definition describes one value: a template property, a world variable or a
relationship.

```jsonc
{
  "type": "text" | "number" | "boolean" | "enum" | "entity" | "color",
  "default": <value>,
  "options": ["Calm", "Wary", "Warm"],   // enum: option technical names, in order
  "labels":  ["Calm", "Wary", "Warm"],   // enum: display labels, same order
  "template": "Faction",                 // entity: allowed template (optional)
  "min": 0, "max": 5, "integer": true    // number (each optional)
}
```

Values are:

| Type | Exported as |
| --- | --- |
| number, boolean | JSON numbers and booleans |
| text | a string |
| color | a `"#rrggbb"` string |
| enum | the option's technical name |
| entity | the entity's technical name |
| unset | `null` |

## Templates and entities

```jsonc
"templates": {
  "Character": {
    "id": "…", "name": "Character",
    "properties": {
      "Mood": { "type": "enum", "options": ["Calm","Wary","Warm"], "default": "Calm", "state": true },
      "Age":  { "type": "number", "default": null, "min": 0, "max": 150, "integer": true }
    }
  }
},
"entities": {
  "Keeper": { "id": "…", "name": "Keeper", "template": "Character",
              "values": { "Mood": "Calm", "Age": 61, "MemberOf": "LighthouseWatch" } }
}
```

- `"state": true` marks a property that changes during play.
- Properties without it are fixed design data: read them, never write them.
- Entity `values` list **every** property, with defaults already applied. They are the
  starting state.

## State

```jsonc
"state": {
  "variables": {
    "World.StormRaging": { "type": "boolean", "default": true },
    "Player.Reputation": { "type": "number", "default": 1, "min": 0, "max": 10, "integer": true }
  },
  "relationships": {
    "Character->Character.Trust": {
      "name": "Trust", "from": "Character", "to": "Character",
      "type": "number", "default": 0, "min": -5, "max": 5, "integer": true,
      "values": { "Keeper": { "Stranger": -1 } }     // starting values that differ from default
    }
  },
  "time": {
    "phases": ["Dawn", "Day", "Dusk", "Night"],       // in order; technical names
    "labels": ["Dawn", "Day", "Dusk", "Night"],
    "start": { "day": 1, "phase": "Dawn" }
  },
  "rules": [ … ]                                     // in run order; disabled rules are omitted
}
```

- **World variables** are keyed `Namespace.Name`.
- **Relationships** are one-way. `Keeper→Stranger` and `Stranger→Keeper` are separate
  values. A pair with no entry in `values` starts at `default`.

## Expressions

A condition is `{ "expr": <Expr>, "source"?: "…" }`, and its `expr` evaluates to true or
false. A missing condition always holds.

`<Expr>` is one of:

| Form | Meaning |
| --- | --- |
| `{ "lit": v }` | a literal: number, boolean, string, or null. Enum options, entities and phases are literal strings holding their technical names. |
| `{ "get": "var", "var": "World.StormRaging" }` | a world variable |
| `{ "get": "prop", "entity": "Keeper", "prop": "Mood" }` | an entity property. `"entity": "$self"` means the entity a rule is running for. |
| `{ "get": "rel", "rel": "Character->Character.Trust", "from": "Keeper", "to": "Stranger" }` | a relationship value (`$self` allowed in `from` / `to`) |
| `{ "get": "time", "field": "day" }`, `{ "get": "time", "field": "phase" }` | day number; current phase name |
| `{ "get": "visit", "node": "<node id>" }` | **v2.** How many times the story has entered that node (0 if never). Read-only. |
| `{ "not": e }`, `{ "neg": e }` | logical not; numeric negation |
| `{ "chance": p }` | **v2.** True `p` percent of the time (`p` a whole number, 0–100). See *Dice* below. |
| `{ "roll": [min, max] }` | **v2.** A whole number from `min` to `max`, inclusive. |
| `{ "op": o, "a": e1, "b": e2 }` | a binary operation; the operators are listed below |

The values of `o`:

| Operator | Meaning |
| --- | --- |
| `and`, `or` | logical; short-circuit |
| `==`, `!=` | strict equality of the values above |
| `<`, `<=`, `>`, `>=` | numeric comparison |
| `phase<`, `phase<=`, `phase>`, `phase>=` | compare two phase names by their position in `time.phases` |
| `+`, `-`, `*`, `/` | numeric. Division by zero gives 0. |

Effects are `{ "do": [<Statement>…], "source"?: "…" }`, run in order. A `<Statement>` is
one of:

| Form | Meaning |
| --- | --- |
| `{ "set": <get…>, "op": "=", "value": e }` | assign |
| `{ "set": <get…>, "op": "+=", "value": e }`, `"op": "-="` | numeric add / subtract |
| `{ "advance": n }` | move time forward n phases |
| `{ "advanceTo": "Night" }` | move forward to the next time that phase begins; always at least one phase, so from Night it moves a whole day to the next Night (`advance to Night` in Skein) |
| `{ "advanceTo": "Night", "stay": true }` | **v2.** The same, but do nothing if it is already Night (`advance until Night` in Skein) |

Writing a number clamps it to the definition's `min` / `max`, and rounds it when the
definition is `integer`. Only variables, relationships and `"state": true` properties
are ever written.

### Dice

Skein only allows `chance` and `roll` where an expression is evaluated once per visit:
Condition nodes, effects and instructions, and rule effects. Requirements and a rule's
`when` never contain them, because a runtime checks those whenever it lists choices.

So that every runtime rolls the same dice, use this generator (mulberry32 over an
unsigned 32-bit state, seeded with `0x5EED` unless the game passes its own seed):

```text
next():  state = (state + 0x6D2B79F5) mod 2^32
         t = state
         t = (t xor (t >> 15)) * (t or 1)          // 32-bit multiply, keep the low 32 bits
         t = t xor (t + (t xor (t >> 7)) * (t or 61))
         return t xor (t >> 14)
chance(p):        next() mod 100 < p
roll(min, max):   min + next() mod (max - min + 1)
```

Each `chance` or `roll` reached draws once, in evaluation order (`and` / `or`
short-circuit, so a draw on the skipped side doesn't happen).

## Time and rules

```jsonc
{ "id": "…", "name": "Night wears everyone down",
  "trigger": "phase", "phase": "Night",      // or "phase": null for every phase; "trigger": "day" for each new day
  "forEach": "Character",                    // or null to run once
  "when": { "expr": … },                     // optional
  "effects": { "do": [ { "set": { "get": "prop", "entity": "$self", "prop": "Energy" }, "op": "-=", "value": { "lit": 1 } } ] } }
```

Time moves only through `advance` / `advanceTo`. For **each** phase stepped through:

1. Move to the next phase. If that wraps past the last phase, it's a new day: `day += 1`.
2. On a new day, run every `"trigger": "day"` rule.
3. Run every `"trigger": "phase"` rule whose `phase` is null or equals the new phase.

Within a step, rules run in array order.

- A `forEach` rule runs once per entity of that template, in order of entity `id`, with
  `$self` bound to each.
- It applies its effects only where `when` holds.
- Rules never contain `advance`.
- **v2:** a rule with `"flow": "<flow id>"` only runs while that flow is being played
  (see *Which flow is playing* below). Absent or null: it always runs.

### Which flow is playing

The world remembers which flow is playing. `start()` and `choose()` on a story set it
to that story's flow, and the story reaching its end clears it (only if it is still
that flow). Time advanced outside any story, by the game clock, sees no flow playing,
so flow-scoped rules don't run.

## Flows

```jsonc
"flows": {
  "<flow id>": {
    "id": "…", "name": "Arrival",
    "start": ["<node id>", …],                 // start nodes, in priority order
    "nodes": { "<node id>": <Node> }
  }
}
```

Every node has `id` and `type`. It may also have:

| Field | Meaning |
| --- | --- |
| `start: true` / `end: true` | it's a start or end node |
| `requires` | a condition; the node is only available while it holds |
| `effects` | effects, applied when the story enters the node |
| `count: true` | **v2.** Count each entry into this node (readable with `{ "get": "visit" }`) |
| `tag` | **v2.** The node's tag in Skein (`Seen.Tag`, `Visits.Tag`), for engines that want to look a node up by name |

Node types:

| `type` | Fields | Behaviour |
| --- | --- | --- |
| `dialogue` | `speaker` (entity name or null), `text`, `menuText?`, `next: [ids]` | Shows a line. One available `next` = continue. Several = the player chooses (show each target's `menuText`, else its `text`). None = this flow ends after the line: call `choose(0)` to get the end beat (or, inside a Call, the beat after it). |
| `condition` | `condition`, `onTrue`, `onFalse` (ids or null) | Evaluates and follows a branch automatically. |
| `instruction` | `instruction` (effects), `next` | Runs `instruction`, then follows the first available `next`. |
| `hub` | `label`, `next` | A meeting point. One available path is followed automatically; several are offered as a choice. |
| `jump` | `jumpTo` (id or null), `jumpFlow?` | Continues at the target. **v2:** with `jumpFlow` (a flow id), the current flow is over and the story continues at that flow's first available start (a hand-off). |
| `call` | `flow` (flow id or null), `next` | **v2.** Plays `flow` from its first available start. When that flow runs out, the story comes back and follows the first available `next`. A null or missing `flow` passes straight through to `next`. |

Order of `next` and `start`:

- `next` lists are in the order set in Skein (the numbered choices on the canvas,
  reordered in the node's inspector). Present choices in this order.
- `start` lists start nodes in priority order: begin at the first available one.
- Neither depends on where nodes sit on the canvas, so moving nodes or running
  auto-layout never changes them. (Projects saved before format v5 keep the order
  their canvas layout gave them when first opened.)

Stepping rules:

- When entering a node, first check `requires`. If it fails, the path ends there.
- Otherwise, if the node has `count`, add one to its visit count. Then apply
  `effects`, then behave as described in the table above.
- **Only once** in Skein exports as a `requires` of `visit == 0` on the node itself
  (combined with `and` with any other requirement; `source` reads "only once").
  Counting happens on entry, so the node hides itself after the first visit.
- When a dialogue line or hub offers choices, list only targets whose `requires` holds.

Calls (v2):

- The story keeps a stack of Call nodes. A flow "runs out" when a path ends in it (no
  available next, a failed `requires`, or `choose` on a line with no choices). If the
  stack is empty, the story ends there. Otherwise pop the Call node, switch back to its
  flow, and follow its first available `next`; if none, that flow has run out too.
- While a called or handed-off flow plays, it is the flow that's *playing* for
  flow-scoped rules.
- Stop with an error past 100 nested calls (a flow that keeps calling itself).

The reference `SkeinStory` returns *beats*: `line`, `choice` or `end`. Call `choose(i)`
to continue.

## Save games

Store the current day, phase, every value that changed since the start (visit counts
are saved as `visit:<node id>`) and the dice generator's state (`rng`). The reference
runtime's `world.save()` / `new SkeinWorld(data, saved)` does exactly this. Start a new
game with `new SkeinWorld(data, undefined, { seed })` (C#: `new SkeinWorld(data, null, seed)`)
for different dice each time.
Everything else is read from the export, so saves stay small. They also survive a new
export that adds content.
