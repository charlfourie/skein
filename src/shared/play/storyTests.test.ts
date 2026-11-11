import { readFileSync } from 'fs'
import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { applyRename } from '../expr/sites'
import { parseProject } from '../parse'
import type { Project, StoryTest } from '../schema'
import { serializeCanonical } from '../serialize'
import { runStoryTests } from './storyTests'

// The Coffee Order demo: 5 coins, a menu hub, a tip jar. Nodes are found by their text.
function coffee(): Project {
  const r = parseProject(readFileSync('src/renderer/src/demos/coffee-order.skein.json', 'utf8'))
  if (!r.ok) throw new Error(r.error)
  // Start without the demo's own tests: each test below brings its own.
  return produce(r.project, (d) => {
    delete d.tests
    delete d.scenarios
  })
}
const demo = coffee()
const FLOW = Object.values(demo.flows)[0].id
const byText = (start: string) => {
  const n = Object.values(demo.flows[FLOW].nodes).find((x) => [x.data.menuText, x.data.text, x.data.label].some((t) => typeof t === 'string' && t.startsWith(start)))
  if (!n) throw new Error(`no node “${start}”`)
  return n.id
}
const N = {
  hub: byText('The menu'),
  flatWhite: byText('A flat white'),
  biscuit: byText('A ginger biscuit'),
  everything: byText("That's everything"),
  notToday: byText('Not today'),
  enjoy: byText('Enjoy!'),
  star: byText("You're a star"),
  pocketsEmpty: byText('Pockets empty')
}

const play = (over: Partial<StoryTest> = {}): StoryTest => ({
  id: 't-play',
  name: 'Flat white, no tip',
  order: 0,
  flowId: FLOW,
  scenarioId: null,
  kind: 'play',
  route: [{ choose: N.flatWhite }, { choose: N.everything }, { choose: N.notToday }],
  stopsAt: N.enjoy,
  ends: true,
  checks: 'Player.Coins == 1\nPlayer.ItemsBought == 1',
  ...over
})

const explorer = (over: Partial<StoryTest> = {}): StoryTest => ({
  id: 't-explore',
  name: 'Broke',
  order: 1,
  flowId: FLOW,
  scenarioId: 'broke',
  kind: 'explore',
  allEnd: true,
  reach: [N.pocketsEmpty],
  checks: 'Player.Coins == 0\nPlayer.ItemsBought == 0',
  ...over
})

function withTests(p: Project, ...tests: StoryTest[]): Project {
  return produce(p, (d) => {
    d.scenarios = { broke: { id: 'broke', name: 'No coins', order: 0, setup: 'Player.Coins = 0' } }
    d.tests = Object.fromEntries(tests.map((t) => [t.id, t]))
  })
}

describe('story tests: play', () => {
  it('passes when the recorded route still plays out as saved', () => {
    const [r] = runStoryTests(withTests(coffee(), play()))
    expect(r.failures).toEqual([])
    expect(r.status).toBe('pass')
    expect(r.stop).toEqual({ nodeId: N.enjoy, ended: true })
  })

  it('records choices by node, so reordering the menu changes nothing', () => {
    const p = produce(withTests(coffee(), play()), (d) => {
      for (const e of Object.values(d.flows[FLOW].edges)) if (e.source === N.hub) e.order = 10 - (e.order ?? 0)
    })
    expect(runStoryTests(p)[0].status).toBe('pass')
  })

  it('fails with the values involved when a check is false', () => {
    const [r] = runStoryTests(withTests(coffee(), play({ checks: 'Player.Coins == 2' })))
    expect(r.status).toBe('fail')
    expect(r.failures[0].message).toBe('“Player.Coins == 2” is false (Player.Coins is 1).')
  })

  it('says plainly when a recorded choice was deleted', () => {
    const p = produce(withTests(coffee(), play()), (d) => {
      delete d.flows[FLOW].nodes[N.flatWhite]
      for (const [k, e] of Object.entries(d.flows[FLOW].edges)) if (e.source === N.flatWhite || e.target === N.flatWhite) delete d.flows[FLOW].edges[k]
    })
    const [r] = runStoryTests(p)
    expect(r.status).toBe('fail')
    expect(r.failures[0].message).toMatch(/^At the hub “The menu”, the choice the test picked was deleted\. Offered now: /)
    expect(r.failures[0].nodeId).toBe(N.hub)
  })

  it('notices when a choice is no longer offered, and when the story stops somewhere else', () => {
    // Make the flat white cost 6: with 5 coins it's locked.
    const p = produce(withTests(coffee(), play()), (d) => {
      d.flows[FLOW].nodes[N.flatWhite].data.requires = 'Player.Coins >= 6'
    })
    expect(runStoryTests(p)[0].failures[0].message).toMatch(/“A flat white \(4 coins\)” isn't offered any more/)

    const q = withTests(coffee(), play({ stopsAt: N.star }))
    expect(runStoryTests(q)[0].failures[0].message).toBe(
      'It should end at “You\'re a star. Next foam fern is extra leafy.”, but now it ends at “Enjoy! See you tomorrow.”.'
    )
  })

  it('can stop partway, waiting at a choice', () => {
    const [r] = runStoryTests(withTests(coffee(), play({ route: [], stopsAt: N.hub, ends: false, checks: 'Player.Coins == 5' })))
    expect(r.status).toBe('pass')
    expect(r.stop).toEqual({ nodeId: N.hub, ended: false })
  })

  it('reports leftover steps when the story now ends early', () => {
    const [r] = runStoryTests(withTests(coffee(), play({ route: [...play().route!, { choose: N.biscuit }] })))
    expect(r.status).toBe('fail')
    expect(r.failures[0].message).toMatch(/before the last 1 recorded step\.$/)
  })
})

describe('story tests: explore', () => {
  it('checks every path from a scenario', () => {
    const [r] = runStoryTests(withTests(coffee(), explorer()))
    expect(r.failures).toEqual([])
    expect(r.status).toBe('pass')
    expect(r.paths).toBeGreaterThan(1)
  })

  it('finds paths where a check fails, with one to replay', () => {
    const [r] = runStoryTests(withTests(coffee(), explorer({ scenarioId: null, reach: [], checks: 'Player.Coins >= 1' })))
    expect(r.status).toBe('fail')
    expect(r.failures[0].message).toMatch(/^“Player.Coins >= 1” isn't true at the end of \d+ of \d+ paths \(Player.Coins is 0\)\.$/)
    expect(r.failures[0].example?.choices.length).toBeGreaterThan(0)
  })

  it('reports unreachable nodes and endings', () => {
    const [r] = runStoryTests(withTests(coffee(), explorer({ allReached: true, reach: [N.star], checks: '' })))
    expect(r.status).toBe('fail')
    const messages = r.failures.map((f) => f.message)
    expect(messages.some((m) => m.startsWith('No path reaches '))).toBe(true)
    expect(messages).toContain('No path ends at “You\'re a star. Next foam fern is extra leafy.”.')
  })
})

describe('story tests: broken tests and renames', () => {
  it('reports tests that cannot run as written', () => {
    const p = withTests(
      coffee(),
      play({ id: 'a', checks: 'Player.Cons == 1' }),
      play({ id: 'b', flowId: 'gone' }),
      explorer({ id: 'c', scenarioId: 'gone' }),
      explorer({ id: 'd', reach: ['gone'] })
    )
    const r = Object.fromEntries(runStoryTests(p).map((x) => [x.testId, x]))
    expect(r.a.status).toBe('broken')
    expect(r.a.failures[0].message).toMatch(/^Check “Player.Cons == 1”: /)
    expect(r.b.failures[0].message).toBe('The flow it tests no longer exists.')
    expect(r.c.failures[0].message).toBe('The scenario it starts from was deleted.')
    expect(r.d.status).toBe('broken')
  })

  it('follows renames into scenario setups and checks', () => {
    const p = produce(withTests(coffee(), play(), explorer()), (d) => {
      const v = Object.values(d.state.variables).find((x) => x.technicalName === 'Coins')!
      v.technicalName = 'Money'
      applyRename(d as Project, { kind: 'variable', fromNamespace: 'Player', fromName: 'Coins', toNamespace: 'Player', toName: 'Money' })
    })
    expect(p.scenarios!.broke.setup).toBe('Player.Money = 0')
    expect(p.tests!['t-play'].checks).toBe('Player.Money == 1\nPlayer.ItemsBought == 1')
    expect(runStoryTests(p).map((r) => r.status)).toEqual(['pass', 'pass'])
  })

  it('saves and loads scenarios and tests, and older files still open', () => {
    const p = withTests(coffee(), play(), explorer())
    const back = parseProject(serializeCanonical(p))
    if (!back.ok) throw new Error(back.error)
    expect(back.repairs).toEqual([])
    expect(back.project.tests).toEqual(p.tests)
    expect(back.project.scenarios).toEqual(p.scenarios)
    expect(back.project.schemaVersion).toBe(6)
  })
})
