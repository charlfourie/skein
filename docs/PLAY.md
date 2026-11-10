# Play and Explore

Press **Play** at the top right of any flow to test it. The panel runs the flow on
the same export and runtime a game uses (`src/shared/export/runtime.ts`, and the
C# port in `runtimes/csharp`), so what you see is what the game will do.

## Play

- Shows the current line or choice. **1–9** pick a choice, **Enter** continues.
- Choices that aren't available right now are listed greyed out, with the
  requirement that hides them.
- The canvas follows the story (toggle with the crosshair). The current node
  pulses green and nodes already passed are outlined.
- **Changed since the start** lists every value that differs from the starting
  state. The transcript records lines, picks, every state change, time passing
  and each rule that ran.
- **Advance time** (the clock button) moves on one phase, as a game clock would.
- When a flow ends, **Continue in another flow** carries the same state into the
  next scene.
- It warns when the story stops at a node that isn't marked End.

## Start state

Set the time and any world variable to test from a particular situation (a storm
day, high strain, day 4). This never changes the project. Play and Explore both
start from here.

## Explore

Plays **every** combination of choices from the start state and reports:

- how many paths there are, and where they end (with the share of paths for each
  ending, and **Replay** to watch one in the Play tab);
- nodes no path reaches, which usually means a requirement can never hold from
  this start;
- paths that hit an error, paths that never end (a loop with no way out), and
  stops at nodes not marked End;
- the range every number ends up in, next to its defined min and max, so
  unbounded values stand out.

**Vary the start** explores several starting states at once: true and false for
a switch, every option of an enum, or a list of numbers such as `0, 3, 5`. Each
combination is a separate start.

Exploring runs in the background. Set a cap on the number of paths for very
large flows; the report says when it stopped at the cap.

## From code

The explorer is plain TypeScript and runs anywhere:

```ts
import { explore } from './src/shared/play/explore'
const report = explore(exportFile, { flowId, vary: [{ key: 'var:World.Storm', values: [false, true] }] })
```
