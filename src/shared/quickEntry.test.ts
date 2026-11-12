import { readFileSync } from 'fs'
import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { orderedTargets } from './flowOrder'
import { parseProject } from './parse'
import { addChoiceBeside, cycleSpeaker, freeSpot, insertLineAfter, nextSpeaker, NEW_LINE_SIZE, speakerOrder } from './quickEntry'
import type { Flow, Project } from './schema'

function coffee(): Project {
  const r = parseProject(readFileSync('src/renderer/src/demos/coffee-order.skein.json', 'utf8'))
  if (!r.ok) throw new Error(r.error)
  return r.project
}
const flowOf = (p: Project) => Object.values(p.flows)[0]
const byText = (f: Flow, start: string) => Object.values(f.nodes).find((n) => String(n.data.text ?? '').startsWith(start))!
let counter = 0
const newId = () => `q${++counter}`.padEnd(8, '0') + '-0000'

const overlapsAny = (f: Flow, id: string) => {
  const a = f.nodes[id]
  return Object.values(f.nodes).some(
    (b) =>
      b.id !== id &&
      a.position.x < b.position.x + 260 &&
      b.position.x < a.position.x + 260 &&
      a.position.y < b.position.y + NEW_LINE_SIZE.height &&
      b.position.y < a.position.y + NEW_LINE_SIZE.height
  )
}

describe('speakers', () => {
  it('alternates with whoever spoke before, and falls back to the most heard other speaker', () => {
    const p = coffee()
    const f = flowOf(p)
    const pip = Object.values(p.entities).find((e) => e.technicalName === 'Pip')!.id
    const you = Object.values(p.entities).find((e) => e.technicalName !== 'Pip')!.id
    // A player choice, reached from Pip's line: next is Pip.
    const choice = Object.values(f.nodes).find((n) => n.data.speakerId === you)!
    expect(nextSpeaker(p, f, choice.id)).toBe(pip)
    // The opening line has no one before it: the other speaker in the flow.
    expect(nextSpeaker(p, f, byText(f, 'Morning!').id)).toBe(you)
  })

  it('steps through the speakers in picker order, wrapping through no speaker', () => {
    const p = coffee()
    const order = speakerOrder(p)
    expect(cycleSpeaker(p, undefined, 1)).toBe(order[0])
    expect(cycleSpeaker(p, order[order.length - 1], 1)).toBeUndefined()
    expect(cycleSpeaker(p, undefined, -1)).toBe(order[order.length - 1])
  })
})

describe('adding lines', () => {
  it('adds a connected line below a line that ends, in a free spot', () => {
    const p = coffee()
    const f = flowOf(p)
    const end = byText(f, 'Enjoy!')
    let id: string | null = null
    const next = produce(p, (d) => {
      id = insertLineAfter(d as Project, f.id, end.id, { speakerId: 'x', newId })
    })
    const nf = flowOf(next)
    expect(nf.nodes[id!].type).toBe('dialogue')
    expect(nf.nodes[id!].data.lineId).toMatch(/^[A-Z0-9_]+_[a-z0-9]{6}$/i)
    expect(orderedTargets(nf, end.id)).toEqual([id])
    expect(nf.nodes[id!].position.y).toBeGreaterThan(end.position.y)
    expect(overlapsAny(nf, id!)).toBe(false)
    // The end mark moves on to the new last line.
    expect(f.nodes[end.id].data.isEnd).toBe(true)
    expect(nf.nodes[end.id].data.isEnd).toBeUndefined()
    expect(nf.nodes[id!].data.isEnd).toBe(true)
  })

  it('goes in between when the line led straight on, moving what was below down', () => {
    const p = coffee()
    const f = flowOf(p)
    const first = byText(f, 'Morning!')
    const [after] = orderedTargets(f, first.id)
    let id: string | null = null
    const next = produce(p, (d) => {
      id = insertLineAfter(d as Project, f.id, first.id, { newId })
    })
    const nf = flowOf(next)
    expect(orderedTargets(nf, first.id)).toEqual([id])
    expect(orderedTargets(nf, id!)).toEqual([after])
    expect(nf.nodes[after].position.y).toBeGreaterThan(f.nodes[after].position.y)
    expect(overlapsAny(nf, id!)).toBe(false)
    expect(Object.keys(nf.edges)).toHaveLength(Object.keys(f.edges).length + 1)
  })

  it('adds a choice beside another, offered right after it', () => {
    const p = coffee()
    const f = flowOf(p)
    const menu = Object.values(f.nodes).find((n) => n.type === 'hub' || orderedTargets(f, n.id).length > 2)!
    const choices = orderedTargets(f, menu.id)
    let id: string | null = null
    const next = produce(p, (d) => {
      id = addChoiceBeside(d as Project, f.id, choices[0], { newId })
    })
    const nf = flowOf(next)
    expect(orderedTargets(nf, menu.id)).toEqual([choices[0], id, ...choices.slice(1)])
    expect(nf.nodes[id!].data.speakerId).toBe(f.nodes[choices[0]].data.speakerId)
    expect(overlapsAny(nf, id!)).toBe(false)
    // The very first line has no parent to branch from.
    expect(addChoiceBeside(next as Project, f.id, byText(f, 'Morning!').id, { newId })).toBeNull()
  })

  it('finds free space without overlapping anything', () => {
    const p = coffee()
    const f = flowOf(p)
    const n = Object.values(f.nodes)[0]
    const spot = freeSpot(f, n.position, NEW_LINE_SIZE, 'down')
    expect(spot.y).toBeGreaterThan(n.position.y)
  })
})
