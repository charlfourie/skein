import { describe, expect, it } from 'vitest'
import { createEmptyProject, createEntity, createFlow, createTemplate } from './factory'
import { analyzeFlow } from './flowAnalysis'
import { deleteEntities, deleteFlowElements, findSpeakerLines } from './mutations'
import { canConnect } from './nodes'
import { parseProject } from './parse'
import { SCHEMA_VERSION, type Flow, type FlowNode } from './schema'
import { serializeCanonical, serializeProject } from './serialize'
import { validateProject } from './validate'

function node(id: string, type: string, y: number, data: Record<string, unknown> = {}, x = 0): FlowNode {
  return { id, type, position: { x, y }, data }
}
function edge(flow: Flow, id: string, source: string, target: string, sourceHandle = 'out') {
  flow.edges[id] = { id, source, target, sourceHandle, targetHandle: 'in' }
}

/** start → ask → cond ─true→ yes(end) ; cond ─false→ hub → (back to ask = loop) */
function sampleFlow(): Flow {
  const f = createFlow('f', 'Sample', null, 0)
  f.nodes = {
    start: node('start', 'dialogue', 0, { isStart: true, text: 'Hello' }),
    ask: node('ask', 'dialogue', 100, { text: 'Help me?' }),
    cond: node('cond', 'condition', 200, { expression: 'Rep > 2' }),
    yes: node('yes', 'dialogue', 300, { isEnd: true }, -200),
    hub: node('hub', 'hub', 300, {}, 200)
  }
  edge(f, 'e1', 'start', 'ask')
  edge(f, 'e2', 'ask', 'cond')
  edge(f, 'e3', 'cond', 'yes', 'true')
  edge(f, 'e4', 'cond', 'hub', 'false')
  edge(f, 'e5', 'hub', 'ask')
  return f
}

describe('flow analysis', () => {
  it('finds no orphans or dead ends in a well-formed flow, and the loop-back edge', () => {
    const a = analyzeFlow(sampleFlow())
    expect([...a.orphans]).toEqual([])
    expect([...a.deadEnds]).toEqual([])
    expect([...a.loopEdges]).toEqual(['e5'])
    expect(a.startNodes).toEqual(['start'])
  })

  it('marks the same edge as the loop regardless of edge insertion order', () => {
    const f = sampleFlow()
    const reordered = { ...f, edges: Object.fromEntries(Object.entries(f.edges).reverse()) }
    expect([...analyzeFlow(reordered).loopEdges]).toEqual(['e5'])
  })

  it('flags orphans and dead ends unless marked start / end', () => {
    const f = sampleFlow()
    f.nodes['lonely'] = node('lonely', 'dialogue', 500)
    delete f.nodes['yes'].data.isEnd
    const a = analyzeFlow(f)
    expect(a.orphans.has('lonely')).toBe(true)
    expect(a.deadEnds.has('lonely')).toBe(true)
    expect(a.deadEnds.has('yes')).toBe(true)
    expect(a.orphans.has('start')).toBe(false) // it's a start
  })

  it('treats a jump as a connection, including loops through it', () => {
    const f = sampleFlow()
    delete f.edges['e5']
    f.nodes['j'] = node('j', 'jump', 400, { targetId: 'ask' }, 200)
    edge(f, 'e6', 'hub', 'j')
    const a = analyzeFlow(f)
    expect(a.deadEnds.has('j')).toBe(false)
    expect(a.loopJumps.has('j')).toBe(true)
    f.nodes['j'].data = {}
    const b = analyzeFlow({ ...f })
    expect(b.brokenJumps.has('j')).toBe(true)
  })

  it('reports a condition with only one branch connected', () => {
    const f = sampleFlow()
    delete f.edges['e4']
    const issues = validateProject({ ...createEmptyProject('P'), flows: { f } })
    expect(issues.get('cond')?.some((i) => /false/.test(i.message))).toBe(true)
  })
})

describe('connection rules', () => {
  it('allows output → input between different nodes', () => {
    expect(canConnect(sampleFlow(), { source: 'yes', sourceHandle: 'out', target: 'hub', targetHandle: 'in' }).ok).toBe(true)
  })
  it('rejects self, duplicates, wrong handles, and outputs from jumps', () => {
    const f = sampleFlow()
    f.nodes['j'] = node('j', 'jump', 400)
    expect(canConnect(f, { source: 'ask', target: 'ask' }).ok).toBe(false)
    expect(canConnect(f, { source: 'start', sourceHandle: 'out', target: 'ask' }).ok).toBe(false)
    expect(canConnect(f, { source: 'cond', sourceHandle: 'out', target: 'start' }).ok).toBe(false)
    expect(canConnect(f, { source: 'ask', sourceHandle: 'out', target: 'start', targetHandle: 'out' }).ok).toBe(false)
    expect(canConnect(f, { source: 'j', sourceHandle: 'out', target: 'start' }).ok).toBe(false)
  })
})

describe('file format v3', () => {
  it('migrates v2 flows: names edge handles and moves condition text to expression', () => {
    const p = createEmptyProject('Old')
    const f = createFlow('f', 'F', null, 0)
    f.nodes = {
      c: node('c', 'condition', 0, { text: 'Rep >= 2' }),
      l: node('l', 'dialogue', 100, {}, -100),
      r: node('r', 'dialogue', 100, {}, 100)
    }
    f.edges = {
      a: { id: 'a', source: 'c', target: 'r', sourceHandle: null, targetHandle: null },
      b: { id: 'b', source: 'c', target: 'l', sourceHandle: null, targetHandle: null },
      d: { id: 'd', source: 'l', target: 'r', sourceHandle: null, targetHandle: null }
    }
    p.flows = { f }
    const raw = JSON.parse(serializeProject(p)) as Record<string, unknown>
    raw.schemaVersion = 2
    const result = parseProject(serializeCanonical(raw))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const flow = result.project.flows['f']
    expect(result.project.schemaVersion).toBe(SCHEMA_VERSION)
    expect(flow.nodes['c'].data).toEqual({ expression: 'Rep >= 2' })
    expect(flow.edges['b'].sourceHandle).toBe('true') // leftmost target
    expect(flow.edges['a'].sourceHandle).toBe('false')
    expect(flow.edges['d'].sourceHandle).toBe('out')
    expect(flow.edges['d'].targetHandle).toBe('in')
  })

  it('repairs speakers and jump targets that no longer exist', () => {
    const p = createEmptyProject('P')
    const f = sampleFlow()
    f.nodes['ask'].data.speakerId = 'ghost'
    f.nodes['j'] = node('j', 'jump', 400, { targetId: 'nowhere' })
    p.flows = { f }
    const result = parseProject(serializeProject(p))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.flows['f'].nodes['ask'].data.speakerId).toBeUndefined()
    expect(result.project.flows['f'].nodes['j'].data.targetId).toBeUndefined()
    expect(result.repairs).toHaveLength(2)
  })
})

describe('flow mutations', () => {
  it('deleting nodes removes their edges and clears jumps to them', () => {
    const f = sampleFlow()
    f.nodes['j'] = node('j', 'jump', 400, { targetId: 'hub' })
    deleteFlowElements(f, ['hub'])
    expect(Object.keys(f.edges).sort()).toEqual(['e1', 'e2', 'e3'])
    expect(f.nodes['j'].data.targetId).toBeUndefined()
  })

  it('deleting a speaker entity clears it from dialogue lines', () => {
    const p = createEmptyProject('P')
    p.templates['t'] = createTemplate('t', 'Character', 'Character', null, 0)
    p.entities['k'] = createEntity('k', 'Keeper', 'Keeper', 't', null, 0)
    const f = sampleFlow()
    f.nodes['ask'].data.speakerId = 'k'
    p.flows = { f }
    expect(findSpeakerLines(p, 'k')).toEqual([{ flowId: 'f', nodeId: 'ask' }])
    deleteEntities(p, ['k'])
    expect(f.nodes['ask'].data.speakerId).toBeUndefined()
  })
})
