import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { buildExport } from './export/build'
import { SkeinStory, SkeinWorld } from './export/runtime'
import { parseProject } from './parse'
import { runStoryTests } from './play/storyTests'

const load = (name: string) => {
  const parsed = parseProject(readFileSync(`src/renderer/src/demos/${name}.skein.json`, 'utf8'))
  if (!parsed.ok) throw new Error(parsed.error)
  expect(parsed.repairs).toEqual([])
  return buildExport(parsed.project)
}

describe('bundled demos', () => {
  for (const name of ['coffee-order', 'museum-heist']) {
    it(`${name} ships with story tests, and they pass`, () => {
      const parsed = parseProject(readFileSync(`src/renderer/src/demos/${name}.skein.json`, 'utf8'))
      if (!parsed.ok) throw new Error(parsed.error)
      const results = runStoryTests(parsed.project)
      expect(results.length).toBeGreaterThan(1)
      expect(results.filter((r) => r.status !== 'pass').map((r) => [r.name, r.failures])).toEqual([])
    })
  }

  for (const name of ['coffee-order', 'museum-heist']) {
    it(`${name} exports without problems and shows coins in Play`, () => {
      const { file, problems } = load(name)
      expect(problems).toEqual([])
      expect(file.state.variables['Player.Coins'].hud).toBe(true)
    })
  }

  it('offers the whole coffee menu, and says so when you come up short', () => {
    const { file } = load('coffee-order')
    const flow = Object.values(file.flows)[0]
    const hub = Object.values(flow.nodes).find((n) => n.type === 'hub' && n.label === 'The menu')!
    if (hub.type !== 'hub') throw new Error('no menu')
    const story = (coins: number) => new SkeinStory(new SkeinWorld(file, { changes: { 'var:Player.Coins': coins }, day: 1, phase: null } as never), flow.id)
    for (const coins of [0, 1, 3, 4]) {
      const s = story(coins)
      expect(hub.next.filter((id) => s.available(id))).toHaveLength(5) // everything, water and leaving included
    }
    // One coin, a flat white: Pip says what it costs, nothing is spent, and you're back at the menu without it.
    const s = story(1)
    let beat = s.start()
    while (beat.kind === 'line' && beat.choices.length === 1) beat = s.choose(0)
    if (beat.kind === 'end') throw new Error('ended early')
    const flat = beat.choices.findIndex((c) => c.text.startsWith('A flat white'))
    beat = s.choose(flat)
    const said: string[] = []
    while (beat.kind === 'line' && beat.choices.length <= 1) {
      said.push(beat.text)
      beat = s.choose(0)
    }
    expect(said.join(' ')).toContain("A flat white's 4 coins, and you've got 1.")
    expect(s.world.read({ get: 'var', var: 'Player.Coins' })).toBe(1)
    if (beat.kind === 'end') throw new Error('ended early')
    expect(beat.choices.map((c) => c.text)).not.toContain('A flat white (4 coins)')
    expect(beat.choices.map((c) => c.text)).toContain('A ginger biscuit (1 coin)')
  })
})
