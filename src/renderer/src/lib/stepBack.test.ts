import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { buildExport } from '@shared/export/build'
import { explore } from '@shared/play/explore'
import { createEmptyProject, createFlow, createStateVariable } from '@shared/factory'
import { parseProject } from '@shared/parse'
import type { Project } from '@shared/schema'
import { PlaySession } from './playSession'

/** Three lines, then a coin flip and a die: "Lucky." or "Unlucky." (which rolls 1–3). */
function dice(): Project {
  const p = createEmptyProject('Dice')
  p.state.time.speakingRate = 0
  p.flows = {}
  const die = { ...createStateVariable('v1', 'World', 'Die', 'Die', 'number', 0), defaultValue: 0 }
  p.state.variables[die.id] = die
  const f = createFlow('f1', 'Dice', null, 0)
  const node = (id: string, type: string, data: Record<string, unknown>) => (f.nodes[id] = { id, type, position: { x: 0, y: 0 }, data })
  const edge = (id: string, source: string, target: string, sourceHandle = 'out') => (f.edges[id] = { id, source, target, sourceHandle, targetHandle: 'in', order: 0 })
  node('a', 'dialogue', { isStart: true, startOrder: 0, text: 'One.' })
  node('b', 'dialogue', { text: 'Two.' })
  node('c', 'condition', { expression: 'chance(50)' })
  node('yes', 'dialogue', { text: 'Lucky.', effects: 'World.Die = roll(4, 6)', isEnd: true })
  node('no', 'dialogue', { text: 'Unlucky.', effects: 'World.Die = roll(1, 3)', isEnd: true })
  edge('e1', 'a', 'b')
  edge('e2', 'b', 'c')
  edge('e3', 'c', 'yes', 'true')
  edge('e4', 'c', 'no', 'false')
  p.flows[f.id] = f
  return p
}

const snapshot = (s: PlaySession) => JSON.stringify({ entries: s.entries, changes: [...s.world.changes], beat: s.beat.kind, node: s.beat.node?.id ?? null })

describe('Play: step back', () => {
  it('is the same as having taken one step fewer, dice included', () => {
    const { file } = buildExport(dice())
    const played = (steps: number) => {
      const s = new PlaySession(file, 'f1', { seed: 9 })
      for (let i = 0; i < steps; i++) s.choose(0)
      return s
    }
    const full = played(3)
    expect(full.ended).toBe(true)
    for (let n = 3; n > 0; n--) {
      const back = played(n).stepBack()!
      expect(snapshot(back)).toBe(snapshot(played(n - 1)))
    }
    expect(played(0).canStepBack).toBe(false)
    expect(played(0).stepBack()).toBeNull()
  })

  it('steps back through a replayed explore path, then plays on the same way', () => {
    const { file } = buildExport(dice())
    const r = explore(file, { flowId: 'f1' })
    const unlucky = r.endings.find((e) => e.text === 'Unlucky.')!
    const s = new PlaySession(file, 'f1', {}, unlucky.example.start, unlucky.example.picks)
    s.replay()
    const end = snapshot(s)
    const back = s.stepBack()!.stepBack()!
    expect(back.ended).toBe(false)
    while (!back.ended) back.choose(0)
    expect(snapshot(back)).toBe(end) // the recorded dice still decide the outcome
  })
})

describe('Play: skip to the next choice', () => {
  it('continues through single lines and stops at the menu', () => {
    const r = parseProject(readFileSync('src/renderer/src/demos/coffee-order.skein.json', 'utf8'))
    if (!r.ok) throw new Error(r.error)
    const { file } = buildExport(r.project)
    const flowId = Object.keys(file.flows)[0]
    const s = new PlaySession(file, flowId, {})
    const steps = s.skipToChoice()
    expect(steps).toBeGreaterThan(0)
    expect(s.beat.kind).toBe('choice')
    expect(s.skipToChoice()).toBe(0) // already at a choice
    // Each skipped line is its own step back.
    expect(s.stepBack()!.beat.kind).toBe('line')
  })
})
