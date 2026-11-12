import { readFileSync } from 'fs'
import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { orderedTargets } from './flowOrder'
import { parseProject } from './parse'
import type { Project } from './schema'
import { addScreenplay, characterName, matchSpeaker, parseScreenplay, screenplayNames, usualChooser } from './screenplay'
import { endingNumbers, scriptHtml, scriptOf } from './script'

function load(path: string): Project {
  const r = parseProject(readFileSync(path, 'utf8'))
  if (!r.ok) throw new Error(r.error)
  return r.project
}
const coffee = () => load('src/renderer/src/demos/coffee-order.skein.json')
const flowOf = (p: Project) => Object.values(p.flows)[0]

describe('script view', () => {
  it('shows every node exactly once, starting at the start, with choices numbered in play order', () => {
    const p = coffee()
    const f = flowOf(p)
    const items = scriptOf(f)
    const shown = items.filter((i) => 'nodeId' in i && i.kind !== 'when' && !(i.kind === 'goto' && i.reason === 'again')).map((i) => ('nodeId' in i ? i.nodeId : ''))
    expect(new Set(shown).size).toBe(shown.length)
    expect(new Set(shown)).toEqual(new Set(Object.keys(f.nodes)))
    expect(items[0]).toMatchObject({ kind: 'line', depth: 0 })
    expect(f.nodes[(items[0] as { nodeId: string }).nodeId].data.isStart).toBe(true)
    const menu = Object.values(f.nodes).find((n) => n.type === 'hub')!
    const choices = items.filter((i) => 'branch' in i && i.branch && f.edges[i.branch.edgeId]?.source === menu.id)
    expect(choices.map((c) => ('branch' in c ? c.branch!.index : -1))).toEqual(choices.map((_, i) => i))
    expect(choices.map((c) => ('nodeId' in c ? c.nodeId : ''))).toEqual(orderedTargets(f, menu.id))
    expect(items.some((i) => i.kind === 'goto')).toBe(true) // the menu loops
  })

  it('includes nodes no start reaches, and prints', () => {
    const p = produce(coffee(), (d) => {
      const f = flowOf(d as Project)
      f.nodes.loose = { id: 'loose', type: 'dialogue', position: { x: 0, y: 9999 }, data: { text: 'Nobody hears <this>.' } }
    })
    const f = flowOf(p)
    const items = scriptOf(f)
    const at = items.findIndex((i) => i.kind === 'unreached')
    expect(at).toBeGreaterThan(0)
    expect(items.slice(at)).toContainEqual({ kind: 'line', nodeId: 'loose', depth: 0 })
    const html = scriptHtml(p, f, items)
    expect(html).toContain('Nobody hears &lt;this&gt;.')
    expect(html).toContain('Not reached from a start')
  })
})

describe('screenplay paste', () => {
  const scene = `PIP: Morning! What can I get you?
(wiping the counter)

> A flat white, please.
> YOU: Just water.

PIP
Coming right up.
It won't be long.

The café goes quiet.`

  it('reads lines, cues, directions, choices and narration', () => {
    const lines = parseScreenplay(scene)!
    expect(lines).toEqual([
      { name: 'PIP', text: 'Morning! What can I get you?', choice: false, direction: 'wiping the counter' },
      { name: null, text: 'A flat white, please.', choice: true },
      { name: 'YOU', text: 'Just water.', choice: true },
      { name: 'PIP', text: "Coming right up. It won't be long.", choice: false },
      { name: null, text: 'The café goes quiet.', choice: false }
    ])
    expect(screenplayNames(lines)).toEqual(['PIP', 'YOU'])
    expect(parseScreenplay('Just some text\nwith no speakers.')).toBeNull()
  })

  it('matches speakers by name, technical name or first name', () => {
    const p = coffee()
    const pip = Object.values(p.entities).find((e) => e.technicalName === 'Pip')!
    expect(matchSpeaker(p, 'PIP')).toBe(pip.id)
    expect(matchSpeaker(p, 'pip the barista')).toBe(pip.id)
    expect(matchSpeaker(p, 'Stranger')).toBeNull()
  })

  it('adds the scene as connected lines, menus side by side, creating new characters', () => {
    const p = coffee()
    const f = flowOf(p)
    const lines = parseScreenplay(scene + '\n\nSTRANGER: Is this seat taken?')!
    const pip = matchSpeaker(p, 'PIP')
    let counter = 0
    const newId = () => `s${++counter}`.padEnd(8, '0') + '-0000-0000'
    let r: ReturnType<typeof addScreenplay> | null = null
    const next = produce(p, (d) => {
      r = addScreenplay(d as Project, f.id, lines, { PIP: pip, YOU: matchSpeaker(p, 'YOU'), STRANGER: 'new' }, { at: { x: 0, y: 0 }, newId })
    })
    const res = r!
    const nf = flowOf(next)
    expect(res.nodeIds).toHaveLength(6)
    expect(res.newEntityIds).toHaveLength(1)
    expect(next.entities[res.newEntityIds[0]]).toMatchObject({ name: 'Stranger', technicalName: 'Stranger' })
    const [first, a, b, coming, quiet, stranger] = res.nodeIds
    expect(orderedTargets(nf, first)).toEqual([a, b])
    expect(orderedTargets(nf, a)).toEqual([coming])
    expect(orderedTargets(nf, b)).toEqual([coming])
    expect(orderedTargets(nf, coming)).toEqual([quiet])
    expect(orderedTargets(nf, quiet)).toEqual([stranger])
    expect(nf.nodes[first].data).toMatchObject({ speakerId: pip, note: 'Direction: wiping the counter' })
    expect(nf.nodes[quiet].data.speakerId).toBeUndefined()
    expect(nf.nodes[stranger].data.speakerId).toBe(res.newEntityIds[0])
    expect(nf.nodes[a].position.y).toBe(nf.nodes[b].position.y)
    // Nothing overlaps what was already there.
    for (const id of res.nodeIds)
      for (const old of Object.values(f.nodes)) {
        const n = nf.nodes[id].position
        expect(Math.abs(n.x - old.position.x) < 260 && Math.abs(n.y - old.position.y) < 96).toBe(false)
      }
  })
})

describe('who picks choices', () => {
  it('is whoever speaks most choices, and unnamed pasted choices get them', () => {
    const p = coffee()
    const f = flowOf(p)
    const you = Object.values(p.entities).find((e) => e.technicalName !== 'Pip')!.id
    expect(usualChooser(p, f.id)).toBe(you)
    let ids: string[] = []
    const next = produce(p, (d) => {
      ids = addScreenplay(d as Project, f.id, parseScreenplay('PIP: Well?\n> Yes.\n> No.')!, { PIP: matchSpeaker(p, 'PIP') }, { at: { x: 0, y: 0 }, newId: () => Math.random().toString(16).slice(2, 10) + '-a', chooser: you }).nodeIds
    })
    expect(ids.slice(1).map((id) => flowOf(next).nodes[id].data.speakerId)).toEqual([you, you])
    expect(characterName('OLD TOM')).toBe('Old Tom')
  })
})

describe('ending numbers', () => {
  it('number the endings in reading order', () => {
    const p = coffee()
    const f = flowOf(p)
    const ends = endingNumbers(f)
    const text = (id: string) => String(f.nodes[id].data.text)
    expect([...ends.values()]).toEqual([1, 2, 3, 4])
    expect([...ends.keys()].every((id) => f.nodes[id].data.isEnd === true)).toBe(true)
    expect(Object.values(f.nodes).filter((n) => n.data.isEnd).length).toBe(ends.size)
    expect(text([...ends.keys()][0])).toMatch(/^You're a star|^Pockets empty|^Three whole|^Enjoy/)
  })
})
