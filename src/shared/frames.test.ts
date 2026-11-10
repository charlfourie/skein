import { describe, expect, it } from 'vitest'
import { buildExport } from './export/build'
import { createEmptyProject, createFlow } from './factory'
import { frameAround, framesOf, insideFrame, nodesInFrame } from './frames'
import { parseProject } from './parse'
import { serializeProject } from './serialize'

describe('frames', () => {
  const flow = () => {
    const f = createFlow('f', 'F', null, 0)
    f.nodes.a = { id: 'a', type: 'dialogue', position: { x: 0, y: 0 }, data: {} }
    f.nodes.b = { id: 'b', type: 'dialogue', position: { x: 400, y: 200 }, data: {} }
    f.nodes.c = { id: 'c', type: 'dialogue', position: { x: 2000, y: 0 }, data: {} }
    return f
  }

  it('fits around nodes with padding, and knows what is inside', () => {
    const f = flow()
    const rect = frameAround(f, ['a', 'b'])!
    expect(rect).toEqual({ position: { x: -32, y: -56 }, width: 724, height: 388 })
    const frame = { id: 'fr', label: 'Scene', ...rect }
    expect(nodesInFrame(f, frame)).toEqual(['a', 'b'])
    expect(insideFrame(frame, { x: 2000, y: 0 })).toBe(false)
  })

  it('orders larger frames first and survives a save, without reaching the export', () => {
    const p = createEmptyProject('Frames')
    const f = flow()
    f.frames = {
      small: { id: 'small', label: 'Small', position: { x: 0, y: 0 }, width: 100, height: 100 },
      big: { id: 'big', label: 'Big', position: { x: 0, y: 0 }, width: 900, height: 900, color: 'teal' }
    }
    p.flows = { f }
    expect(framesOf(f).map((x) => x.id)).toEqual(['big', 'small'])
    const back = parseProject(serializeProject(p))
    expect('project' in back && back.project.flows.f.frames?.big).toMatchObject({ label: 'Big', color: 'teal', width: 900 })
    expect(JSON.stringify(buildExport(p).file)).not.toContain('Big')
  })
})
