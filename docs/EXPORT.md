# Skein game export — format `skein.export` v5

**Export** (Ctrl+E, or the package icon in the top bar) writes a JSON file for your game. It has
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
(C# 9, no dependencies), with Unity components in `runtimes/unity`. Every runtime is
checked against the shared [conformance kit](../runtimes/conformance): committed
exports, and the exact trace the reference runtime produces for each. The format is
also published as a JSON Schema, [`schemas/skein.export.v5.json`](../schemas), and
[VERSIONING.md](VERSIONING.md) says what each version promises.

```bash
dotnet run --project runtimes/csharp/tests     # checks the C# runtime against runtimes/conformance/fixtures
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
| 3 | The clock: node `takes` / `activity`, `{ "pass": m }`, `Time.Hour` / `Time.Minute` reads, a start `minute` |
| 4 | Variables inside lines: dialogue `vars`, filled into `text` and `menuText` |
| 5 | Hubs that keep asking (`ask`) and fall back (`fallback`) |

A runtime should refuse a file whose `version` is higher than it knows. (`time.minutes`
and `time.dayStart` are written in every file, and line IDs, `line` and `menuLine`, in
every file that has them; older runtimes ignore them.)

## Top level

```jsonc
{
  "format": "skein.export",
  "version": 5,                     // the lowest version that reads this file
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
- A variable with `"hud": true` was marked **Show in Play** by the designer: a value meant to be shown to the player, such as coins or health.
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
| `{ "get": "time", "field": "hour" }`, `"minute"` | **v3.** The time of day: hour 0–23, minute 0–59 (see *The clock*) |
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
| `{ "pass": 45 }` | **v3.** Let that many minutes go by (see *The clock*) |
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

## The clock (v3)

```jsonc
"time": {
  "phases": ["Dawn", "Day", "Dusk", "Night"],
  "minutes": [120, 660, 120, 540],     // how long each phase lasts
  "dayStart": 300,                     // the first phase begins at 05:00
  "start": { "day": 1, "phase": "Day", "minute": 30 }   // 07:30
}
```

The world keeps **seconds into the current phase** as a whole number (start: `minute`
× 60, rounded half up). Convert minutes to seconds as `floor(m × 60 + 0.5)` everywhere.

- `pass m` adds `m` minutes. While that reaches the end of the phase, step to the next
  phase as described under *Time and rules* (rules run) and carry on with what's left.
- `advance`, `advance n` and `advanceTo` move to the **start** of a phase: seconds
  become 0. `advanceTo` with `stay`, when already there, changes nothing.
- A node with `takes` passes that many minutes when the story enters it, **before** its
  `effects`: the activity happens, then its results apply. `takes` comes from the node's
  activity, its own length, or (dialogue) the time to say the line. `activity` names
  the activity, for showing what a choice costs ("Repair the radio · 2h").
- The time of day: `total = dayStart×60 + seconds of all earlier phases today +
  seconds`, then `hour = floor(total / 3600) mod 24`, `minute = floor(total / 60) mod 60`.
- A file without `minutes` splits the day evenly: `floor(1440 / phases)` each.

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
| `dialogue` | `speaker` (entity name or null), `text`, `menuText?`, `next: [ids]`, `line?`, `menuLine?`, `vars?` | Shows a line. One available `next` = continue. Several = the player chooses (show each target's `menuText`, else its `text`). None = this flow ends after the line: call `choose(0)` to get the end beat (or, inside a Call, the beat after it). |
| `condition` | `condition`, `onTrue`, `onFalse` (ids or null) | Evaluates and follows a branch automatically. |
| `instruction` | `instruction` (effects), `next` | Runs `instruction`, then follows the first available `next`. |
| `hub` | `label`, `next`, `ask?`, `fallback?` | A meeting point. One available path is followed automatically; several are offered as a choice. **v5:** with `ask: true`, a single available path is offered as a choice too (the hub has several connections, and some can disappear). When no path is available, follow `fallback` (a node id) if there is one; otherwise the path ends. |
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
to continue. A line beat carries its filled-in `text` and its `lineId`; each choice
carries its filled-in `text` and the `lineId` of that text (null for a hub's label).

### Line IDs

`line` is the line's stable ID, for voice-over and translation (`"ORDER_3f9a2c"`).
`menuLine` is the ID of its choice text (`"ORDER_3f9a2c_M"`), present when the line
has `menuText`. They never change when the text is edited, so a game can look up a
recording or a translation by them. They're optional extras: a runtime that doesn't
know them just ignores them, so they don't raise the file's version.

### Variables inside lines (v4)

`text` and `menuText` are exported as written. When they contain placeholders,
`vars` maps each placeholder's source (trimmed) to a compiled expression:

```jsonc
"text": "Anything else? You've got {Player.Coins} left.",
"vars": { "Player.Coins": { "get": "var", "var": "Player.Coins" } }
```

To show the text, scan it left to right:

- `{{` and `}}` are a literal `{` and `}`.
- `{` followed by a `}` with no other `{` in between is a placeholder. Trim what's
  inside; if `vars` has it, evaluate the expression **now** and show it formatted (below).
  If not, show the placeholder exactly as written.
- Any other character, including a lone `{` or `}`, is shown as it is.

Formatting a value:

- `null` shows as nothing; `true` / `false` as `true` / `false`.
- A number is rounded to two decimal places, halves up (`floor(n × 100 + 0.5) / 100`),
  then shown without trailing zeros: `3`, `2.5`, `0.33`, `-1.23`.
- A text value read straight from state (the expression is a `get`) shows its display
  name: an `enum` option its label, an `entity` the entity's `name`, `Time.Phase` the
  phase's label. Anything else shows as it is.

The text is filled in when the beat is made (a line when the story reaches it, a choice
when it's listed), so it shows the state at that moment. Translations can keep the same
placeholders: the game fills them the same way.

## Save games

Store the current day, phase, seconds into it (`seconds`), every value that changed since the start (visit counts
are saved as `visit:<node id>`) and the dice generator's state (`rng`). The reference
runtime's `world.save()` / `new SkeinWorld(data, saved)` does exactly this. Start a new
game with `new SkeinWorld(data, undefined, { seed })` (C#: `new SkeinWorld(data, null, seed)`)
for different dice each time.
Everything else is read from the export, so saves stay small. They also survive a new
export that adds content.
