# Demo projects and their coin matrices

Skein ships with two demos on the Welcome screen (**Try a demo**). Both track the player's
money in one world variable, `Player.Coins`, with **Show in Play** switched on, so the live
amount sits at the top of the Play panel.

The two demos handle money in the two common ways:

- **The Coffee Order lets you try.** Every item is on the menu whatever you have. A condition
  after the choice checks the price: if you can pay, the reply spends the coins; if not, Pip
  says what it costs and what you've got, and a jump takes you back to choose again.
- **The Museum Heist locks.** A priced choice has a **Requires** of `Player.Coins >= price`.
  When the player can't afford it, Play still lists it, greyed out with a lock and the
  requirement it needs.

Either way each choice point has at least one free option, so a player is never left with
nothing to pick.

The tables below were produced by playing the exported demos through Skein's reference runtime.
Regenerate the demos with `npm run make:demos`.

## The Coffee Order (simple)

You start with **5 coins**. After each order Pip asks "Anything else?" (and tells you how many
coins you have left, with `{Player.Coins}` in the line) and the flow loops back to the menu,
so you can keep buying until the coins run out.

**Ordering something you can't afford.** Each priced item goes through a condition,
`Player.Coins >= price`. On **true**, Pip serves it and her line's effects spend the coins. On
**false**, Pip tells you the price and how many coins you have (nothing is spent) and a jump
takes you back to the menu. Her "too dear" line is tagged (`FlatWhiteTooDear`,
`CocoaTooDear`, `BiscuitTooDear`), and the item requires `not Seen.<tag>`, so once she's told
you, it leaves the menu: your coins only go down, so asking again couldn't change her answer.
Water is free but **Only once**. Together these mean every path through the café reaches an
ending (Explore confirms it: 2,670 paths, every node reached).

**Menu, by coins in your pocket**

| Coins | Flat white (4) | Hot chocolate (3) | Ginger biscuit (1) | Just water (free, once) | That's everything |
| --- | --- | --- | --- | --- | --- |
| 5 | served | served | served | ✓ | ✓ |
| 4 | served | served | served | ✓ | ✓ |
| 3 | "too dear" | served | served | ✓ | ✓ |
| 2 | "too dear" | "too dear" | served | ✓ | ✓ |
| 1 | "too dear" | "too dear" | served | ✓ | ✓ |
| 0 | "too dear" | "too dear" | "too dear" | ✓ | ✓ |

**Leaving** ("That's everything"): a condition checks `Player.Coins >= 1`.

| Coins left | What happens | Ending |
| --- | --- | --- |
| 3 or more | The tip jar: **Drop a coin in the jar (1)**, **Drop in a handful (3)** or **Not today** | "You're a star…", "Three whole coins? Free refills for life." or "Enjoy! See you tomorrow." |
| 1 or 2 | The same three; a handful gets "That's sweet, but you've only got 1. A coin's plenty, honestly." and back to the jar (where the handful is now gone) | "You're a star…" or "Enjoy! See you tomorrow." |
| 0 | No tip offered | "Pockets empty? Come back tomorrow…" |

Example spends from 5 coins: flat white + biscuit (0 left, no tip); hot chocolate + biscuit +
tip (0 left); three biscuits + tip (1 left); a biscuit + a handful in the jar (1 left).

## The Midnight Museum Heist (advanced)

The crew starts with **5 coins**. `Heist.Alarm` is also shown in Play.

**Priced choices**

| Where | Choice | Cost | Requires | Effect |
| --- | --- | --- | --- | --- |
| 1 · The Plan | Buy Juni a coffee | 1 | Coins ≥ 1, Juni's trust < 2 | Juni trusts you more, so the bluff in The Heist works |
| 1 · The Plan | Buy cat treats | 2 | Coins ≥ 2, no treats yet | Unlocks "Roll a cat treat" in The Heist |
| 2 · The Heist | Slip Gustav a bribe | 4 | Coins ≥ 4 | Silent; Gustav trusts you, which unlocks the Robin Hood ending |
| 3 · The Getaway | Pay the car wash | 2 | Coins ≥ 2 (only when the sirens start) | Guaranteed escape: the Hidden in Plain Suds ending |

Free options at every step: tiptoe past Biscuit, bluff Gustav, floor it with Bruno.

**What you can afford in The Heist, by what you bought in The Plan**

| Bought in The Plan | Coins left | Bribe (4) | Cat treat | Tiptoe | Bluff |
| --- | --- | --- | --- | --- | --- |
| Nothing extra | 5 | ✓ | 🔒 no treats | ✓ | ✓ (fails: alarm) |
| Coffee | 4 | ✓ | 🔒 no treats | ✓ | ✓ (works) |
| Cat treats | 3 | 🔒 | ✓ | ✓ | ✓ (fails: alarm) |
| Coffee and cat treats | 2 | 🔒 | ✓ | ✓ | ✓ (works) |

The 4-coin bribe and the 2-coin treats can't both be bought from 5 coins: that's the
budget decision the demo is built around.

**Endings**

| Ending | How you get there |
| --- | --- |
| Clean Getaway | Quiet heist (alarm under 3), then hand the monkey to Madame Vex (+50 coins) |
| Robin Hood | Quiet heist where Gustav trusts you (bribe or a successful bluff), then return the monkey |
| Hidden in Plain Suds | Sirens, and 2+ coins left to pay the car wash |
| Close Shave | Sirens, floor it, and Bruno's nerve is 4+ (a pep talk in The Plan) |
| Caught | Sirens, floor it, and Bruno's nerve is under 4 |
