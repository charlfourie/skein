# Skein game export — format `skein.export` v1

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

You can also export from the command line, for build pipelines:

```bash
npm run export -- path/to/project.skein.json out/game.json [--compact] [--no-source]
```

## Top level

```jsonc
{
  "format": "skein.export",
  "version": 1,
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
| `{ "not": e }`, `{ "neg": e }` | logical not; numeric negation |
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
| `{ "advanceTo": "Night" }` | move forward to the next time that phase begins; always at least one phase |

Writing a number clamps it to the definition's `min` / `max`, and rounds it when the
definition is `integer`. Only variables, relationships and `"state": true` properties
are ever written.

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

## Flows

```jsonc
"flows": {
  "<flow id>": {
    "id": "…", "name": "Arrival",
    "start": ["<node id>", …],                 // start nodes, top to bottom
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

Node types:

| `type` | Fields | Behaviour |
| --- | --- | --- |
| `dialogue` | `speaker` (entity name or null), `text`, `menuText?`, `next: [ids]` | Shows a line. One available `next` = continue. Several = the player chooses (show each target's `menuText`, else its `text`). None = the story ends. |
| `condition` | `condition`, `onTrue`, `onFalse` (ids or null) | Evaluates and follows a branch automatically. |
| `instruction` | `instruction` (effects), `next` | Runs `instruction`, then follows the first available `next`. |
| `hub` | `label`, `next` | A meeting point. One available path is followed automatically; several are offered as a choice. |
| `jump` | `jumpTo` (id or null) | Continues at the target. |

Order of `next`:

- `next` lists are in canvas order: left to right, then top to bottom.
- That is the intended order for presenting choices.

Stepping rules:

- When entering a node, first check `requires`. If it fails, the path ends there.
- Otherwise apply `effects`, then behave as described in the table above.
- When a dialogue line or hub offers choices, list only targets whose `requires` holds.

The reference `SkeinStory` returns *beats*: `line`, `choice` or `end`. Call `choose(i)`
to continue.

## Save games

Store the current day, phase, and every value that changed since the start. The
reference runtime's `world.save()` / `new SkeinWorld(data, saved)` does exactly this.
Everything else is read from the export, so saves stay small. They also survive a new
export that adds content.
