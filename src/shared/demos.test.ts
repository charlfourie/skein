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

  it('locks the coffee menu items the player cannot afford', () => {
    const { file } = load('coffee-order')
    const flow = Object.values(file.flows)[0]
    const hub = Object.values(flow.nodes).find((n) => n.type === 'hub')!
    if (hub.type !== 'hub') throw new Error('no hub')
    const offered = (coins: number) => {
      const story = new SkeinStory(new SkeinWorld(file, { changes: { 'var:Player.Coins': coins }, day: 1, phase: null } as never), flow.id)
      return hub.next.filter((id) => story.available(id)).length
    }
    expect([0, 1, 3, 4].map(offered)).toEqual([2, 3, 4, 5]) // water + leave are always offered
  })
})
