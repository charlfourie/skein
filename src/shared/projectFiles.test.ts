import { readFileSync } from 'fs'
import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { parseProject } from './parse'
import { flowFileName, isFolderProjectPath, parseProjectFiles, planWrite, splitProject } from './projectFiles'
import { serializeProject } from './serialize'

const heist = () => {
  const r = parseProject(readFileSync('src/renderer/src/demos/museum-heist.skein.json', 'utf8'))
  if (!r.ok) throw new Error(r.error)
  return r.project
}

describe('project folders', () => {
  it('names flow files after the flow, plus the start of its id', () => {
    expect(flowFileName({ id: '3F9A2C71-aaaa', name: '1 · The Plan!' })).toBe('1-the-plan.3f9a2c.json')
    expect(flowFileName({ id: 'x', name: '???' })).toBe('flow.x.json')
    expect(isFolderProjectPath('/a/My Story.skein/project.json')).toBe(true)
    expect(isFolderProjectPath('C:\\a\\story.skein.json')).toBe(false)
  })

  it('splits into project.json plus one file per flow (tests go with their flow), and loads back identically', () => {
    const p = heist()
    const files = splitProject(p)
    expect(Object.keys(files).map((k) => k.replace(/\.[0-9a-f]{6}\.json$/, '.*.json')).sort()).toEqual([
      'flows/1-the-plan.*.json',
      'flows/2-the-heist.*.json',
      'flows/3-the-getaway.*.json',
      'project.json'
    ])
    expect(Object.keys(files).filter((k) => k.startsWith('flows/'))).toHaveLength(3)
    const head = JSON.parse(files['project.json'])
    expect(head.flows).toBeUndefined()
    expect(head.tests).toBeUndefined()
    const getaway = Object.entries(files).find(([k]) => k.includes('getaway'))![1]
    expect(Object.keys(JSON.parse(getaway).tests)).toHaveLength(2)

    const back = parseProjectFiles(files)
    if (!back.ok) throw new Error(back.error)
    expect(back.repairs).toEqual([])
    expect(serializeProject(back.project)).toBe(serializeProject(p))
    // Saving again writes nothing.
    expect(planWrite(splitProject(back.project), files)).toEqual({ write: {}, remove: [] })
  })

  it('renaming a flow writes one new file and removes the old one', () => {
    const p = heist()
    const before = splitProject(p)
    const q = produce(p, (d) => {
      Object.values(d.flows).find((f) => f.name === '3 · The Getaway')!.name = 'The Escape'
    })
    const plan = planWrite(splitProject(q), before)
    expect(Object.keys(plan.write).map((k) => k.replace(/\.[0-9a-f]{6}\.json$/, ''))).toEqual(['flows/the-escape'])
    expect(plan.remove.map((k) => k.replace(/\.[0-9a-f]{6}\.json$/, ''))).toEqual(['flows/3-the-getaway'])
  })

  it('names the file when a merge goes wrong, and keeps the first of two copies of a flow', () => {
    const files = splitProject(heist())
    const flowPath = Object.keys(files).find((k) => k.startsWith('flows/'))!
    const broken = { ...files, [flowPath]: files[flowPath].replace('\n', '\n<<<<<<< HEAD\n') }
    const r = parseProjectFiles(broken)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(new RegExp(`^${flowPath.replace(/\./g, '\\.')} contains unresolved merge-conflict markers \\(first one on line 2\\)`))
    const copied = parseProjectFiles({ ...files, 'flows/copy.json': files[flowPath] })
    if (!copied.ok) throw new Error(copied.error)
    expect(copied.repairs).toEqual([expect.stringMatching(/^flows\/copy\.json is a second copy/)])
    expect(parseProjectFiles({ ...files, 'flows/notes.json': '{"hello": 1}' })).toEqual({
      ok: false,
      error: "flows/notes.json isn't a Skein flow. Move it out of the flows folder, or fix it, then open the project again."
    })
  })
})
