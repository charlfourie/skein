# Skein architecture and file format

How Skein is built, what a project file looks like, and why it merges cleanly in git.
For using the editor, see the [user guide](GUIDE.md).

## Code layout

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
