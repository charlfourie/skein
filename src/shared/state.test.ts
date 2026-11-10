import { describe, expect, it } from 'vitest'
import { createEmptyProject, createEntity, createFlow, createProperty, createRelationship, createRule, createStateVariable, createTemplate } from './factory'
import { compile } from './expr/check'
import { advanceTime, evaluate, evaluateAtStart, execute, initialState, read, type RunContext } from './expr/runtime'
import { applyRename } from './expr/sites'
import { parseProject } from './parse'
import { SCHEMA_VERSION, type Project } from './schema'
import { serializeCanonical, serializeProject } from './serialize'
import { validateProject } from './validate'

/** Keeper and Stranger (Characters), a Trust relationship, world variables and the default four phases. */
function world(): Project {
  const p = createEmptyProject('State')
  const ch = createTemplate('t-ch', 'Character', 'Character', null, 0)
  ch.properties['p-mood'] = {
    ...createProperty('p-mood', 'Mood', 'Mood', 'enum', 0),
    mutable: true,
    options: { calm: { id: 'calm', label: 'Calm', order: 0 }, wary: { id: 'wary', label: 'Wary', order: 1 } },
    defaultValue: 'calm'
  }
  ch.properties['p-energy'] = { ...createProperty('p-energy', 'Energy', 'Energy', 'number', 1), mutable: true, min: 0, max: 5, integer: true, defaultValue: 3 }
  ch.properties['p-age'] = { ...createProperty('p-age', 'Age', 'Age', 'number', 2), defaultValue: 40 }
  p.templates['t-ch'] = ch
  p.entities['keeper'] = { ...createEntity('keeper', 'Keeper', 'Keeper', 't-ch', null, 0), relations: { trust: { stranger: 1 } } }
  p.entities['stranger'] = createEntity('stranger', 'Stranger', 'Stranger', 't-ch', null, 1)
  p.state.relationships['trust'] = { ...createRelationship('trust', 'Trust', 'Trust', 't-ch', 't-ch', 'number', 0), min: -5, max: 5, defaultValue: 0 }
  p.state.variables['storm'] = { ...createStateVariable('storm', 'World', 'Storm Raging', 'StormRaging', 'boolean', 0), defaultValue: true }
  p.state.variables['rep'] = { ...createStateVariable('rep', 'Player', 'Reputation', 'Reputation', 'number', 1), defaultValue: 2 }
  return p
}

const cond = (p: Project, src: string) => compile(p, src, 'condition')
const firstError = (p: Project, src: string, mode: 'condition' | 'action' = 'condition') =>
  compile(p, src, mode).diagnostics.find((d) => d.level === 'error')?.message ?? ''

describe('conditions', () => {
  it('evaluate against the starting state', () => {
    const p = world()
    expect(evaluateAtStart(p, 'Keeper->Stranger.Trust >= 1 and World.StormRaging')).toBe(true)
    expect(evaluateAtStart(p, 'Stranger->Keeper.Trust > 0')).toBe(false) // one-way: default 0
    expect(evaluateAtStart(p, 'Player.Reputation >= 2 && !(Keeper.Mood == Wary)')).toBe(true)
    expect(evaluateAtStart(p, 'Keeper.Mood is "calm"')).toBe(true) // option by label, any case
    expect(evaluateAtStart(p, 'Time.Day == 1 and Time.Phase is Dawn')).toBe(true)
    expect(evaluateAtStart(p, 'Time.Phase < Night')).toBe(true) // phases are ordered
    expect(evaluateAtStart(p, '(Keeper.Age - 10) * 2 > 50')).toBe(true)
  })

  it('reports syntax errors with a position', () => {
    const p = world()
    const r = cond(p, 'Keeper.Mood == ')
    expect(r.ok).toBe(false)
    expect(r.diagnostics[0].message).toMatch(/Expected a value/)
    expect(r.diagnostics[0].start).toBe(15)
    expect(firstError(p, 'World.StormRaging and and')).toMatch(/can’t be used here/)
    expect(firstError(p, 'Keeper.Mood == "Wary')).toMatch(/closing quote/)
    expect(firstError(p, 'Keeper.Mood = Wary')).toMatch(/Unexpected “=”/)
  })

  it('reports unknown names with suggestions', () => {
    const p = world()
    expect(firstError(p, 'Keeper.Mod == Wary')).toMatch(/no property “Mod”.*Did you mean “Mood”/)
    expect(firstError(p, 'Keepr.Mood == Wary')).toMatch(/nothing called “Keepr”.*“Keeper”/)
    expect(firstError(p, 'World.Storm')).toMatch(/No variable “Storm” in World.*StormRaging/)
    expect(firstError(p, 'Keeper.Mood == Angry')).toMatch(/isn’t one of the options.*Calm, Wary/)
    expect(firstError(p, 'Keeper->Stranger.Love > 1')).toMatch(/No relationship “Love”.*Trust/)
    expect(firstError(p, 'Time.Hours > 3')).toMatch(/Day.*Phase.*Hour/)
  })

  it('reports type mismatches', () => {
    const p = world()
    expect(firstError(p, 'Player.Reputation')).toMatch(/Expected true \/ false/)
    expect(firstError(p, 'World.StormRaging > 2')).toMatch(/Expected a number/)
    expect(firstError(p, 'Keeper.Mood == 3')).toMatch(/Expected one of Calm, Wary/)
  })
})

describe('actions', () => {
  const run = (p: Project, src: string) => {
    const c = compile(p, src, 'action')
    expect(c.diagnostics).toEqual([])
    const ctx: RunContext = { project: p, state: initialState(p) }
    execute(ctx, c.actions)
    return ctx
  }

  it('change world, character and relationship state', () => {
    const p = world()
    const ctx = run(p, 'Keeper.Mood = Wary\nKeeper->Stranger.Trust += 2; World.StormRaging = false')
    expect(evaluate(ctx, compile(p, 'Keeper.Mood == Wary and not World.StormRaging and Keeper->Stranger.Trust == 3', 'condition').condition!)).toBe(true)
  })

  it('clamps numbers to their limits', () => {
    const p = world()
    const ctx = run(p, 'Keeper->Stranger.Trust += 99\nStranger.Energy -= 10')
    expect(read(ctx, { kind: 'rel', relId: 'trust', from: 'keeper', to: 'stranger' })).toBe(5)
    expect(read(ctx, { kind: 'prop', entity: 'stranger', propId: 'p-energy' })).toBe(0)
  })

  it('refuses to change fixed design data or time directly', () => {
    const p = world()
    expect(firstError(p, 'Keeper.Age = 41', 'action')).toMatch(/fixed design data.*Changes during play/)
    expect(firstError(p, 'Time.Day = 3', 'action')).toMatch(/use “pass 30m”, “advance”/)
    expect(firstError(p, 'Keeper.Mood += 1', 'action')).toMatch(/only works on numbers/)
    expect(firstError(p, 'Keeper.Mood == Wary', 'action')).toMatch(/Use “=” to change/)
  })

  it('warns when a literal is outside the limits', () => {
    const p = world()
    expect(compile(p, 'Keeper->Stranger.Trust = 9', 'action').diagnostics[0]).toMatchObject({ level: 'warning' })
  })
})

describe('time and rules', () => {
  it('advances by phases and wraps to a new day', () => {
    const p = world()
    const ctx: RunContext = { project: p, state: initialState(p) }
    advanceTime(ctx, 3)
    expect(evaluate(ctx, compile(p, 'Time.Phase is Night and Time.Day == 1', 'condition').condition!)).toBe(true)
    advanceTime(ctx, 1)
    expect(evaluate(ctx, compile(p, 'Time.Phase is Dawn and Time.Day == 2', 'condition').condition!)).toBe(true)
    execute(ctx, compile(p, 'advance to Dusk', 'action').actions)
    expect(evaluate(ctx, compile(p, 'Time.Phase is Dusk and Time.Day == 2', 'condition').condition!)).toBe(true)
  })

  it('runs phase rules for each entity and day rules on a new day', () => {
    const p = world()
    const night = Object.values(p.state.time.phases).find((x) => x.label === 'Night')!
    p.state.rules['tired'] = { ...createRule('tired', 'Night tires everyone', 0), phaseId: night.id, forEachTemplateId: 't-ch', effects: 'self.Energy -= 1' }
    p.state.rules['calm'] = { ...createRule('calm', 'Storm passes', 1), trigger: 'day', condition: 'Time.Day >= 2', effects: 'World.StormRaging = false' }
    expect(validateProject(p).get('tired')).toBeUndefined()
    const ctx: RunContext = { project: p, state: initialState(p) }
    const log = { lines: [] as string[] }
    execute(ctx, compile(p, 'advance to Night', 'action').actions, log)
    expect(read(ctx, { kind: 'prop', entity: 'keeper', propId: 'p-energy' })).toBe(2)
    expect(read(ctx, { kind: 'prop', entity: 'stranger', propId: 'p-energy' })).toBe(2)
    expect(read(ctx, { kind: 'world', varId: 'storm' })).toBe(true)
    advanceTime(ctx, 1, undefined, log) // → Dawn, day 2
    expect(read(ctx, { kind: 'world', varId: 'storm' })).toBe(false)
    expect(log.lines.filter((l) => l.startsWith('Rule'))).toHaveLength(3)
  })

  it('rules cannot advance time, and self needs a for-each template', () => {
    const p = world()
    p.state.rules['bad'] = { ...createRule('bad', 'Bad', 0), effects: 'advance\nself.Energy = 1' }
    const msgs = (validateProject(p).get('bad') ?? []).map((i) => i.message).join(' | ')
    expect(msgs).toMatch(/can’t advance time/)
    expect(msgs).toMatch(/“self” only works/)
  })
})

describe('nodes and validation', () => {
  it('flags broken syntax on nodes as errors, keyed to the node', () => {
    const p = world()
    const f = createFlow('f', 'F', null, 0)
    f.nodes['c'] = { id: 'c', type: 'condition', position: { x: 0, y: 0 }, data: { isStart: true, isEnd: true, expression: 'Keeper.Mood ==' } }
    f.nodes['d'] = { id: 'd', type: 'dialogue', position: { x: 0, y: 100 }, data: { isStart: true, isEnd: true, requires: 'Player.Reputation > 1', effects: 'Keeper.Mood = Wary' } }
    p.flows = { f }
    const issues = validateProject(p)
    expect(issues.get('c')?.[0]).toMatchObject({ level: 'error', field: 'expression' })
    expect(issues.get('d')).toBeUndefined()
  })

  it('flags namespace clashes and duplicate variable names', () => {
    const p = world()
    p.state.variables['dup'] = createStateVariable('dup', 'World', 'Storm', 'StormRaging', 'boolean', 2)
    p.state.variables['clash'] = createStateVariable('clash', 'Keeper', 'X', 'X', 'number', 3)
    const issues = validateProject(p)
    expect(issues.get('dup')?.some((i) => /also used by/.test(i.message))).toBe(true)
    expect(issues.get('clash')?.some((i) => /namespace wins/.test(i.message))).toBe(true)
  })
})

describe('renames follow into expressions', () => {
  it('entity, property, variable and relationship renames rewrite references only where they apply', () => {
    const p = world()
    const f = createFlow('f', 'F', null, 0)
    f.nodes['n'] = {
      id: 'n',
      type: 'dialogue',
      position: { x: 0, y: 0 },
      data: { requires: 'Keeper.Mood == Wary and Keeper->Stranger.Trust > 1 # Keeper stays', effects: 'World.StormRaging = false\nStranger.Mood = Calm' }
    }
    p.flows = { f }
    applyRename(p, { kind: 'entity', from: 'Keeper', to: 'OldKeeper' })
    p.entities['keeper'].technicalName = 'OldKeeper' // the editor renames the entity and its references together
    applyRename(p, { kind: 'property', templateId: 't-ch', from: 'Mood', to: 'Temper' })
    applyRename(p, { kind: 'relationship', fromTemplateId: 't-ch', toTemplateId: 't-ch', from: 'Trust', to: 'Faith' })
    applyRename(p, { kind: 'variable', fromNamespace: 'World', fromName: 'StormRaging', toNamespace: 'Weather', toName: 'Storm' })
    expect(f.nodes['n'].data.requires).toBe('OldKeeper.Temper == Wary and OldKeeper->Stranger.Faith > 1 # Keeper stays')
    expect(f.nodes['n'].data.effects).toBe('Weather.Storm = false\nStranger.Temper = Calm')
  })
})

describe('file format v4', () => {
  it('migrates v3: drops the placeholder variables section, adds time, folds stage directions into notes', () => {
    const p = createEmptyProject('Old') as unknown as Record<string, unknown>
    delete p.state
    p.variables = {}
    const flows = p.flows as Project['flows']
    const flow = Object.values(flows)[0]
    flow.nodes['d'] = { id: 'd', type: 'dialogue', position: { x: 0, y: 0 }, data: { text: 'Hi', stageDirections: 'whispered' } }
    p.schemaVersion = 3
    const result = parseProject(serializeCanonical(p))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.schemaVersion).toBe(SCHEMA_VERSION)
    expect('variables' in result.project).toBe(false)
    expect(Object.values(result.project.state.time.phases).map((x) => x.label)).toEqual(['Dawn', 'Day', 'Dusk', 'Night'])
    expect(Object.values(result.project.flows)[0].nodes['d'].data).toEqual({ text: 'Hi', note: 'Direction: whispered' })
  })

  it('round-trips state byte-for-byte and repairs dangling relationship values', () => {
    const p = world()
    const text = serializeProject(p)
    const parsed = parseProject(text)
    expect(parsed.ok && serializeProject(parsed.project) === text).toBe(true)
    p.entities['keeper'].relations!.trust['ghost'] = 3
    p.entities['keeper'].relations!.gone = { stranger: 1 }
    const repaired = parseProject(serializeProject(p))
    expect(repaired.ok).toBe(true)
    if (!repaired.ok) return
    expect(repaired.project.entities['keeper'].relations).toEqual({ trust: { stranger: 1 } })
    expect(repaired.repairs).toHaveLength(2)
  })
})
