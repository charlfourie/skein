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
    blurb: 'One flow: a choice, a condition, coins to spend and a loop back to the menu.',
    text: coffeeOrder
  },
  {
    id: 'museum-heist',
    title: 'The Midnight Museum Heist',
    level: 'Advanced',
    blurb: 'Three flows, items, trust, time phases, rules and four endings.',
    text: museumHeist
  }
]
