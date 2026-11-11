# Changelog

What's new in Skein, newest first. Dates are when the work landed on `main`.

## 2026-11-11

### Added
- **Try a demo** on the Welcome screen: *The Coffee Order* (simple) and *The Midnight
  Museum Heist* (advanced). Demos open as unsaved copies, so the originals stay intact.
  Regenerate them with `npm run make:demos`.
- **Home** button at the top left to return to the Welcome screen.
- **Show in Play** for world variables: pins the live value to the top of the Play panel,
  like a game HUD. The export marks these variables with `hud: true`.
- Both demos track a coin budget. Choices you can't afford show as locked with what they
  need, and [docs/DEMOS.md](docs/DEMOS.md) lists the full choice matrix.
- Continuous integration: type-check, tests and the web build run on every push.

### Fixed
- Closing a project (Home or ✕) crashed the web app instead of returning to the
  Welcome screen.
- Play state (open panel, play-through, test values) no longer carries over from one
  project to the next.
- Flows open fitted to the canvas, instead of sometimes at 15% zoom in a corner.

### Changed
- **Licensed:** the editor under Apache 2.0, and the runtimes that ship inside games
  under MIT. Stories and exports made with Skein belong to their authors.
- The README is now a getting-started guide. The full reference moved to
  [docs/GUIDE.md](docs/GUIDE.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 2026-11-10

### Added
- **Play panel:** play any flow as the game would, **explore every path**, and set a
  start state to test from.
- **Time that passes by itself:** a minute clock, activities that take time, and spoken
  lines that take as long as they take to say.
- **Dice:** `chance()` and `roll()`, seeded in Play and weighted by their odds in Explore.
- **Seen checks:** node tags with `Seen.Tag` and `Visits.Tag`, **Only once** choices, and
  rules scoped to one flow (export v2).
- `advance until`, and a warning when `advance to` would skip a whole day.
- **Meters:** numbers that go both up and down are flagged until they have a range;
  Explore shows how far they swing.
- **Play flow** nodes for reusable scenes, and jumps that hand off to another flow.
- **Frames** to group nodes into labelled scenes; long expressions now wrap cleanly.
- Explicit choice order and start priority (project format v5).
- **C# runtime** (Unity, Godot .NET, .NET) and **Unity components**.
- **Web build**, deployed on Vercel.

## 2026-11-10 · Phases 1 to 5

The first version on GitHub, bringing together the five phases of the editor:

1. The storage engine and workspace
2. Templates and entities
3. The flowchart editor
4. World variables, character state, relationships, time and rules, with a checked
   expression language
5. Game-engine export, with a reference runtime
