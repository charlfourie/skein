import { describe, expect, it } from 'vitest'
import { buildExport } from './export/build'
import { SkeinStory, SkeinWorld, type Beat } from './export/runtime'
import { createEmptyProject, createFlow, createRule, createStateVariable } from './factory'
import { explore } from './play/explore'
import type { Flow, Project } from './schema'
import { validateProject } from './validate'

/**
 * Main:   "Morning." → [Play flow: Radio] → "Back to work." → [Jump: continue in Night]
 * Radio:  "Static." → (choice) "Tune in" (End) / "Switch off" (End)
 * Night:  "The lights go out." (End)
 * A rule only during Radio counts phases: World.Heard.
 */
function project(): Project {
  const p = createEmptyProject('Calls')
  p.state.time.speakingRate = 0 // these tests aren't about spoken time
  p.flows = {}
  const heard = { ...createStateVariable('v1', 'World', 'Heard', 'Heard', 'number', 0), defaultValue: 0, min: 0, max: 10 }
  p.state.variables[heard.id] = heard
  const mk = (id: string, name: string, order: number) => {
    const f = createFlow(id, name, null, order)
    p.flows[id] = f
    return f
  }
  const node = (f: Flow, id: string, type: string, data: Record<string, unknown>) => (f.nodes[id] = { id, type, position: { x: 0, y: 0 }, data })
  const edge = (f: Flow, id: string, source: string, target: string, order = 0) =>
    (f.edges[id] = { id, source, target, sourceHandle: 'out', targetHandle: 'in', order })
  const main = mk('main', 'Main', 0)
  node(main, 'm1', 'dialogue', { isStart: true, startOrder: 0, text: 'Morning.' })
  node(main, 'm2', 'call', { flowId: 'radio' })
  node(main, 'm3', 'dialogue', { text: 'Back to work.' })
  node(main, 'm4', 'jump', { targetFlowId: 'night' })
  edge(main, 'a', 'm1', 'm2')
  edge(main, 'b', 'm2', 'm3')
  edge(main, 'c', 'm3', 'm4')
  const radio = mk('radio', 'Radio', 1)
  node(radio, 'r1', 'dialogue', { isStart: true, startOrder: 0, text: 'Static.', effects: 'advance' })
  node(radio, 'r2', 'dialogue', { menuText: 'Tune in', text: 'A voice.', isEnd: true })
  node(radio, 'r3', 'dialogue', { menuText: 'Switch off', text: 'Silence.', isEnd: true })
  edge(radio, 'd', 'r1', 'r2', 0)
  edge(radio, 'e', 'r1', 'r3', 1)
  const night = mk('night', 'Night', 2)
  node(night, 'n1', 'dialogue', { isStart: true, startOrder: 0, text: 'The lights go out.', isEnd: true })
  const rule = { ...createRule('rule', 'Count radio time', 0), trigger: 'phase' as const, phaseId: null, effects: 'World.Heard += 1', flowId: 'radio' }
  p.state.rules[rule.id] = rule
  return p
}

const text = (b: Beat) => (b.kind === 'line' ? b.text : b.kind === 'end' ? `END ${b.node?.id ?? '-'}` : `CHOICE ${b.choices.map((c) => c.text).join('/')}`)

describe('Play flow (call) and hand-off jumps', () => {
  it('exports call nodes and flow jumps as v2', () => {
    const { file, problems } = buildExport(project())
    expect(problems).toEqual([])
    expect(file.version).toBe(2)
    expect(file.flows.main.nodes.m2).toMatchObject({ type: 'call', flow: 'radio', next: ['m3'] })
    expect(file.flows.main.nodes.m4).toMatchObject({ type: 'jump', jumpTo: null, jumpFlow: 'night' })
  })

  it('plays the called flow, comes back, then hands off', () => {
    const { file } = buildExport(project())
    const world = new SkeinWorld(file)
    const story = new SkeinStory(world, 'main')
    const seen: string[] = []
    let beat = story.start()
    seen.push(`${story.flow.id}:${text(beat)}`)
    beat = story.choose(0) // into Radio
    seen.push(`${story.flow.id}:${text(beat)} depth=${story.calls.length} playing=${world.playing}`)
    beat = story.choose(1) // Switch off
    seen.push(`${story.flow.id}:${text(beat)}`)
    beat = story.choose(0) // Radio ends → back in Main
    seen.push(`${story.flow.id}:${text(beat)} depth=${story.calls.length} playing=${world.playing}`)
    beat = story.choose(0) // jump: continue in Night
    seen.push(`${story.flow.id}:${text(beat)}`)
    beat = story.choose(0)
    seen.push(`${story.flow.id}:${text(beat)} playing=${world.playing}`)
    expect(seen).toEqual([
      'main:Morning.',
      'radio:Static. depth=1 playing=radio',
      'radio:Silence.',
      'main:Back to work. depth=0 playing=main',
      'night:The lights go out.',
      'night:END n1 playing=null'
    ])
    expect(world.read({ get: 'var', var: 'World.Heard' })).toBe(1) // the rule ran during Radio only
  })

  it('a missing or unset flow is passed through, with an error or warning', () => {
    const p = project()
    p.flows.main.nodes.m2.data.flowId = 'gone'
    p.flows.main.nodes.m4.data.targetFlowId = 'gone'
    const issues = validateProject(p)
    expect(issues.get('m2')?.some((i) => i.level === 'error' && /no longer exists/.test(i.message))).toBe(true)
    expect(issues.get('m4')?.some((i) => i.level === 'error' && /no longer exists/.test(i.message))).toBe(true)
    const { file } = buildExport(p)
    const story = new SkeinStory(new SkeinWorld(file), 'main')
    story.start()
    expect(text(story.choose(0))).toBe('Back to work.') // skipped straight past the call
  })

  it('a flow that calls itself forever stops with an error', () => {
    const p = project()
    p.flows.radio.nodes.r0 = { id: 'r0', type: 'call', position: { x: 0, y: 0 }, data: { isStart: true, startOrder: -1, flowId: 'radio' } }
    const { file } = buildExport(p)
    const story = new SkeinStory(new SkeinWorld(file), 'radio')
    expect(() => story.start()).toThrow(/nested 100 deep/)
  })

  it('the explorer follows calls and hand-offs', () => {
    const r = explore(buildExport(project()).file, { flowId: 'main' })
    expect(r.paths).toBe(2)
    expect(r.endings.map((e) => e.text)).toEqual(['The lights go out.'])
    expect(r.unreached).toEqual([])
  })
})
