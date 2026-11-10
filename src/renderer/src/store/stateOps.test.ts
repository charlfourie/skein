import { beforeEach, describe, expect, it } from 'vitest'
import { createEmptyProject } from '@shared/factory'
import { compile } from '@shared/expr/check'
import { validateProject } from '@shared/validate'
import { addNode, updateNodeData } from './flowOps'
import {
  addPhase,
  addProperty,
  addRelationship,
  addRule,
  addStateVariable,
  createEntity,
  createTemplate,
  removePhase,
  renameItem,
  setRelationValue,
  updateDef,
  updateProperty,
  updateRule
} from './ops'
import { useProjectStore } from './projectStore'

const s = () => useProjectStore.getState()
const p = () => s().project!

let flowId = ''
let character = ''
let keeper = ''
let stranger = ''
let mood = ''

beforeEach(() => {
  s().loadProject(createEmptyProject('State ops'), null)
  flowId = Object.keys(p().flows)[0]
  character = createTemplate(null)!
  renameItem('template', character, 'Character')
  mood = addProperty(character, 'number')!
  updateProperty(character, mood, { name: 'Mood', mutable: true })
  keeper = createEntity(character, null)!
  renameItem('entity', keeper, 'Keeper')
  stranger = createEntity(character, null)!
  renameItem('entity', stranger, 'Stranger')
})

describe('state operations', () => {
  it('new projects start with a four-phase day', () => {
    expect(Object.values(p().state.time.phases).map((x) => x.technicalName)).toEqual(['Dawn', 'Day', 'Dusk', 'Night'])
  })

  it('renaming an entity rewrites expressions in the same undo step', () => {
    const node = addNode(flowId, 'condition', { x: 0, y: 0 })!
    updateNodeData(flowId, node, { expression: 'Keeper.Mood > 1' })
    renameItem('entity', keeper, 'Old Keeper')
    expect(p().flows[flowId].nodes[node].data.expression).toBe('OldKeeper.Mood > 1')
    s().undo()
    expect(p().flows[flowId].nodes[node].data.expression).toBe('Keeper.Mood > 1')
    expect(p().entities[keeper].technicalName).toBe('Keeper')
  })

  it('renaming a property or variable rewrites references to it', () => {
    const v = addStateVariable('World', 'boolean')!
    updateDef({ kind: 'variable' }, v, { name: 'Storm Raging' })
    const node = addNode(flowId, 'dialogue', { x: 0, y: 0 })!
    updateNodeData(flowId, node, { requires: 'World.StormRaging and Keeper.Mood > 0', effects: 'Keeper.Mood += 1' })
    updateProperty(character, mood, { name: 'Temper' })
    updateDef({ kind: 'variable' }, v, { namespace: 'Weather', technicalName: 'Storm' })
    const data = p().flows[flowId].nodes[node].data
    expect(data.requires).toBe('Weather.Storm and Keeper.Temper > 0')
    expect(data.effects).toBe('Keeper.Temper += 1')
    expect((validateProject(p()).get(node) ?? []).filter((i) => i.field)).toEqual([]) // no expression problems
  })

  it('relationships: starting values are stored on the source entity only when set', () => {
    const trust = addRelationship(character, character, 'number')!
    expect(p().state.relationships[trust]).toMatchObject({ technicalName: 'Trust', min: -5, max: 5, defaultValue: 0 })
    setRelationValue(keeper, trust, stranger, 2)
    expect(p().entities[keeper].relations).toEqual({ [trust]: { [stranger]: 2 } })
    expect(compile(p(), 'Keeper->Stranger.Trust == 2 and Stranger->Keeper.Trust == 0', 'condition').ok).toBe(true)
    setRelationValue(keeper, trust, stranger, undefined)
    expect('relations' in p().entities[keeper]).toBe(false)
  })

  it('phases and rules: deleting a phase frees rules tied to it', () => {
    const midnight = addPhase('Midnight')!
    const rule = addRule()!
    updateRule(rule, { phaseId: midnight, forEachTemplateId: character, effects: 'self.Mood -= 1' })
    expect(validateProject(p()).get(rule)).toBeUndefined()
    removePhase(midnight)
    expect(p().state.rules[rule].phaseId).toBeNull()
  })
})
