import { describe, expect, it } from 'vitest'
import { buildExport } from './export/build'
import { SkeinStory, SkeinWorld, type Beat } from './export/runtime'
import { applyRename } from './expr/sites'
import { createEmptyProject, createFlow, createStateVariable } from './factory'
import { assignChoiceLineIds } from './lineIds'
import { parseRaw } from './parse'
import { searchProject } from './search'
import type { Project } from './schema'
import { serializeProject } from './serialize'
import { validateProject } from './validate'

/**
 * Two hubs lead to the same joke line. In format 7 its choice text lived on the line,
 * so both hubs had to offer it as "Tell a joke".
 */
function v7(): Record<string, unknown> {
  const p = createEmptyProject('Jokes')
  p.flows = {}
  const f = createFlow('f1', 'Bar', null, 0)
  const node = (id: string, type: string, data: Record<string, unknown>) => (f.nodes[id] = { id, type, position: { x: 0, y: 0 }, data })
  node('h1', 'hub', { label: 'Bar', isStart: true, startOrder: 0 })
  node('h2', 'hub', { label: 'Later' })
  node('j', 'dialogue', { text: 'Haha! Good joke!', menuText: 'Tell a joke', lineId: 'BAR_joke01', isEnd: true })
  node('quiet', 'dialogue', { text: 'Never mind.', menuText: 'Unused choice text', lineId: 'BAR_quiet1', isEnd: true })
  f.edges.a = { id: 'a', source: 'h1', target: 'j', sourceHandle: 'out', targetHandle: 'in', order: 0 }
  f.edges.b = { id: 'b', source: 'h2', target: 'j', sourceHandle: 'out', targetHandle: 'in', order: 0 }
  p.flows.f1 = f
  return { ...JSON.parse(serializeProject(p)), schemaVersion: 7 }
}

function load(raw: Record<string, unknown>): Project {
  const r = parseRaw(raw)
  if (!r.ok) throw new Error(r.error)
  return r.project
}

describe('choices belong to connections (format 8)', () => {
  it('moves a line’s choice text onto every choice into it, keeping its line ID for the first', () => {
    const p = load(v7())
    const f = p.flows.f1
    expect(f.edges.a.choiceText).toBe('Tell a joke')
    expect(f.edges.b.choiceText).toBe('Tell a joke')
    expect(f.nodes.j.data.menuText).toBeUndefined()
    expect(f.edges.a.choiceLineId).toBe('BAR_joke01_M') // the ID recorded voice lines already use
    expect(f.edges.b.choiceLineId).toBe('BAR_joke01_M2')
    // A line no choice leads into keeps its text, for when it's connected later.
    expect(f.nodes.quiet.data.menuText).toBe('Unused choice text')
  })

  it('gives a choice its line ID when it gains text, and drops it when the text goes', () => {
    const p = load(v7())
    delete p.flows.f1.edges.b.choiceText
    assignChoiceLineIds(p)
    expect(p.flows.f1.edges.b.choiceLineId).toBeUndefined()
    p.flows.f1.edges.b.choiceText = 'Another joke'
    assignChoiceLineIds(p)
    expect(p.flows.f1.edges.b.choiceLineId).toBe('BAR_joke01_M2')
  })

  it('plays each choice with its own text, requirement and "only once"', () => {
    const p = load(v7())
    p.flows.f1.edges.b.choiceText = 'Tell it again'
    const f = p.flows.f1
    f.nodes.leave = { id: 'leave', type: 'dialogue', position: { x: 0, y: 0 }, data: { text: 'Bye.', isEnd: true } }
    f.edges.c = { id: 'c', source: 'h1', target: 'leave', sourceHandle: 'out', targetHandle: 'in', order: 1, choiceText: 'Leave' }
    f.edges.a.once = true
    // The joke loops back to the bar while the choice that told it is used up.
    f.nodes.j.data.isEnd = false
    f.edges.back = { id: 'back', source: 'j', target: 'h1', sourceHandle: 'out', targetHandle: 'in', order: 0 }
    const { file, problems } = buildExport(p)
    expect(problems).toEqual([])
    expect(file.flows.f1.nodes.h1).toMatchObject({
      choices: [
        { id: 'a', text: 'Tell a joke', line: 'BAR_joke01_M', count: true, requires: { source: 'only once' } },
        { id: 'c', text: 'Leave' }
      ]
    })
    const story = new SkeinStory(new SkeinWorld(file), 'f1')
    const texts = (b: Beat) => (b.kind === 'end' ? [] : b.choices.map((c) => c.text))
    const first = story.start()
    expect(texts(first)).toEqual(['Tell a joke', 'Leave'])
    story.choose(0) // the joke
    const back = story.choose(0) // back at the bar: the joke is used up, and the hub keeps asking
    expect(back.kind).toBe('choice')
    expect(texts(back)).toEqual(['Leave'])
    // The line itself isn't "only once": the other hub can still lead to it.
    expect(file.flows.f1.nodes.j.requires).toBeUndefined()
  })

  it('checks, renames and searches a choice’s requirement and text', () => {
    const p = load(v7())
    const v = createStateVariable('v1', 'Bar', 'Mood', 'Mood', 'number', 0)
    p.state.variables[v.id] = v
    p.flows.f1.edges.a.requires = 'Bar.Mood >= 2'
    p.flows.f1.edges.b.choiceText = 'Mood {Bar.Mood}'
    expect([...validateProject(p).values()].flat().filter((i) => i.level === 'error')).toEqual([])
    p.flows.f1.edges.b.requires = 'Bar.Nope > 1'
    expect(validateProject(structuredClone(p)).get('h2')?.some((i) => /Choice requires/.test(i.message))).toBe(true)
    delete p.flows.f1.edges.b.requires

    applyRename(p, { kind: 'variable', fromNamespace: 'Bar', fromName: 'Mood', toNamespace: 'Bar', toName: 'Spirits' })
    expect(p.flows.f1.edges.a.requires).toBe('Bar.Spirits >= 2')
    expect(p.flows.f1.edges.b.choiceText).toBe('Mood {Bar.Spirits}')

    const found = searchProject(p, { query: 'tell a joke' }).matches
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ fieldLabel: 'Choice text', target: { kind: 'choice', nodeId: 'h1', edgeId: 'a' } })
  })
})
