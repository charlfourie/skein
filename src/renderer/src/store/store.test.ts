import { beforeEach, describe, expect, it } from 'vitest'
import { createEmptyProject } from '@shared/factory'
import { serializeProject } from '@shared/serialize'
import {
  addEnumOption,
  addProperty,
  createEntity,
  createTemplate,
  deleteItem,
  duplicateEntity,
  renameItem,
  setEntityValue,
  updateProperty
} from './ops'
import { selectDirty, useProjectStore } from './projectStore'

const s = () => useProjectStore.getState()

beforeEach(() => {
  s().loadProject(createEmptyProject('Store'), '/tmp/x.skein.json')
})

describe('history and dirty state', () => {
  it('starts clean; an edit makes it dirty; undo makes it clean again', () => {
    expect(selectDirty(s())).toBe(false)
    renameItem('flow', Object.keys(s().project!.flows)[0], 'Opening')
    expect(selectDirty(s())).toBe(true)
    s().undo()
    expect(selectDirty(s())).toBe(false)
    s().redo()
    expect(selectDirty(s())).toBe(true)
    expect(Object.values(s().project!.flows)[0].name).toBe('Opening')
  })

  it('a no-op edit adds no history and does not dirty', () => {
    const flowId = Object.keys(s().project!.flows)[0]
    renameItem('flow', flowId, 'Main') // same name
    expect(s().past).toHaveLength(0)
    expect(selectDirty(s())).toBe(false)
  })

  it('saving marks the saved snapshot; later edits are dirty again', () => {
    const t = createTemplate(null)!
    s().markSaved('/tmp/x.skein.json', s().project!)
    expect(selectDirty(s())).toBe(false)
    renameItem('template', t, 'Character')
    expect(selectDirty(s())).toBe(true)
  })

  it('undo restores the selection from before the change', () => {
    const t = createTemplate(null)!
    s().select({ kind: 'template', id: t })
    deleteItem('template', t)
    expect(s().selection).toEqual({ kind: 'project' })
    s().undo()
    expect(s().project!.templates[t]).toBeTruthy()
    expect(s().selection).toEqual({ kind: 'template', id: t })
  })
})

describe('templates and entities', () => {
  it('builds a template, instances and values, and saves deterministically', () => {
    const t = createTemplate(null)!
    renameItem('template', t, 'Character')
    expect(s().project!.templates[t].technicalName).toBe('Character') // followed the rename

    const role = addProperty(t, 'enum')!
    updateProperty(t, role, { name: 'Role' })
    const hero = addEnumOption(t, role, 'Hero')!
    const age = addProperty(t, 'number')!

    const e = createEntity(t, null)!
    renameItem('entity', e, 'Keeper')
    setEntityValue(e, role, hero)
    setEntityValue(e, age, 61)
    const copy = duplicateEntity(e)!

    const p = s().project!
    expect(p.entities[e].technicalName).toBe('Keeper')
    expect(p.entities[copy].values).toEqual({ [role]: hero, [age]: 61 })
    expect(p.entities[copy].technicalName).toBe('KeeperCopy')

    // Same content → same bytes, regardless of the edit history that produced it.
    expect(serializeProject(p)).toBe(serializeProject(structuredClone(p)))
  })

  it('a hand-edited technical name stops following the display name', () => {
    const t = createTemplate(null)!
    const prop = addProperty(t, 'text')!
    updateProperty(t, prop, { technicalName: 'Callsign' })
    updateProperty(t, prop, { name: 'Nickname' })
    expect(s().project!.templates[t].properties[prop].technicalName).toBe('Callsign')
  })

  it('undefined in a property patch removes that setting', () => {
    const t = createTemplate(null)!
    const n = addProperty(t, 'number')!
    updateProperty(t, n, { min: 0 })
    expect(s().project!.templates[t].properties[n].min).toBe(0)
    updateProperty(t, n, { min: undefined })
    expect('min' in s().project!.templates[t].properties[n]).toBe(false)
  })
})
