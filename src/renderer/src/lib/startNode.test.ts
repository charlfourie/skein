import { describe, expect, it } from 'vitest'
import { PlaySession } from './playSession'
import { buildExport } from '@shared/export/build'
import { createEmptyProject, createFlow } from '@shared/factory'
import type { Project } from '@shared/schema'

/** A flow with two start nodes: "Morning." (priority 1) and "Evening." (priority 2). */
function project(): Project {
  const p = createEmptyProject('Two starts')
  p.state.time.speakingRate = 0
  p.flows = {}
  const f = createFlow('f1', 'Day', null, 0)
  const node = (id: string, data: Record<string, unknown>) => (f.nodes[id] = { id, type: 'dialogue', position: { x: 0, y: 0 }, data })
  node('m', { isStart: true, startOrder: 0, text: 'Morning.', isEnd: true })
  node('e', { isStart: true, startOrder: 1, text: 'Evening.', isEnd: true })
  p.flows[f.id] = f
  return p
}

const lineOf = (s: PlaySession) => (s.beat.kind === 'line' ? s.beat.text : null)

describe('Play: choosing a start node', () => {
  it('begins at the first available start by default, as the game does', () => {
    const { file } = buildExport(project())
    const s = new PlaySession(file, 'f1', {})
    expect(lineOf(s)).toBe('Morning.')
    expect(s.startNodeId).toBeNull()
  })

  it('begins at a chosen start node', () => {
    const { file } = buildExport(project())
    const s = new PlaySession(file, 'f1', {}, {}, undefined, undefined, 'e')
    expect(lineOf(s)).toBe('Evening.')
    expect(s.startNodeId).toBe('e')
  })
})
