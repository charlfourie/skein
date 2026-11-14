# Versions and compatibility

Skein has three version numbers. They move independently, and each one makes a
promise about what keeps working.

| Editor | Project format | Export format | Notes |
| --- | --- | --- | --- |
| 0.9.1 | 8 | 5 | Tester feedback: choices belong to connections (own text, Only once, Requires), hubs keep asking and fall back, Start at in Play, Play panel and inspector fixes |
| 0.9.0 | 7 | 4 | Phase 9: search and replace, Problems, copy and paste, recovery, quick line entry, script view, scene paste |
| 0.8.0 | 7 | 4 | Phase 8: project folders, line IDs, variables inside lines, comments |
| 0.1.0 | 6 | 3 | Phases 1 to 7 (before the editor version was kept up to date) |

## The editor (`0.9.1`)

The app itself, shown in the status bar. Until 1.0 the minor number is the last
finished phase of the [roadmap](../README.md#%EF%B8%8F-roadmap), and the patch
number counts fixes since. Each release is tagged in git (`v0.9.0`) when its phase
is merged into `main`.

## The project format (`skein.project`, version 8)

What Skein saves: a single `.skein.json` file, or a project folder (`project.json`
plus `flows/*.json`). Published as JSON Schemas in [`schemas/`](../schemas).

- **Skein opens every older project**, forever. Each version step has a migration
  in `src/shared/parse.ts`; an old project is upgraded in memory and saved in the
  new format the next time you save.
- **A newer project isn't opened by an older Skein.** It says which version it
  needs, instead of guessing and losing data.
- **Unknown fields are kept.** A field written by a newer build survives a save
  from an older one (as long as that build can open the file at all).
- **A format change bumps the version**, even when it only adds an optional field,
  and comes with a migration and a test that an older file still opens.

## The export format (`skein.export`, version 5)

What games read. Specified in [EXPORT.md](EXPORT.md) and published as
[`schemas/skein.export.v5.json`](../schemas).

- **Each export carries the lowest version that can read it.** A story that uses
  no version 4 features is exported as version 3, so a game whose runtime reads
  version 3 keeps working when the editor updates.
- **A runtime reads its own version and every older one**, and refuses a newer
  file with a message naming both versions.
- **Optional extras don't raise the version.** Line IDs (`line`, `menuLine`) are
  information an older runtime can ignore, so they don't force an update.
  Anything that changes how a story plays (a new node type, a new statement, how
  text is shown) does.
- **Removing or changing the meaning of a field is a breaking change.** It needs a
  new version, and runtimes keep reading the old one.

## The runtimes

The reference runtime (`src/shared/export/runtime.ts`), the C# runtime
(`runtimes/csharp`) and every future port read the same export versions, checked
by the shared [conformance kit](../runtimes/conformance). Each runtime package
says which export versions it reads:

| Runtime | Reads export versions |
| --- | --- |
| TypeScript reference | 1–5 |
| C# (Unity, Godot .NET, .NET) | 1–5 |

A change to how stories play lands in the reference runtime, the conformance
fixtures and every port in the same pull request, or not at all.

## What counts as breaking

| Change | Project format | Export format |
| --- | --- | --- |
| New optional field that changes nothing for old readers | bump, with migration | no bump |
| New node type, statement or expression | bump | bump |
| Changing what an existing field means | bump, with migration | bump; runtimes keep the old meaning for old versions |
| Removing a field | bump, with migration | bump |
