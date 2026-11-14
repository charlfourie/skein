# Skein user guide

The full reference for working in Skein. New here? Start with the
[README](../README.md) and the two demos on the Welcome screen, then come back
for the details.

**Contents:** [Templates](#templates) · [Entities](#entities) · [Flows](#flows) ·
[Writing](#writing) · [State](#state) · [Expression language](#expression-language) ·
[Time](#time) · [Saving](#saving-project-folders) · [Export](#export-for-game-engines) ·
[Play and Explore](#play-and-explore) · [Undo](#undo-and-redo) · [Shortcuts](#keyboard-shortcuts)

## Templates

**Templates** define a data structure, such as *Character* with Role, Age, Is Alive and Faction.
Create one under **Templates** in the explorer. The designer opens in the centre:

- add properties of seven types: text, long text, number, yes/no, choice, entity link, colour;
- drag the handle to reorder them;
- expand a property to set its default, description, number limits, choice options, or which
  template a link may point to.

Colour, icon and description live in the inspector on the right.

## Entities

**Entities** are instances of a template. Use **+** under **Entities** (or **New entity** in a
template) and pick the template. The entity sheet shows every property:

- a blue dot means the value is set on this entity;
- a grey dot means it is inherited from the template default;
- ↺ resets a value to the default.

Duplicate an entity with Ctrl+D. At the bottom of its sheet: the lines it speaks, **Used in
logic** (every condition, effect, requirement, line and rule that reads or changes its
state or relationships, each a link) and the entities that link to it. A template's page
lists the entities made from it, each a link to its sheet.

**Technical names** (e.g. `IsAlive`) are the identifiers scripts and game engines will use. They
are derived from the display name and follow renames, until you edit one by hand. Duplicates and
invalid identifiers are flagged in red.

## Flows

**Flows** are edited on the canvas. Six node types:

| Node | What it does |
| --- | --- |
| **Dialogue** | A line spoken by a character |
| **Condition** | Branches true / false |
| **Instruction** | Changes game state |
| **Hub** | A meeting point that paths merge into, and a menu of choices. Its second output, **none left**, is where the story goes once none of its choices is available |
| **Jump** | Continues at another node, or hands off to another flow's start |
| **Play flow** | Plays another flow (a reusable scene), then carries on from here |

- **Adding nodes:** drag from the palette, click a palette entry, or double-click or
  right-click the canvas.
- **Frames:** select some nodes and press **Frame** (or Ctrl+G) to box them as a
  labelled scene. Drag the title bar to move the frame with everything in it,
  double-click it to rename it, and pick a colour on hover. Frames are only there to
  help you read the canvas: they're never exported. Auto-layout refits them.
- **Connecting:** drag from an output (bottom) to an input (top). While you drag:
  - inputs that can take the connection glow green;
  - nodes that can't take it fade back;
  - the line snaps onto a valid input once you're within about 40px.
- **Quick-add:** drop a connection on empty canvas to create the next node there,
  already connected.
- **Edges:** particles show which way the story runs. Condition branches are green
  (true) and red (false). A connection that leads back to an earlier point is purple
  and dashed, with a ↺ loop badge.
- **Starts and endings:** start nodes have a green halo and a START badge; nodes marked End
  have a blue halo and an END badge. When a flow has several endings they're numbered in
  reading order (END 1, END 2…), the same numbers the script view uses. Blue, because red
  means an error and a pulsing green means where Play is.
- **Warnings:** orphans (nothing leads in, and the node isn't a start) and dead ends
  (nothing follows, and it isn't an end) pulse amber. Errors pulse red.
- **Finding problems:** the chips at the top right count problems and loops; click
  one to visit each in turn.
- **Inspector:** select a node to write its line, choose a speaker from your entities,
  set condition or instruction text, pick a jump target, mark start or end, or add a
  designer note.
- **Choices:** select the line or hub that offers them. Under **Choices, in order**
  each choice has its own **choice text** (blank shows the line it leads to), and its
  settings button holds **Only once** and **Requires** for that choice alone. The same
  line can be offered as "Tell a joke" from one hub and "Tell it again" from another.
  The line itself shows what it's **Chosen as**, and where from. On the canvas each
  choice's connection shows its number and text, `1×` when it's once-only, and a lock
  when it has a requirement.
- **Values in lines:** put an expression in braces to show its value as the line plays:
  `You've got {Player.Coins} left.` Options show their label and entities their name.
  Placeholders are checked as you type and follow renames. Write `{{` or `}}` for a
  literal brace. Play shows the filled-in line.
- **Line IDs:** every line has a stable ID for voice-over and translation, shown (with a
  copy button) under the line in the inspector: `ORDER_3f9a2c`. Choice text has its own
  ID: `ORDER_3f9a2c_M` for the first choice into that line, `_M2`, `_M3` for others. The ID never changes when you edit the text, move the node or rename
  the flow. The prefix comes from the flow's name; change it under **Line IDs** in the
  flow's inspector (new lines use it; **Rename them** moves existing lines over too).
- **Comments:** leave a comment for the team at the bottom of any node's inspector,
  reply, and resolve the thread when it's done. Your name is set the first time you
  comment and stays on your computer (there are no accounts). Nodes with open threads
  show a 💬 badge, and the **open comments** chip at the top right visits each one.
  Comments travel with the project file and are never exported.
- **Keys:** Delete removes, Ctrl+D duplicates, Shift+drag box-selects. Press **?** for
  every shortcut.
- **Auto-layout and preferences:** auto-layout (dagre, undoable) tidies the flow. Snap
  to grid and edge animation are per-machine preferences.

## Writing

Tools for getting words down quickly and keeping a large project in order.

### Quick line entry

Select a line and press **Enter**: the next line appears below it, connected, with the
cursor in its text. It's spoken by whoever spoke before, so a two-person exchange
alternates by itself. Keep typing and pressing Enter to write a whole scene without
the mouse.

- **Ctrl/⌘+Enter** adds another choice beside the current line (from the same node,
  offered right after it).
- **Alt+↑ / Alt+↓** changes the speaker.
- **Shift+Enter** puts a line break in the text; **Esc** goes back to the canvas.
- If the line already led straight on to another node, the new line goes in between and
  what was below moves down to make room. A line marked as an end passes the end mark
  on to the new last line, and gets it back if you delete that line. New lines never land on top of other nodes.

### Script view

Switch a flow between **Canvas** and **Script** (above the flow, on the right). The script
shows the flow the way a reader follows it: lines in order, choices numbered and indented
under the line that offers them, the true and false sides of a condition, and where the
story jumps or loops back. Anything no start reaches is listed at the end.

In the script you can rewrite a line, change its speaker, add a line after it (**Enter**,
or the **+** on hover) and move a choice up or down. Everything else (conditions,
requirements, effects) is edited on the canvas; the crosshair on any row shows it there.
**Print** opens a screenplay-style page for a table read.

### Pasting a scene

Write a scene anywhere (a document, a chat) and paste it onto the canvas, or use
**Paste a scene…** in the script view:

```
PIP: Morning! What can I get you?
(wiping the counter)

> A flat white, please.
> Just water, thanks.

PIP
Coming right up.
```

- `NAME: text`, or a name on its own line above its text, is a line by that speaker.
- `(…)` is a stage direction, kept as the line's note.
- `> text` is a choice; choices in a row make one menu, and each leads on to the line
  after the menu. A choice with no name is spoken by whoever usually picks choices.
- Text with no name is narration. Text straight under a line (no blank line between)
  carries on that line.

A preview shows what will be added. Each name is matched to an entity by name, technical
name or first name; change it to another entity, a new character, or narration. The
lines go below the selected node (connected to it if nothing follows it yet) or where the
pointer is, and the whole paste is one undo step.

### Copy and paste

**Ctrl/⌘+C** copies the selected nodes, the connections between them and any selected
frames; **Ctrl/⌘+X** cuts; **Ctrl/⌘+V** pastes them where the pointer is. It goes through
the system clipboard, so you can paste into another flow, another project, or Skein in
another tab. Pasted nodes are new nodes with their own line IDs, and never a second start.
Speakers are matched by technical name and flows by name; anything that can't be matched
is left empty, and Skein says what.

### Search and replace

**Ctrl/⌘+F** opens **Search** in the left panel. It searches lines, choice text,
conditions, effects, notes, comments and names across the project, with match case, whole
word and regular expressions, and can narrow to one flow, one speaker or some kinds of
text. Results are grouped by flow; click one to go to it.

**Replace** works on one result at a time (hover a result) or all of them. Replace all
shows every change first, and refuses any that would break a condition or action (renaming
`Player.Coins` to a variable that doesn't exist, say). Names are never replaced: rename
those in place, so everything that uses them follows. With a regular expression, `$1` in the
replacement is the first group.

### Problems

The **Problems** tab (next to Search, with a count) lists every error and warning in the
project, and every failing story test, grouped by flow. Click one to go to it. The counts
in the status bar open it too.

### Unsaved changes are kept

While a project has unsaved changes, Skein keeps a copy of them in your browser (never in
your project files). If the tab closes or the browser crashes, the Welcome screen offers
the changes back next time: **Restore** reopens the project and puts the changes back
over it, as one step you can undo; **Discard** throws the copy away. Opening a project that
has such a copy asks first. Copies are removed once you save, and after 30 days. They live
in this browser on this computer only.

## State

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
- **Other nodes** can also have **Requires** (it's only available while this holds) and
  **Effects** (applied when the story passes through). The inspector shows only the ones
  that make sense: a condition node has neither (it's already a check, so put changes in an
  instruction), and an instruction node has no separate Effects (its instruction is where
  changes go). An older project that has these set keeps showing them, with a note to move them.

A number that actions push both up and down (a meter, like Strain or Trust) is flagged until it has a min and max.

Expressions are checked as you type. Mistakes are explained with a suggestion
("no property “Mod”. Did you mean “Mood”?"), and nodes with broken expressions turn
red on the canvas. Conditions show whether they are true at game start. Renaming an
entity, property, variable or relationship rewrites the expressions that use it.

### Show in Play

Switch on **Show in Play** for a world variable (State › World variables, expand the
variable) to pin its live value at the top of the Play panel, like a game's HUD:
coins, health, time left. The export marks it with `hud: true` so your game knows it's
meant to be shown. Both demos use it for `Player.Coins`.

## Expression language

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
pass 1h 30m                         # let time go by (rolls into the next phase as needed)
Time.Hour >= 22                     # the time of day: Time.Hour, Time.Minute
```

## Time

**Time passes by itself.** Each phase has a length (Night = 9h) and the day starts at a
time you set. Activities take time: name them in **Time & rules** ("Repair the radio:
2h") and give a node an activity, or type how long it takes. Spoken lines take as long
as they take to say, at a speaking rate you choose. When time runs past the end of a
phase, the next one begins and its rules run. Play shows the clock and what each choice
costs, and the canvas marks nodes that take time.

Dice (`chance(30)`, `roll(1, 6)`) work in actions and in Condition nodes, where each
visit rolls once. Requirements can't use them, since they are checked whenever choices
are listed. Play rolls from a seed you can set in **Start state**. Explore tries every
outcome and weights the endings by the odds.

Give a node a **Tag** in its inspector to refer to it with `Seen.Tag` / `Visits.Tag`
from any flow. **Only once** on a choice hides it after it has been picked; on a node, the
story can only enter that node once, by any route. A rule can be
limited to **While playing** one flow, so it doesn't run during other scenes.

**When choices run out.** A hub with several choices keeps showing its menu while any
choice is left, even just one, so the player still picks "Leave" rather than being
sent there. Once none is left, the story follows the hub's **none left** output, for
example to "I've heard all your jokes." With nothing connected there, the path ends.
Only once on the hub itself means the story can't come back to the hub at all: put it
on the choices instead.

Operators: `and or not` (or `&& || !`), `== != < <= > >=`, `is`, `is not`, and
`+ - * /`. `#` starts a comment.

Numbers are clamped to their limits when changed during play. Only state can be
changed: properties marked "Changes during play", world variables and relationships.

Time advances only through `advance`. Each phase that begins runs its rules, in
listed order. A new day runs day rules first, then phase rules. Rules can't advance
time themselves.

## Saving: project folders

Skein saves a project as a **folder**, with one file per flow:

```
Atlantic Frequency.skein/
  project.json                         templates, entities, state, scenarios
  flows/
    distribution-rack.3f9a2c.json      one flow, with its comments and story tests
```

People editing different flows never touch the same file, so merges stay simple.

In Chrome, Edge, Brave and Arc, **Open** (Ctrl+O) picks a project folder and **Save As**
(Ctrl+Shift+S) makes a new one. To open an older single `.skein.json` file, use **Open a
file…** on the Welcome screen (or Ctrl+Shift+O); the first time you save it, Skein
offers to convert it to a folder (the old file is left where it was). The browser asks
once per visit before Skein may save into a folder.

Firefox and Safari can't write folders, so there a project is a single `.skein.json`
file: Open uploads it into the tab and Save downloads it.

## Export for game engines

**Export for game engines:** press Ctrl+E (or the package
icon in the top bar). It writes a clean JSON file:

- no positions, colours, folders or notes;
- everything named by its technical name, and entity values with defaults applied;
- every condition and action pre-compiled to a small JSON tree, so the game needs no parser.

Exports are deterministic, so they diff cleanly. The dialog:

- lists any broken expressions and links to each one;
- exports them safely if you choose to export anyway (a broken condition becomes
  "always false", a broken action becomes "no change");
- offers compact output and stripping the expression text.

## Play and Explore

**Play and Explore:** press **Play** on any flow to click through it exactly as a game
would, with live state, time and rule activity, from any starting state you set up.
**Explore** plays every path at once and reports unreachable nodes, endings, loops with
no way out and where numbers end up. See [`PLAY.md`](PLAY.md).

For engine developers:

- [`EXPORT.md`](EXPORT.md) specifies the format and exactly how flows, time
  and rules run.
- `src/shared/export/runtime.ts` is a dependency-free reference runtime: `SkeinWorld`
  for state, time and rules, and `SkeinStory` to play a flow beat by beat. Use it as-is
  in a JS/TS game, or port it.
- `runtimes/csharp` is a C# port (Unity, Godot .NET, plain .NET) that matches the reference
  byte for byte; `runtimes/unity` adds ready-made Unity components.
- `examples/lighthouse-v2.game.json` is a sample export.

## Undo and redo

**Undo / redo:** Ctrl+Z and Ctrl+Y (or Ctrl+Shift+Z), or the arrows in the top bar. Inside a text
field these undo typing; elsewhere they step through project changes. That includes deletes,
which is why most deletes only ask for confirmation when something else depends on them.

## Keyboard shortcuts

Press **?** anywhere outside a text field (or the keyboard icon in the status bar) for the
full list. On a Mac, ⌘ replaces Ctrl and ⌥ replaces Alt.

| Keys | Does |
| --- | --- |
| Ctrl+O, Ctrl+Shift+O | Open a project, open a single file |
| Ctrl+S, Ctrl+Shift+S | Save, Save As |
| Ctrl+E | Export for a game engine |
| Alt+N | New project |
| Ctrl+Shift+W | Close the project |
| Ctrl+Z, Ctrl+Y | Undo, redo |
| Ctrl+F | Search and replace |
| Ctrl+C, Ctrl+X, Ctrl+V | Copy, cut, paste nodes (or paste a scene written as text) |
| Ctrl+D, Ctrl+G | Duplicate, frame the selected nodes |
| Enter | Next line (a line selected, or in its text) |
| Ctrl+Enter | Another choice beside this one |
| Alt+↑, Alt+↓ | Change the speaker |
| F2 | Rename in the explorer |
