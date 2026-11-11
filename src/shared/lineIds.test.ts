import { describe, expect, it } from 'vitest'
import { createEmptyProject } from './factory'
import { assignLineIds, cleanLinePrefix, defaultLinePrefix, newLineId, reprefixLines } from './lineIds'
import { parseProject } from './parse'
import { serializeProject } from './serialize'

describe('line IDs', () => {
  it('makes a prefix from the flow name', () => {
    expect(defaultLinePrefix('The Order')).toBe('ORDER')
    expect(defaultLinePrefix('1 · The Plan')).toBe('F1_PLAN')
    expect(defaultLinePrefix('Café scene')).toBe('CAFE_SCENE')
    expect(defaultLinePrefix('!!!')).toBe('LINE')
    expect(cleanLinePrefix(' intro-2 ')).toBe('INTRO_2')
  })

  it('takes the start of the node id, and more of it when that is taken', () => {
    expect(newLineId('ORDER', '3f9a2c71-aaaa', new Set())).toBe('ORDER_3f9a2c')
    expect(newLineId('ORDER', '3f9a2c71-aaaa', new Set(['ORDER_3f9a2c']))).toBe('ORDER_3f9a2c7')
  })

  it('gives every line an ID on load, keeps existing ones, and fixes duplicates', () => {
    const p = createEmptyProject('P')
    const flow = Object.values(p.flows)[0]
    flow.nodes.aaaaaa11 = { id: 'aaaaaa11', type: 'dialogue', position: { x: 0, y: 0 }, data: { lineId: 'KEEP_ME' } }
    flow.nodes.bbbbbb22 = { id: 'bbbbbb22', type: 'dialogue', position: { x: 0, y: 0 }, data: { lineId: 'KEEP_ME' } }
    flow.nodes.cccccc33 = { id: 'cccccc33', type: 'dialogue', position: { x: 0, y: 0 }, data: {} }
    flow.nodes.dddddd44 = { id: 'dddddd44', type: 'hub', position: { x: 0, y: 0 }, data: {} }
    const r = parseProject(serializeProject(p))
    if (!r.ok) throw new Error(r.error)
    const n = Object.values(r.project.flows)[0].nodes
    expect(n.aaaaaa11.data.lineId).toBe('KEEP_ME')
    expect(n.bbbbbb22.data.lineId).toBe('MAIN_bbbbbb')
    expect(n.cccccc33.data.lineId).toBe('MAIN_cccccc')
    expect(n.dddddd44.data.lineId).toBeUndefined()
    expect(r.repairs).toEqual(['Flow "Main": two lines shared the line ID KEEP_ME; one got a new ID.'])
    // Loading again changes nothing.
    const again = parseProject(serializeProject(r.project))
    if (!again.ok) throw new Error(again.error)
    expect(again.repairs).toEqual([])
    expect(serializeProject(again.project)).toBe(serializeProject(r.project))
  })

  it('renames a flow\'s lines to a new prefix only when asked', () => {
    const p = createEmptyProject('P')
    const flow = Object.values(p.flows)[0]
    flow.nodes.abcdef12 = { id: 'abcdef12', type: 'dialogue', position: { x: 0, y: 0 }, data: {} }
    assignLineIds(p)
    flow.linePrefix = 'INTRO'
    expect(flow.nodes.abcdef12.data.lineId).toBe('MAIN_abcdef')
    expect(reprefixLines(p, flow)).toBe(1)
    expect(flow.nodes.abcdef12.data.lineId).toBe('INTRO_abcdef')
    expect(reprefixLines(p, flow)).toBe(0)
  })
})
