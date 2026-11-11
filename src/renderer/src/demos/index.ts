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
  /** The project file's text, parsed and checked like any file on disk. */
  text: string
}

export const DEMOS: readonly Demo[] = [
  {
    id: 'coffee-order',
    title: 'The Coffee Order',
    level: 'Simple',
    blurb: 'Spend 5 coins at a café. What you can’t afford locks, and the menu loops until you leave.',
    text: coffeeOrder
  },
  {
    id: 'museum-heist',
    title: 'The Midnight Museum Heist',
    level: 'Advanced',
    blurb: 'Three flows, a coin budget, items, trust, time phases, rules and five endings.',
    text: museumHeist
  }
]
