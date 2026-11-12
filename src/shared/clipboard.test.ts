import { readFileSync } from 'fs'
import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { copySelection, pasteInto, readClipboard } from './clipboard'
import { createEmptyProject } from './factory'
import { parseProject } from './parse'
import type { Project } from './schema'
import { validateProject } from './validate'

const load = (name: string): Project => {
  const r = parseProject(readFileSync(`src/renderer/src/demos/${name}.skein.json`, 'utf8'))
  if (!r.ok) throw new Error(r.error)
  return r.project
}
let n = 0
const id = () => `new-${++n}`

describe('copy and paste', () => {
  it('round-trips through text and pastes new nodes, with their connections, into the same flow', () => {
    const p = load('coffee-order')
    const flow = Object.values(p.flows)[0]
    const menu = Object.values(flow.nodes).find((x) => x.data.label === 'The menu')!
    const first = Object.values(flow.nodes).find((x) => x.data.isStart)!
    const payload = readClipboard(JSON.stringify(copySelection(p, flow.id, [first.id, menu.id])))!
    expect(payload.nodes).toHaveLength(2)
    expect(payload.edges).toHaveLength(1)
    expect(readClipboard('PIP: hello')).toBeNull()

    let result = { nodeIds: [] as string[], notes: [] as string[] }
    const q = produce(p, (d) => {
      result = pasteInto(d as Project, flow.id, payload, { x: 1000, y: 2000 }, id)
    })
    const pasted = result.nodeIds.map((x) => q.flows[flow.id].nodes[x])
    expect(pasted).toHaveLength(2)
    expect(Math.min(...pasted.map((x) => x.position.x))).toBe(1000)
    expect(Math.min(...pasted.map((x) => x.position.y))).toBe(2000)
    expect(pasted.some((x) => x.data.isStart)).toBe(false)
    const lineIds = Object.values(q.flows[flow.id].nodes).map((x) => x.data.lineId).filter(Boolean)
    expect(new Set(lineIds).size).toBe(lineIds.length)
    expect(Object.values(q.flows[flow.id].edges).filter((e) => result.nodeIds.includes(e.source) && result.nodeIds.includes(e.target))).toHaveLength(1)
    expect(result.notes).toEqual([])
  })

  it('matches speakers by name in another project, and reports what it had to drop', () => {
    const src = load('museum-heist')
    const getaway = Object.values(src.flows).find((f) => f.name === '3 · The Getaway')!
    const payload = copySelection(src, getaway.id, Object.keys(getaway.nodes))!

    // A project with a "Rook" but no "Bruno", and no flows of those names.
    const dst = produce(createEmptyProject('Other'), (d) => {
      const t = { id: 't', name: 'Character', technicalName: 'Character', folderId: null, order: 0, description: '', color: '#fff', icon: 'user', properties: {} }
      d.templates.t = t
      d.entities.rook = { id: 'rook', name: 'Rook', technicalName: 'Rook', templateId: 't', folderId: null, order: 0, values: {} }
    })
    const target = Object.values(dst.flows)[0].id
    let result = { nodeIds: [] as string[], notes: [] as string[] }
    const out = produce(dst, (d) => {
      result = pasteInto(d as Project, target, payload, null, id)
    })
    const pasted = result.nodeIds.map((x) => out.flows[target].nodes[x])
    expect(pasted.filter((x) => x.data.speakerId === 'rook').length).toBeGreaterThan(0)
    expect(pasted.every((x) => x.data.speakerId === undefined || x.data.speakerId === 'rook')).toBe(true)
    expect(result.notes).toContain('The speaker “Bruno” isn\'t in this project, so those lines have no speaker.')
    // Expressions come across as written: in a project without those variables, validation says so.
    expect(result.nodeIds.some((x) => (validateProject(out).get(x) ?? []).some((i) => i.level === 'error'))).toBe(true)
  })

  it('never duplicates a tag', () => {
    const p = produce(load('coffee-order'), (d) => {
      const f = Object.values(d.flows)[0]
      Object.values(f.nodes)[0].data.tag = 'Hello'
    })
    const f = Object.values(p.flows)[0]
    const tagged = Object.values(f.nodes).find((x) => x.data.tag === 'Hello')!
    let result = { nodeIds: [] as string[], notes: [] as string[] }
    const q = produce(p, (d) => {
      result = pasteInto(d as Project, f.id, copySelection(p, f.id, [tagged.id])!, null, id)
    })
    expect(q.flows[f.id].nodes[result.nodeIds[0]].data.tag).toBeUndefined()
    expect(result.notes[0]).toMatch(/^Tag “Hello” is already used/)
  })
})
