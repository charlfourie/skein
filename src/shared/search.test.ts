import { readFileSync } from 'fs'
import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { parseProject } from './parse'
import type { Project } from './schema'
import { applyReplace, planReplace, readTarget, searchPattern, searchProject, type SearchOptions } from './search'

function coffee(): Project {
  const r = parseProject(readFileSync('src/renderer/src/demos/coffee-order.skein.json', 'utf8'))
  if (!r.ok) throw new Error(r.error)
  return r.project
}
const flowOf = (p: Project) => Object.values(p.flows)[0]
const nodeBy = (p: Project, start: string) => Object.values(flowOf(p).nodes).find((n) => String(n.data.text ?? n.data.menuText ?? '').startsWith(start))!

describe('search', () => {
  it('finds lines, choice text, conditions, notes, comments and names, case-insensitively by default', () => {
    // The demo ships without comments: add a thread to search through.
    const p = produce(coffee(), (d) => {
      const f = flowOf(d as Project)
      const node = Object.keys(f.nodes)[0]
      f.comments = {
        c1: { id: 'c1', nodeId: node, author: 'Sam', text: 'Price check?', createdAt: '2026-01-01T00:00:00.000Z' },
        c2: { id: 'c2', nodeId: node, parentId: 'c1', author: 'Alex', text: 'A coin each.', createdAt: '2026-01-01T00:00:00.000Z' }
      }
    })
    const r = searchProject(p, { query: 'coin' })
    const labels = new Set(r.matches.map((m) => m.fieldLabel))
    for (const l of ['Line', 'Choice text', 'Condition', 'Effects', 'Note', 'Reply', 'Variable']) expect(labels, l).toContain(l)
    expect(r.truncated).toBe(false)
    const m = r.matches.find((x) => x.fieldLabel === 'Choice text')!
    expect(m.value.slice(m.start, m.end).toLowerCase()).toBe('coin')
  })

  it('honours match case, whole word, regular expressions and categories', () => {
    const p = coffee()
    const count = (o: Partial<SearchOptions>) => searchProject(p, { query: 'coin', ...o }).matches.length
    expect(count({ matchCase: true })).toBeLessThan(count({}))
    expect(count({ wholeWord: true })).toBeLessThan(count({}))
    expect(searchProject(p, { query: 'Coins\\s*>=\\s*\\d', regex: true }).matches.length).toBeGreaterThan(0)
    expect(searchProject(p, { query: 'coin', categories: ['logic'] }).matches.every((m) => m.category === 'logic')).toBe(true)
    expect(searchProject(p, { query: '(', regex: true }).error).toMatch(/^Not a valid regular expression/)
    expect(searchPattern({ query: 'a*', regex: true })).toEqual({ error: 'This pattern matches empty text. Make it match at least one character.' })
  })

  it('filters by speaker', () => {
    const p = coffee()
    const pip = Object.values(p.entities).find((e) => e.technicalName === 'Pip')!
    const r = searchProject(p, { query: 'e', speakerId: pip.id, categories: ['text'] })
    expect(r.matches.length).toBeGreaterThan(0)
    for (const m of r.matches) {
      if (m.target.kind !== 'node') throw new Error('expected a node')
      expect(flowOf(p).nodes[m.target.nodeId].data.speakerId).toBe(pip.id)
    }
  })
})

describe('replace', () => {
  it('replaces one match or all of them, leaving names alone', () => {
    const p = produce(coffee(), (d) => {
      nodeBy(d as Project, 'Morning!').data.text = 'Morning! Morning!'
    })
    const opts = { query: 'morning', wholeWord: true }
    const all = searchProject(p, opts).matches.filter((m) => m.fieldLabel === 'Line')
    expect(all).toHaveLength(2)
    const second = planReplace(p, [all[1]], opts, 'Evening')
    expect(second.map((c) => c.after)).toEqual(['Morning! Evening!'])
    const next = produce(p, (d) => void applyReplace(d as Project, planReplace(p, all, opts, 'Evening')))
    expect(nodeBy(next, 'Evening').data.text).toBe('Evening! Evening!')
    const names = searchProject(p, { query: 'Pip' }).matches.filter((m) => m.category === 'names')
    expect(names.length).toBeGreaterThan(0)
    expect(planReplace(p, names, { query: 'Pip' }, 'Bob')).toEqual([])
  })

  it('supports groups with regular expressions, and literal $ otherwise', () => {
    const p = coffee()
    const regex = { query: '\\((\\d) coins?\\)', regex: true }
    const plan = planReplace(p, searchProject(p, regex).matches, regex, '[$1c]')
    expect(plan.find((c) => c.before.startsWith('A flat white'))?.after).toBe('A flat white [4c]')
    const literal = { query: 'flat white' }
    expect(planReplace(p, searchProject(p, literal).matches, literal, '$1 latte')[0].after).toContain('$1 latte')
  })

  it('refuses a replacement that would break a condition or action, and keeps the rest', () => {
    const p = coffee()
    const opts = { query: 'Player.Coins', categories: ['logic' as const] }
    const plan = planReplace(p, searchProject(p, opts).matches, opts, 'Player.Money')
    expect(plan.length).toBeGreaterThan(0)
    expect(plan.every((c) => c.refused?.includes('would stop working:'))).toBe(true)
    // Swapping one valid number for another is fine.
    const ok = { query: '>= 4', categories: ['logic' as const] }
    const plan2 = planReplace(p, searchProject(p, ok).matches, ok, '>= 5')
    expect(plan2.some((c) => !c.refused)).toBe(true)
    const next = produce(p, (d) => void applyReplace(d as Project, [...plan, ...plan2]))
    expect(Object.values(flowOf(next).nodes).filter((n) => n.data.expression === 'Player.Coins >= 5')).toHaveLength(1) // the flat white's price check
    expect(searchProject(next, { query: 'Player.Money' }).matches).toEqual([])
  })

  it('never overwrites text that changed after the plan was made', () => {
    const p = coffee()
    const opts = { query: 'Morning' }
    const plan = planReplace(p, searchProject(p, opts).matches, opts, 'Evening')
    const edited = produce(p, (d) => {
      nodeBy(d as Project, 'Morning!').data.text = 'Morning, edited meanwhile.'
    })
    const next = produce(edited, (d) => void applyReplace(d as Project, plan))
    const node = nodeBy(next, 'Morning')
    expect(readTarget(next, { kind: 'node', flowId: flowOf(next).id, nodeId: node.id, field: 'text' })).toBe('Morning, edited meanwhile.')
  })
})
