import { describe, expect, it } from 'vitest'
import { createEmptyProject, createFlow, createFolder } from './factory'
import { parseProject } from './parse'
import { serializeCanonical, serializeProject, SerializationError } from './serialize'

describe('serializeCanonical', () => {
  it('sorts keys at every depth regardless of insertion order', () => {
    const a = serializeCanonical({ b: 1, a: { z: true, y: [3, { d: 1, c: 2 }] } })
    const b = serializeCanonical({ a: { y: [3, { c: 2, d: 1 }], z: true }, b: 1 })
    expect(a).toBe(b)
    expect(a).toBe(
      '{\n  "a": {\n    "y": [\n      3,\n      {\n        "c": 2,\n        "d": 1\n      }\n    ],\n    "z": true\n  },\n  "b": 1\n}\n'
    )
  })

  it('sorts integer-like keys lexicographically (JSON.stringify would hoist them)', () => {
    expect(serializeCanonical({ a: 3, '9': 2, '10': 1 })).toBe('{\n  "10": 1,\n  "9": 2,\n  "a": 3\n}\n')
  })

  it('matches JSON.stringify(…, null, 2) for already-sorted input', () => {
    const v = { a: [1, 'x', null, { b: false }], c: {}, d: [], e: 'quote " and \\ and \n' }
    expect(serializeCanonical(v)).toBe(JSON.stringify(v, null, 2) + '\n')
  })

  it('drops undefined members and normalises -0', () => {
    expect(serializeCanonical({ a: undefined, b: -0 })).toBe('{\n  "b": 0\n}\n')
  })

  it('rejects values that would not round-trip', () => {
    expect(() => serializeCanonical({ a: Number.NaN })).toThrow(SerializationError)
    expect(() => serializeCanonical({ a: Infinity })).toThrow(SerializationError)
    expect(() => serializeCanonical({ d: new Date() })).toThrow(SerializationError)
    expect(() => serializeCanonical({ m: new Map() })).toThrow(SerializationError)
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => serializeCanonical(cyclic)).toThrow(/Circular/)
  })

  it('allows the same object twice when it is not a cycle', () => {
    const shared = { x: 1 }
    expect(() => serializeCanonical({ a: shared, b: shared })).not.toThrow()
  })

  it('uses LF line endings and exactly one trailing newline', () => {
    const out = serializeProject(createEmptyProject('T'))
    expect(out.includes('\r')).toBe(false)
    expect(out.endsWith('}\n')).toBe(true)
    expect(out.endsWith('\n\n')).toBe(false)
  })
})

describe('parseProject', () => {
  it('round-trips byte-for-byte and is idempotent', () => {
    const project = createEmptyProject('Round Trip')
    const folderId = 'f-1'
    project.folders[folderId] = createFolder(folderId, 'Act I', 'flows', null, 0)
    project.flows['flow-2'] = createFlow('flow-2', 'Intro', folderId, 0)
    project.flows['flow-2'].nodes['n1'] = { id: 'n1', type: 'dialogue', position: { x: 10, y: 20 }, data: { text: 'Hi', lineId: 'INTRO_n1' } }
    project.flows['flow-2'].nodes['n2'] = { id: 'n2', type: 'dialogue', position: { x: 10, y: 120 }, data: { lineId: 'INTRO_n2' } }
    project.flows['flow-2'].edges['e1'] = { id: 'e1', source: 'n1', target: 'n2', sourceHandle: null, targetHandle: null }

    const first = serializeProject(project)
    const parsed = parseProject(first)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.repairs).toEqual([])
    expect(serializeProject(parsed.project)).toBe(first)
  })

  it('produces identical output whatever order items were added in', () => {
    const base = createEmptyProject('Order')
    const a = structuredClone(base)
    const b = structuredClone(base)
    a.folders['x'] = createFolder('x', 'X', 'flows', null, 0)
    a.folders['y'] = createFolder('y', 'Y', 'flows', null, 1)
    b.folders['y'] = createFolder('y', 'Y', 'flows', null, 1)
    b.folders['x'] = createFolder('x', 'X', 'flows', null, 0)
    expect(serializeProject(a)).toBe(serializeProject(b))
  })

  it('preserves unknown fields written by newer builds', () => {
    const project = createEmptyProject('Future') as Record<string, unknown>
    project.futureSection = { keep: 'me' }
    const parsed = parseProject(serializeCanonical(project))
    expect(parsed.ok && (parsed.project as Record<string, unknown>).futureSection).toEqual({ keep: 'me' })
  })

  it('reports git conflict markers with a line number', () => {
    const text = serializeProject(createEmptyProject('Conflict')).replace(
      '  "entities": {},\n',
      '<<<<<<< HEAD\n  "entities": {},\n=======\n  "entities": {"a": 1},\n>>>>>>> theirs\n'
    )
    const result = parseProject(text)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/merge-conflict markers .*line \d+/)
  })

  it('reports JSON syntax errors with a location', () => {
    const result = parseProject('{\n  "format": "skein.project",\n  "schemaVersion": 1,\n}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/not valid JSON.*line/)
  })

  it('tolerates a UTF-8 byte-order mark', () => {
    const result = parseProject('﻿' + serializeProject(createEmptyProject('BOM')))
    expect(result.ok).toBe(true)
  })

  it('rejects non-Skein JSON and files from a newer schema', () => {
    expect(parseProject('{"hello": "world"}').ok).toBe(false)
    const future = parseProject(JSON.stringify({ ...createEmptyProject('F'), schemaVersion: 99 }))
    expect(future.ok).toBe(false)
    if (!future.ok) expect(future.error).toMatch(/newer version/)
  })

  it('reports structural errors with the offending path', () => {
    const p = createEmptyProject('Bad') as unknown as { meta: Record<string, unknown> }
    p.meta.name = 42
    const result = parseProject(JSON.stringify(p))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/meta\.name/)
  })

  it('repairs integrity problems a manual merge can introduce', () => {
    const p = createEmptyProject('Repair')
    p.folders['a'] = createFolder('a', 'A', 'flows', 'b', 0)
    p.folders['b'] = createFolder('b', 'B', 'flows', 'a', 0) // cycle a ↔ b
    p.folders['c'] = createFolder('c', 'C', 'flows', 'missing', 0) // dangling parent
    p.folders['d'] = createFolder('WRONG', 'D', 'flows', null, 0) // key/id mismatch
    const flow = createFlow('fl', 'F', 'nope', 0) // dangling folder
    flow.nodes['n1'] = { id: 'n1', type: 'dialogue', position: { x: 0, y: 0 }, data: {} }
    flow.edges['e1'] = { id: 'e1', source: 'n1', target: 'ghost', sourceHandle: null, targetHandle: null }
    p.flows['fl'] = flow

    const result = parseProject(serializeProject(p))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const fixed = result.project
    expect(fixed.folders['d'].id).toBe('d')
    expect(fixed.folders['c'].parentId).toBeNull()
    expect([fixed.folders['a'].parentId, fixed.folders['b'].parentId]).toContain(null)
    expect(fixed.flows['fl'].folderId).toBeNull()
    expect(fixed.flows['fl'].edges).toEqual({})
    expect(result.repairs.length).toBeGreaterThanOrEqual(5)

    // Once repaired and saved, the file loads cleanly.
    const again = parseProject(serializeProject(fixed))
    expect(again.ok && again.repairs).toEqual([])
  })
})
