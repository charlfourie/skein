# Play and Explore

Press **Play** at the top right of any flow to test it. The panel runs the flow on
the same export and runtime a game uses (`src/shared/export/runtime.ts`, and the
C# port in `runtimes/csharp`), so what you see is what the game will do.

## Play

- Shows the current line or choice. **1–9** pick a choice, **Enter** continues.
- **Step back** (**Backspace**) undoes the last step: a choice, a line, or time moving on.
  Values, time and dice go back exactly as they were, and the same seed rolls the same
  dice when you play on. Step back as far as the start.
- **Download a log** (the page button) saves the play-through as a `.log.txt`: every line,
  pick, roll, state change and time passing, then what changed overall. Handy for bug
  reports and for anyone without Skein. Saved routes (Save as test) can be named when you
  save them, and renamed by clicking their name in the Tests tab.
- **Skip to the next choice** (**Shift+Enter**) continues through lines that only go one
  way and stops at the next real choice, or where the story ends.
- A flow with several start nodes gets a **Start at** picker. **Automatic** begins where
  the game would (the first start, by priority, whose requirement holds); pick a start to
  play from there instead. A picked start still checks its own requirement. Story tests
  always begin where the game does, so switch back to Automatic to record one.
- Choices that aren't available right now are listed greyed out, with the
  requirement that hides them.
- The canvas follows the story (toggle with the crosshair). The current node
  pulses green and nodes already passed are outlined.
- **Changed since the start** lists every value that differs from the starting
  state. The transcript records lines, picks, every state change, time passing
  and each rule that ran.
- The header shows the day, phase and time of day. Choices show what they cost
  (◷ 2h), and the transcript logs time passing and the activity that took it.
- **Advance time** (the clock button) moves on one phase, as a game clock would.
- Every `chance()` and `roll()` shows in the transcript with how it came out. Dice
  roll from the seed in **Start state**, so the same seed replays the same story.
- When a flow ends, **Continue in another flow** carries the same state into the
  next scene.
- It warns when the story stops at a node that isn't marked End.

## Start state

Set the time and any world variable to test from a particular situation (a storm
day, high strain, day 4). This never changes the story. Play, Explore and new
tests all start from here.

### Scenarios

Save a start state as a **scenario** ("Day 4, storm, 1 coin") so you and the rest
of the team can come back to it. Scenarios are kept in the project file.

- Pick one from the **Scenario** list to load it. Change values and the tab says
  it was **edited since you loaded it**: **Update** it, or **Save as a new scenario**.
- A scenario's setup is stored as ordinary actions, one per line
  (`Player.Coins = 1`), so it can also set entity state and relationships, and it
  follows renames like every other expression.

## Explore

Plays **every** combination of choices from the start state and reports:

- how many paths there are, and where they end (with the share of paths for each
  ending, and **Replay** to watch one in the Play tab). Every `chance()` and `roll()`
  outcome is a separate path, and shares are weighted by the odds, so a 30% chance
  counts as 0.3 of a path. Replay plays the dice exactly as that path had them;
- nodes no path reaches, which usually means a requirement can never hold from
  this start;
- paths that hit an error, paths that never end (a loop with no way out), and
  stops at nodes not marked End;
- `advance to Night` run while it's already Night, which skips a whole day (use
  `advance until Night` if you meant "make it Night"). Play flags these in the
  transcript too;
- every number: where it ends up, how far it swings along the way, its defined
  min and max, and how often a change was held at a limit (a meter that maxes out
  on most paths is worth a look). Numbers with no range are flagged.

**Vary the start** explores several starting states at once: true and false for
a switch, every option of an enum, or a list of numbers such as `0, 3, 5`. Each
combination is a separate start.

Exploring runs in the background. Set a cap on the number of paths for very
large flows; the report says when it stopped at the cap.

## Tests

Story tests are saved checks that a flow still plays the way you meant. They live
in the project file and **re-run in the background a moment after every edit**. The
status bar shows how they're doing (click it to open the first one that needs
attention), and the **Tests** tab lists the current flow's tests.

There are two kinds:

- **Play-throughs.** Play the flow, then press **Save as test**. The test records
  each choice you made (by the node it leads to, so reordering a menu doesn't break
  it) and how every `chance()` and `roll()` came out, where the story stopped, and
  checks that start out as what changed (`Player.Coins == 1`). Edit the checks
  before saving. If you changed the start state by hand, it's saved as a scenario
  too.
- **Every path.** **Check every path** adds a test that explores the flow from a
  scenario and checks that every path ends at a node marked End, optionally that
  every node is reached and that given endings are reachable, and that some
  conditions hold at the end of every path (`Player.Coins >= 0`).

Checks are conditions, one per line, in the same language as the rest of Skein.

When a test fails, it says why in plain words, with **Show** to jump to the node and
**Replay** to watch a failing path. **▶** plays a play-through's route in the Play
tab and stops where it no longer matches. A test whose flow, scenario or ending was
deleted says so rather than quietly passing. If the story changed on purpose,
play the new path, save it, and delete the old test.

### In a build pipeline

```bash
npm run test:story -- story.skein.json          # exits with 1 if a test needs attention
npm run test:story -- story.skein.json --json   # results as JSON
```

## From code

The explorer is plain TypeScript and runs anywhere:

```ts
import { explore } from './src/shared/play/explore'
const report = explore(exportFile, { flowId, vary: [{ key: 'var:World.Storm', values: [false, true] }] })
```

Story tests run the same way, from a project:

```ts
import { runStoryTests } from './src/shared/play/storyTests'
const results = runStoryTests(project) // [{ name, status: 'pass' | 'fail' | 'broken', failures }]
```
