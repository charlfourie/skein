# Skein

A local-first, node-based narrative design editor (in the spirit of articy:draft X).
No accounts, no cloud: a project is one deterministic JSON file on your disk that
your team shares through git, a shared drive, or email.

**Status: Phase 5** adds game-engine export, built on the earlier phases:

| Phase | Adds |
| --- | --- |
| 5 | Game-engine export, with a reference runtime |
| 4 | World variables, character state, relationships, time and rules, with a checked expression language |
| 3 | The flowchart editor |
| 2 | Templates and entities |
| 1 | The storage engine and workspace |

## Getting started

Requires Node.js 20+.

```bash
npm install
npm run dev          # launch the app with hot reload
```

Then use **Open project…** and pick `examples/lighthouse-v2.skein.json` to see a sample.

| Script | What it does |
| --- | --- |
| `npm run dev` | Electron + Vite dev server with HMR |
| `npm run build` | Production build into `out/` |
| `npm start` | Run the production build |
| `npm run typecheck` | Type-check main/preload/shared and renderer |
| `npm test` | Storage-engine tests (serializer, parser, repairs) |
| `npm run make:example` | Regenerate the sample project |
| `npm run export -- <in> <out> [--compact] [--no-source]` | Export for a game engine from the command line, for build pipelines. Exits non-zero on errors. |

## Using it

**Templates** define a data structure, such as *Character* with Role, Age, Is Alive and Faction.
Create one under **Templates** in the explorer. The designer opens in the centre:

- add properties of seven types: text, long text, number, yes/no, choice, entity link, colour;
- drag the handle to reorder them;
- expand a property to set its default, description, number limits, choice options, or which
  template a link may point to.

Colour, icon and description live in the inspector on the right.

**Entities** are instances of a template. Use **+** under **Entities** (or **New entity** in a
template) and pick the template. The entity sheet shows every property:

- a blue dot means the value is set on this entity;
- a grey dot means it is inherited from the template default;
- ↺ resets a value to the default.

Duplicate an entity with Ctrl+D. Entities that link to the open one are listed at the bottom.

**Technical names** (e.g. `IsAlive`) are the identifiers scripts and game engines will use. They
are derived from the display name and follow renames, until you edit one by hand. Duplicates and
invalid identifiers are flagged in red.

**Flows** are edited on the canvas. Five node types:

| Node | What it does |
| --- | --- |
| **Dialogue** | A line spoken by a character |
| **Condition** | Branches true / false |
| **Instruction** | Changes game state |
| **Hub** | A meeting point that paths merge into |
| **Jump** | Continues the flow at another node |

- **Adding nodes:** drag from the palette, click a palette entry, or double-click or
  right-click the canvas.
- **Connecting:** drag from an output (bottom) to an input (top). While you drag:
  - inputs that can take the connection glow green;
  - nodes that can't take it fade back;
  - the line snaps onto a valid input once you're within about 40px.
- **Quick-add:** drop a connection on empty canvas to create the next node there,
  already connected.
- **Edges:** particles show which way the story runs. Condition branches are green
  (true) and red (false). A connection that leads back to an earlier point is purple
  and dashed, with a ↺ loop badge.
- **Warnings:** orphans (nothing leads in, and the node isn't a start) and dead ends
  (nothing follows, and it isn't an end) pulse amber. Errors pulse red.
- **Finding problems:** the chips at the top right count problems and loops; click
  one to visit each in turn.
- **Inspector:** select a node to write its line, choose a speaker from your entities,
  set condition or instruction text, pick a jump target, mark start or end, or add a
  designer note.
- **Keys:** Delete removes, Ctrl+D duplicates, Shift+drag box-selects.
- **Auto-layout and preferences:** auto-layout (dagre, undoable) tidies the flow. Snap
  to grid and edge animation are per-machine preferences.

**State** is everything that changes during play. It's under **State** in the explorer.

| Kind | Example | Where it's defined |
| --- | --- | --- |
| World variables | `World.StormRaging`, `Player.Reputation` | **State › World variables**, grouped by namespace |
| Character & thing state | `Keeper.Mood`, `Stranger.Energy` | Template properties with **Changes during play** switched on. Each entity's value is its starting state. |
| Relationships (one-way) | `Keeper->Stranger.Trust` | **State › Relationships** (e.g. Character → Character). Starting values are set on each entity's sheet. |
| Time | `Time.Day`, `Time.Phase` | **State › Time & rules**: a day counter plus named phases (Dawn, Day, Dusk, Night by default) |
| Rules | "When Night begins, for each Character: `self.Energy -= 1`" | **State › Time & rules** |

Nodes use state in three places:

- **Condition nodes** branch on an expression.
- **Instruction nodes** change state.
- **Every node** can also have **Requires** (it's only available while this holds) and
  **Effects** (applied when the story passes through).

Expressions are checked as you type. Mistakes are explained with a suggestion
("no property “Mod”. Did you mean “Mood”?"), and nodes with broken expressions turn
red on the canvas. Conditions show whether they are true at game start. Renaming an
entity, property, variable or relationship rewrites the expressions that use it.

### Expression language

```text
# Conditions: one true/false expression
Keeper->Stranger.Trust >= 2 and not World.StormRaging
Keeper.Mood is Wary                 # enum options, phases and entities by name
Time.Phase >= Dusk or Time.Day > 3  # phases are ordered
(Player.Reputation + 1) * 2 > 5
Seen.AskedAboutLight                # true once a node tagged AskedAboutLight has played
Visits.Lamp >= 3                    # how many times it has played

# Actions: one change per line (or separated by ;)
Keeper.Mood = Warm
Keeper->Stranger.Trust += 1
Player.Reputation -= 1
advance                             # one phase;  advance 2
advance until Night                 # make it Night (stays put if it already is)
advance to Night                    # the next Night: a whole day on if it's Night now
World.Weather = roll(1, 3)          # dice: a whole number from 1 to 3
World.Lucky = chance(30)            # true 30% of the time
```

Dice (`chance(30)`, `roll(1, 6)`) work in actions and in Condition nodes, where each
visit rolls once. Requirements can't use them, since they are checked whenever choices
are listed. Play rolls from a seed you can set in **Start state**. Explore tries every
outcome and weights the endings by the odds.

Give a node a **Tag** in its inspector to refer to it with `Seen.Tag` / `Visits.Tag`
from any flow. **Only once** hides a choice after it has been picked. A rule can be
limited to **While playing** one flow, so it doesn't run during other scenes.

Operators: `and or not` (or `&& || !`), `== != < <= > >=`, `is`, `is not`, and
`+ - * /`. `#` starts a comment.

Numbers are clamped to their limits when changed during play. Only state can be
changed: properties marked "Changes during play", world variables and relationships.

Time advances only through `advance`. Each phase that begins runs its rules, in
listed order. A new day runs day rules first, then phase rules. Rules can't advance
time themselves.

**Export for game engines:** **File › Export for Game Engine…** (Ctrl+E, or the package
icon in the top bar). It writes a clean JSON file:

- no positions, colours, folders or notes;
- everything named by its technical name, and entity values with defaults applied;
- every condition and action pre-compiled to a small JSON tree, so the game needs no parser.

Exports are deterministic, so they diff cleanly. The dialog:

- lists any broken expressions and links to each one;
- exports them safely if you choose to export anyway (a broken condition becomes
  "always false", a broken action becomes "no change");
- offers compact output and stripping the expression text.

**Play and Explore:** press **Play** on any flow to click through it exactly as a game
would, with live state, time and rule activity, from any starting state you set up.
**Explore** plays every path at once and reports unreachable nodes, endings, loops with
no way out and where numbers end up. See [`docs/PLAY.md`](docs/PLAY.md).

For engine developers:

- [`docs/EXPORT.md`](docs/EXPORT.md) specifies the format and exactly how flows, time
  and rules run.
- `src/shared/export/runtime.ts` is a dependency-free reference runtime: `SkeinWorld`
  for state, time and rules, and `SkeinStory` to play a flow beat by beat. Use it as-is
  in a JS/TS game, or port it.
- `runtimes/csharp` is a C# port (Unity, Godot .NET, plain .NET) that matches the reference
  byte for byte; `runtimes/unity` adds ready-made Unity components.
- `examples/lighthouse-v2.game.json` is a sample export.

**Undo / redo:** Ctrl+Z and Ctrl+Y (or Ctrl+Shift+Z), or the arrows in the top bar. Inside a text
field these undo typing; elsewhere they step through project changes. That includes deletes,
which is why most deletes only ask for confirmation when something else depends on them.

## Architecture

```
src/
  shared/        Pure TypeScript used by every process — no Electron, no DOM
    schema.ts      File format (zod): the single source of truth for the JSON shape
    serialize.ts   Canonical, deterministic JSON writer
    parse.ts       Load pipeline: conflict-marker check → JSON → migrate → validate → repair
    values.ts      Property value semantics: defaults, type checks, conversions
    mutations.ts   Cascading changes that keep references consistent (deletes, type changes)
    validate.ts    Live warnings and errors (technical names, ranges, flows, missing references)
    nodes.ts       Flow node types, handles, and the connection rules
    flowAnalysis.ts  Orphans, dead ends, open branches and loop detection (deterministic DFS)
    technicalName.ts  Identifier generation and uniqueness
    expr/syntax.ts     State language: tokenizer and parser (conditions and actions)
    expr/check.ts      Name resolution, type checking, suggestions → bound tree
    expr/runtime.ts    Reference semantics: evaluate, execute, advance time, run rules
    expr/sites.ts      Every expression in a project, and rename-following
    expr/usage.ts      Where each piece of state is used
    export/            Game export: format types, builder, reference runtime
    factory.ts     Constructors for new projects, flows and folders
    ipc.ts         IPC channel names and the typed `window.api` contract
  main/          Electron main process — the only code that touches the disk
    index.ts       Window, native dialogs, IPC handlers, unsaved-changes guard on close
    storage.ts     Atomic writes (temp file + fsync + rename, with Windows lock retries)
    watcher.ts     Detects edits to the open file made outside Skein (git pull, etc.)
    recent.ts      Recent-projects list (stored in the user-data folder, not the project)
    menu.ts        Native menu and shortcuts
  preload/       Narrow, typed bridge exposed as `window.api` (context-isolated, sandboxed)
  renderer/      React UI
    store/projectStore.ts   Zustand store: immutable project snapshots, undo/redo history, UI state
    store/ops.ts            Every edit to the document, each one undoable step
    store/flowOps.ts        Canvas edits: add/move/connect/delete nodes, auto-layout
    components/flow/        The canvas: custom nodes, animated edges, connection line
    components/state/       World variables, relationships, time & rules documents
    components/defs/        Shared definition cards and the live-checked expression field
    lib/projectIO.ts        New / Open / Save / Save As / Reload flows
    components/             Shell, NavTree, Workspace (React Flow), Inspector, Welcome
```

**Data flow.** The renderer holds the project in a Zustand store. On save it sends
the project object to the main process, which serializes it canonically and writes
it atomically. On open, the main process reads the text and the renderer runs it
through `parseProject`. Serialization lives in exactly one place, so every save is
canonical no matter how the in-memory object was built.

**Security.** `contextIsolation`, `sandbox` and no `nodeIntegration`. The renderer
can only read or write paths the user chose in a native dialog (or chose in an
earlier session, via the recent list). The production build ships a strict CSP.
Reload is disabled in production builds so Ctrl+R can't silently discard work.

## The project file

```jsonc
{
  "entities": {
    "<uuid>": {
      "folderId": null, "id": "<uuid>", "name": "Keeper", "order": 0,
      "technicalName": "Keeper",
      "templateId": "<template uuid>",
      "values": { "<property uuid>": 61 },   // only values set on this entity
      "relations": { "<relationship uuid>": { "<other entity uuid>": -1 } }   // starting values, one-way
    }
  },
  "flows": {
    "<uuid>": {
      "edges": { "<uuid>": { "id", "source", "target", "sourceHandle", "targetHandle", "order" } },   // order: choice order on that output
      "folderId": "<uuid> | null",
      "id": "<uuid>",
      "name": "Arrival",
      "nodes": { "<uuid>": { "data": { "speakerId", "text", "isStart", "startOrder" }, "id", "position": { "x", "y" }, "type": "dialogue" } },
      "order": 0
    }
  },
  "folders": { "<uuid>": { "id", "name", "order", "parentId", "section" } },
  "format": "skein.project",
  "meta": { "createdAt", "description", "id", "name" },
  "schemaVersion": 5,
  "state": {
    "relationships": { "<uuid>": { "fromTemplateId", "toTemplateId", "technicalName": "Trust", "type": "number", "min": -5, "max": 5 } },
    "rules": { "<uuid>": { "trigger": "phase", "phaseId": "<night>", "forEachTemplateId": "<character>", "condition": "", "effects": "self.Energy -= 1" } },
    "time": { "phases": { "<uuid>": { "label": "Dawn", "order": 0, "technicalName": "Dawn" } }, "startDay": 1, "startPhaseId": "<uuid>" },
    "variables": { "<uuid>": { "namespace": "World", "technicalName": "StormRaging", "type": "boolean", "defaultValue": true } }
  },
  "templates": {   // properties may carry "mutable": true (changes during play)
    "<uuid>": {
      "color": "#818cf8", "description": "", "folderId": null, "icon": "user",
      "id": "<uuid>", "name": "Character", "order": 0, "technicalName": "Character",
      "properties": {
        "<uuid>": {
          "description": "", "id": "<uuid>", "name": "Age", "order": 0,
          "technicalName": "Age", "type": "number",
          "min": 0, "max": 150, "integer": true            // type-specific, only when set
        }
      }
    }
  }
}
```

### Why it merges cleanly

- **Every collection is a dictionary keyed by UUID**, never an array. Two people
  adding nodes add lines in different places; nobody renumbers anything.
- **Keys are sorted at every depth.** The output is two-space indented, with LF
  line endings and a trailing newline. Saving an unchanged project is
  byte-for-byte identical.
- **Entity values are keyed by property id and only stored when set.** Renaming a
  property touches one line, and changing a template default doesn't rewrite every entity.
- **Node positions are whole pixels**, and node data only stores fields that are set.
- **Hierarchy is by reference** (`parentId`, `folderId`), not nesting. Moving an
  item into a folder changes one line.
- **No volatile data in the file.** There are no "last saved" timestamps,
  viewport/zoom, selection, panel sizes or expanded folders. Those live in the
  app's local storage per machine.
- **Unknown fields are preserved.** A file touched by a newer build doesn't lose
  data when an older build re-saves it. Files from a newer schema version are
  refused with a clear message rather than being mangled.

### When a merge goes wrong

On open, Skein:

- detects leftover git conflict markers and tells you the line number;
- reports JSON syntax errors with line and column;
- validates the structure and names the offending path.

It also repairs referential damage a hand-merge can cause, and lists each fix:

- dictionary keys that don't match their `id`;
- folders whose parent is missing;
- folder loops;
- items in deleted folders;
- connections to deleted nodes.

The repaired project opens marked unsaved, so the next save writes the fix.

While a project is open, Skein watches the file. If it changes on disk, for
example after a `git pull`, a banner offers **Reload from disk** or **Keep my
version**.

### Recommended git setup

Add to the repository that holds your `.skein.json` files:

```gitattributes
*.skein.json text eol=lf
```
