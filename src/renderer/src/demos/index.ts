import coffeeOrder from './coffee-order.skein.json?raw'
import museumHeist from './museum-heist.skein.json?raw'

/**
 * Demo projects bundled with the app, shown on the Welcome screen.
 * Regenerate the JSON with `npm run make:demos` (scripts/make-demos.ts).
 */
export interface Demo {
  id: string
  title: string
  level: 'Simple' | 'Advanced'
  blurb: string
  /** A few things worth trying, shown beside the canvas while the demo is open. */
  tryThis: string[]
  /** The project file's text, parsed and checked like any file on disk. */
  text: string
}

export const DEMOS: readonly Demo[] = [
  {
    id: 'coffee-order',
    title: 'The Coffee Order',
    level: 'Simple',
    blurb: 'Spend 5 coins at a café. Ask for what you can’t afford and Pip says so; the menu loops until you leave.',
    tryThis: [
      'Press Play (top right) and order a flat white. Watch Coins drop at the top of the panel.',
      'Now ask for a hot chocolate you can’t afford: Pip tells you the price and what you’ve got.',
      'Step back with Backspace, and pick something else.',
      'Open the Explore tab and press Explore all paths to see every ending.',
      'In Start state, set Coins to 1 and play again: what changes?',
      'Click the hub “The menu” to see each choice’s text and settings.',
      'Try to break it! Odd wording, dead ends, anything that feels off.'
    ],
    text: coffeeOrder
  },
  {
    id: 'museum-heist',
    title: 'The Midnight Museum Heist',
    level: 'Advanced',
    blurb: 'Three flows, a coin budget, items, trust, time phases, rules and five endings.',
    tryThis: [
      'Play “1 · The Plan”: with 5 coins you can’t buy everything. Choose what matters.',
      'When a flow ends, use Continue in another flow to carry on into the next scene.',
      'Buy Juni a coffee and see how her trust changes the bluff in “2 · The Heist”.',
      'Open State › Relationships to see who trusts whom.',
      'Run Explore on each flow: there are five endings in all. Can you reach every one in Play?',
      'Click the tests count in the status bar (bottom right): saved tests re-check after every edit.',
      'Try to break it! Odd wording, dead ends, anything that feels off.'
    ],
    text: museumHeist
  }
]
