import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { forEachSite } from './expr/sites'
import { compile } from './expr/check'
import { evaluate, execute, initialState, read as editorRead, type RunContext } from './expr/runtime'
import { buildExport, serializeExport } from './export/build'
import { SkeinStory, SkeinWorld } from './export/runtime'
import type { ExportFile } from './export/types'
import { parseProject } from './parse'
import type { Project } from './schema'

function sample(): Project {
  const r = parseProject(readFileSync('examples/lighthouse-v2.skein.json', 'utf8'))
  if (!r.ok) throw new Error(r.error)
  return r.project
}
const flowId = (file: ExportFile, name: string) => Object.values(file.flows).find((f) => f.name === name)!.id

describe('export format', () => {
  it('contains no editor-only data', () => {
    const text = serializeExport(buildExport(sample()).file)
    for (const editorOnly of ['"position"', '"note"', '"folderId"', '"icon"', '"order"', '"description"', '"sourceHandle"', '"createdAt"']) {
      expect(text).not.toContain(editorOnly)
    }
    const { file } = buildExport(sample())
    expect(Object.keys(file.templates.Character).sort()).toEqual(['id', 'name', 'properties']) // no colour or icon
  })

  it('is deterministic, and compact output is the same data', () => {
    const p = sample()
    const a = serializeExport(buildExport(p).file)
    const b = serializeExport(buildExport(structuredClone(p)).file)
    expect(a).toBe(b)
    const compact = serializeExport(buildExport(p).file, true)
    expect(compact.length).toBeLessThan(a.length * 0.7)
    expect(JSON.parse(compact)).toEqual(JSON.parse(a))
  })

  it('refers to everything by technical name and resolves defaults', () => {
    const { file, problems } = buildExport(sample())
    expect(problems).toEqual([])
    expect(file.entities.Keeper).toMatchObject({ template: 'Character', values: { Mood: 'Calm', Energy: 5, MemberOf: 'LighthouseWatch', Age: 61 } })
    expect(file.entities.Stranger.values.Energy).toBe(5) // default applied
    expect(file.templates.Character.properties.Mood).toMatchObject({ type: 'enum', state: true, options: ['Calm', 'Wary', 'Warm'] })
    expect(file.state.relationships['Character->Character.Trust'].values).toEqual({ Keeper: { Stranger: -1 } })
    expect(file.state.time).toEqual({ phases: ['Dawn', 'Day', 'Dusk', 'Night'], labels: ['Dawn', 'Day', 'Dusk', 'Night'], start: { day: 1, phase: 'Dawn' } })
    expect(file.state.rules[0]).toMatchObject({ trigger: 'phase', phase: 'Night', forEach: 'Character' })
  })

  it('can leave out expression sources', () => {
    const text = serializeExport(buildExport(sample(), { includeSource: false }).file)
    expect(text).not.toContain('"source"')
  })

  it('reports broken expressions and exports them safely', () => {
    const p = sample()
    const flow = Object.values(p.flows).find((f) => f.name === 'Arrival')!
    const cond = Object.values(flow.nodes).find((n) => n.type === 'condition')!
    cond.data.expression = 'Keeper.Mod == Wary'
    const { file, problems } = buildExport(p)
    expect(problems[0]).toMatchObject({ level: 'error', at: { kind: 'node', nodeId: cond.id } })
    const node = file.flows[flow.id].nodes[cond.id]
    expect(node.type === 'condition' && node.condition?.expr).toEqual({ lit: false })
  })
})

describe('reference runtime', () => {
  it('plays the Arrival flow: lines, branch, effects, loop back through a hub and jump', () => {
    const { file } = buildExport(sample())
    const world = new SkeinWorld(file)
    const story = new SkeinStory(world, flowId(file, 'Arrival'))
    let beat = story.start()
    expect(beat).toMatchObject({ kind: 'line', speaker: 'Keeper', text: 'Another ship lost to the fog…' })
    beat = story.choose(0)
    expect(beat).toMatchObject({ kind: 'line', speaker: 'Stranger' })
    // Trust starts at -1 and reputation at 1, so the condition fails → refused.
    beat = story.choose(0)
    expect(beat).toMatchObject({ kind: 'line', text: 'The mainland is that way.' })
    expect(world.read({ get: 'prop', entity: 'Keeper', prop: 'Mood' })).toBe('Wary')
    expect(world.read({ get: 'var', var: 'Player.Reputation' })).toBe(0)
    // Hub (one path) → jump → back to the Stranger's request.
    beat = story.choose(0)
    expect(beat).toMatchObject({ kind: 'line', speaker: 'Stranger', text: 'I need shelter for the night.' })
  })

  it('takes the other branch when state allows, and ends on an end node', () => {
    const { file } = buildExport(sample())
    const world = new SkeinWorld(file)
    world.write({ get: 'rel', rel: 'Character->Character.Trust', from: 'Keeper', to: 'Stranger' }, 2)
    const story = new SkeinStory(world, 'Arrival')
    story.start()
    story.choose(0)
    const welcome = story.choose(0)
    expect(welcome).toMatchObject({ kind: 'line', text: 'Come in, then. Mind the stairs.' })
    expect(world.read({ get: 'rel', rel: 'Character->Character.Trust', from: 'Keeper', to: 'Stranger' })).toBe(3)
    expect(story.choose(0)).toMatchObject({ kind: 'end' })
  })

  it('requirements gate nodes', () => {
    const { file } = buildExport(sample())
    const world = new SkeinWorld(file)
    world.write({ get: 'var', var: 'World.StormRaging' }, false)
    const story = new SkeinStory(world, 'Arrival')
    story.start()
    expect(story.choose(0)).toMatchObject({ kind: 'end' }) // the Stranger only asks during the storm
  })

  it('instructions advance time and rules run for each character', () => {
    const { file } = buildExport(sample())
    const world = new SkeinWorld(file)
    const story = new SkeinStory(world, 'Night Watch')
    story.start()
    const beat = story.choose(0) // instruction: light the lamp, advance to Night
    expect(beat).toMatchObject({ kind: 'line', text: 'The light holds.' }) // requires World.LighthouseLit
    expect(world.phase).toBe('Night')
    expect(world.read({ get: 'prop', entity: 'Keeper', prop: 'Energy' })).toBe(4)
    expect(world.read({ get: 'prop', entity: 'Stranger', prop: 'Energy' })).toBe(4)
    world.advance(1) // Dawn of day 2
    world.advance(4) // Dawn of day 3: the storm rule fires
    expect(world.day).toBe(3)
    expect(world.read({ get: 'var', var: 'World.StormRaging' })).toBe(false)
  })

  it('saves and restores world state', () => {
    const { file } = buildExport(sample())
    const a = new SkeinWorld(file)
    a.write({ get: 'var', var: 'Player.Reputation' }, 7)
    a.advance(2)
    const b = new SkeinWorld(file, JSON.parse(JSON.stringify(a.save())))
    expect(b.read({ get: 'var', var: 'Player.Reputation' })).toBe(7)
    expect(b.phase).toBe('Dusk')
  })

  it('agrees with the editor on every expression in the project, before and after their effects', () => {
    const project = sample()
    const { file } = buildExport(project)
    const world = new SkeinWorld(file)
    const ctx: RunContext = { project, state: initialState(project) }
    let compared = 0
    // Apply every action in both runtimes, then compare every condition.
    forEachSite(project, (site) => {
      if (site.mode !== 'action' || site.owner.kind !== 'node') return // rules run via time, not directly
      execute(ctx, compile(project, site.source, 'action').actions)
      const owner = site.owner
      const node = owner.kind === 'node' ? file.flows[owner.flowId].nodes[owner.nodeId] : undefined
      if (!node) return
      if (site.field === 'effects') world.run(node.effects)
      if (site.field === 'script' && node.type === 'instruction') world.run(node.instruction)
    })
    forEachSite(project, (site) => {
      if (site.mode !== 'condition' || site.owner.kind !== 'node') return
      const node = file.flows[site.owner.flowId].nodes[site.owner.nodeId]
      const exported = site.field === 'requires' ? node.requires : node.type === 'condition' ? node.condition : undefined
      const editor = Boolean(evaluate(ctx, compile(project, site.source, 'condition').condition!))
      expect(world.check(exported)).toBe(editor)
      compared++
    })
    expect(compared).toBeGreaterThan(2)
    expect(world.day).toBe(ctx.state.day)
    const keeper = project.entities[Object.keys(project.entities).find((id) => project.entities[id].technicalName === 'Keeper')!]
    const energy = Object.values(project.templates[keeper.templateId].properties).find((p) => p.technicalName === 'Energy')!
    expect(world.read({ get: 'prop', entity: 'Keeper', prop: 'Energy' })).toBe(editorRead(ctx, { kind: 'prop', entity: keeper.id, propId: energy.id }))
  })
})
