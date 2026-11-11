# Skein for Unity

Plays stories written in [Skein](https://skein-mocha.vercel.app). Write and branch
the story in Skein, export it, and the game reads the export. No parser, no
packages. Works with Unity 6 and the new Input System.

```
Skein/
  Runtime/   engine-neutral C# port of Skein's reference runtime (pure C#, no UnityEngine)
  Unity/     components: SkeinRunner, SkeinTalkTrigger, SkeinDialogueBox, SkeinClock, SkeinVariableEvents
```

## Workflow

1. Edit the story in Skein: open `Story/Atlantic Frequency.skein.json` (at the
   Unity project root, outside `Assets/`).
2. **File › Export for Game Engine… (Ctrl+E)** and save over
   `Assets/Story/AtlanticFrequency.game.json`.
3. Back in Unity, the new story is picked up the next time you press Play.

## Scene setup (once)

1. Create an empty GameObject called **Skein**. Add **Skein Runner** and drag
   `Assets/Story/AtlanticFrequency.game.json` into *Export File*.
2. Add **Skein Dialogue Box** to the same object. Drag the player's movement and
   camera scripts (e.g. `ThirdPersonController`) into *Disable While Talking*.
3. Optional: add **Skein Clock** for real-time days and phases. Set *Seconds Per
   Phase* and *Last Day* (5 for the time loop). Untick *Show Hud* for release.

## Making something talk

Add **Skein Talk Trigger** to an object with a collider and tick *Is Trigger*. Set
*Flow* to the flow's name in Skein (e.g. `Distribution Rack`). The player
(tagged `Player`) walks in and presses **E**. If the flow's start node has a
requirement that doesn't hold, nothing plays, so "only once" or "only at night"
logic belongs in Skein, not in the scene.

## Reacting to the story

**Skein Variable Events** fires Unity events when a value changes. For example,
`World.BunkerLightOn` → *On True* → enable the bunker light. (This replaces the
Ink prototype's `# light_on` tag.)

From code:

```csharp
using Skein.Unity;

var skein = SkeinRunner.Instance;
skein.Play("Distribution Rack");
bool bypassed = skein.World.GetBool("World.SolenoidBypassed");
skein.World.SetVar("World.BunkerLightOn", true);
skein.World.AdvanceTo("Night");              // runs Skein's rules for each phase passed
string day = $"Day {skein.World.Day}, {skein.World.PhaseLabel}";

skein.BeatChanged += beat => { /* your own dialogue UI: beat.Speaker, beat.Text, beat.Choices */ };
skein.Choose(0);

PlayerPrefs.SetString("save", skein.SaveToJson());   // or SaveToPlayerPrefs()
skein.LoadFromJson(PlayerPrefs.GetString("save"));
skein.ResetWorld();                                   // time loop: back to day 1, starting values
```

## Correctness

`Runtime/` is a line-for-line port of `src/shared/export/runtime.ts` in the Skein
repo. `runtimes/csharp/tests` replays seeded synthetic exports (every operator,
statement, node type and coercion edge case) through both runtimes and checks the
traces are byte-identical.

## License

MIT (see [`runtimes/LICENSE`](../../LICENSE)). Use these components in any game, open or
closed, free or paid; just keep the licence notice.
