import { describe, expect, it } from 'vitest'
import { createEntity, createEmptyProject, createFolder, createProperty, createTemplate } from './factory'
import {
  changePropertyType,
  countLossOnTypeChange,
  deleteEntities,
  deleteFolderTree,
  deleteTemplates,
  findEntityReferences,
  removeEnumOption,
  removeProperty
} from './mutations'
import { parseProject } from './parse'
import { SCHEMA_VERSION, type Project } from './schema'
import { serializeCanonical, serializeProject } from './serialize'
import { isDerivedTechnicalName, toTechnicalName, uniqueTechnicalName } from './technicalName'
import { validateProject } from './validate'
import { coerceValue, effectiveValue } from './values'

/** A small project: Faction and Character templates, with two characters linked to a faction. */
function fixture(): Project {
  const p = createEmptyProject('Fixture')
  p.templates['t-fac'] = createTemplate('t-fac', 'Faction', 'Faction', null, 0)
  const ch = createTemplate('t-char', 'Character', 'Character', null, 1)
  ch.properties['p-age'] = { ...createProperty('p-age', 'Age', 'Age', 'number', 0), min: 0, integer: true }
  ch.properties['p-role'] = createProperty('p-role', 'Role', 'Role', 'enum', 1)
  ch.properties['p-role'].options = {
    'o-hero': { id: 'o-hero', label: 'Hero', order: 0 },
    'o-foe': { id: 'o-foe', label: 'Foe', order: 1 }
  }
  ch.properties['p-fac'] = { ...createProperty('p-fac', 'Faction', 'Faction', 'reference', 2), referenceTemplateId: 't-fac' }
  ch.properties['p-bio'] = { ...createProperty('p-bio', 'Bio', 'Bio', 'longText', 3), defaultValue: 'Unknown' }
  p.templates['t-char'] = ch

  p.entities['e-guild'] = createEntity('e-guild', 'Guild', 'Guild', 't-fac', null, 0)
  p.entities['e-ana'] = {
    ...createEntity('e-ana', 'Ana', 'Ana', 't-char', null, 1),
    values: { 'p-age': 30, 'p-role': 'o-hero', 'p-fac': 'e-guild' }
  }
  p.entities['e-bo'] = { ...createEntity('e-bo', 'Bo', 'Bo', 't-char', null, 2), values: { 'p-role': 'o-foe', 'p-fac': 'e-guild' } }
  return p
}

describe('file format v2', () => {
  it('migrates a v1 file (from Phase 1) to the current version', () => {
    const v1 = JSON.parse(serializeProject(createEmptyProject('Old'))) as Record<string, unknown>
    v1.schemaVersion = 1
    const result = parseProject(serializeCanonical(v1))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.schemaVersion).toBe(SCHEMA_VERSION)
    expect(result.repairs).toEqual([])
  })

  it('round-trips templates and entities byte-for-byte', () => {
    const text = serializeProject(fixture())
    const parsed = parseProject(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.repairs).toEqual([])
    expect(serializeProject(parsed.project)).toBe(text)
  })

  it('stores only values that were set, keyed by property id', () => {
    const text = serializeProject(fixture())
    expect(text).toContain('"p-age": 30')
    expect(text).not.toContain('"Age": 30')
    const bo = fixture().entities['e-bo']
    expect(Object.keys(bo.values)).not.toContain('p-age')
  })

  it('repairs values a bad merge can leave behind', () => {
    const p = fixture()
    p.entities['e-ana'].values['p-gone'] = 'stale' // property deleted by a teammate
    p.entities['e-ana'].values['p-role'] = 'o-deleted' // option deleted
    p.entities['e-bo'].values['p-fac'] = 'e-ghost' // linked entity deleted
    p.entities['e-bo'].values['p-age'] = 'thirty' // wrong type
    p.templates['t-char'].properties['p-fac'].referenceTemplateId = 't-ghost'
    const result = parseProject(serializeProject(p))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const fixed = result.project
    expect(fixed.entities['e-ana'].values).toEqual({ 'p-age': 30, 'p-fac': 'e-guild' })
    expect(fixed.entities['e-bo'].values).toEqual({ 'p-role': 'o-foe' })
    expect(fixed.templates['t-char'].properties['p-fac'].referenceTemplateId).toBeNull()
    expect(result.repairs.length).toBe(5)
  })

  it('keeps an entity whose template is missing, untouched', () => {
    const p = fixture()
    delete p.templates['t-fac']
    const result = parseProject(serializeProject(p))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.entities['e-guild']).toBeTruthy()
    expect(validateProject(result.project).get('e-guild')?.[0].level).toBe('error')
  })
})

describe('values', () => {
  it('falls back to the default, then the empty value', () => {
    const p = fixture()
    const bio = p.templates['t-char'].properties['p-bio']
    const age = p.templates['t-char'].properties['p-age']
    expect(effectiveValue(bio, p.entities['e-bo'].values)).toEqual({ value: 'Unknown', overridden: false })
    expect(effectiveValue(age, p.entities['e-bo'].values)).toEqual({ value: null, overridden: false })
    expect(effectiveValue(age, p.entities['e-ana'].values)).toEqual({ value: 30, overridden: true })
  })

  it('coerces sensibly across types', () => {
    expect(coerceValue('42', 'number')).toBe(42)
    expect(coerceValue('forty', 'number')).toBeUndefined()
    expect(coerceValue(7, 'text')).toBe('7')
    expect(coerceValue('yes', 'boolean')).toBe(true)
    expect(coerceValue(0, 'boolean')).toBe(false)
    expect(coerceValue('#ABCDEF', 'color')).toBe('#abcdef')
    expect(coerceValue('Hero', 'enum')).toBeUndefined()
  })
})

describe('technical names', () => {
  it('derives PascalCase identifiers', () => {
    expect(toTechnicalName('is alive?')).toBe('IsAlive')
    expect(toTechnicalName('Café crème')).toBe('CafeCreme')
    expect(toTechnicalName('3rd Watch')).toBe('_3rdWatch')
    expect(toTechnicalName('!!!')).toBe('Unnamed')
  })

  it('picks a free name, case-insensitively', () => {
    expect(uniqueTechnicalName('Hero', ['hero', 'Hero2'])).toBe('Hero3')
  })

  it('recognises auto-derived names', () => {
    expect(isDerivedTechnicalName('NewTemplate2', 'New Template')).toBe(true)
    expect(isDerivedTechnicalName('Npc', 'New Template')).toBe(false)
  })

  it('flags duplicates and invalid identifiers', () => {
    const p = fixture()
    p.entities['e-bo'].technicalName = 'ana'
    p.templates['t-char'].properties['p-age'].technicalName = '1bad'
    const issues = validateProject(p)
    expect(issues.get('e-bo')?.some((i) => /also used by/.test(i.message))).toBe(true)
    expect(issues.get('e-ana')?.some((i) => /also used by/.test(i.message))).toBe(true)
    expect(issues.get('t-char')?.some((i) => i.propertyId === 'p-age' && i.level === 'error')).toBe(true)
  })

  it('warns about rule violations without touching data', () => {
    const p = fixture()
    p.entities['e-ana'].values['p-age'] = -3.5
    const msgs = (validateProject(p).get('e-ana') ?? []).map((i) => i.message)
    expect(msgs.some((m) => /whole number/.test(m))).toBe(true)
  })
})

describe('mutations keep references consistent', () => {
  it('deleting an entity clears links to it', () => {
    const p = fixture()
    expect(findEntityReferences(p, 'e-guild')).toHaveLength(2)
    deleteEntities(p, ['e-guild'])
    expect(p.entities['e-ana'].values['p-fac']).toBeUndefined()
    expect(p.entities['e-bo'].values['p-fac']).toBeUndefined()
  })

  it('deleting a template deletes its entities and frees reference filters', () => {
    const p = fixture()
    deleteTemplates(p, ['t-fac'])
    expect(p.entities['e-guild']).toBeUndefined()
    expect(p.entities['e-ana'].values['p-fac']).toBeUndefined()
    expect(p.templates['t-char'].properties['p-fac'].referenceTemplateId).toBeNull()
  })

  it('deleting a templates folder cascades to instances', () => {
    const p = fixture()
    p.folders['f'] = createFolder('f', 'People', 'templates', null, 0)
    p.templates['t-char'].folderId = 'f'
    const removed = deleteFolderTree(p, 'f')
    expect(removed.has('t-char') && removed.has('e-ana') && removed.has('e-bo')).toBe(true)
    expect(Object.keys(p.entities)).toEqual(['e-guild'])
  })

  it('removing a property or option removes the values that used it', () => {
    const p = fixture()
    removeEnumOption(p, 't-char', 'p-role', 'o-foe')
    expect(p.entities['e-bo'].values['p-role']).toBeUndefined()
    expect(p.entities['e-ana'].values['p-role']).toBe('o-hero')
    removeProperty(p, 't-char', 'p-age')
    expect('p-age' in p.entities['e-ana'].values).toBe(false)
  })

  it('changing a property type converts what it can', () => {
    const p = fixture()
    p.entities['e-bo'].values['p-bio'] = '12'
    p.entities['e-ana'].values['p-bio'] = 'Brave'
    expect(countLossOnTypeChange(p, 't-char', 'p-bio', 'number')).toBe(1)
    changePropertyType(p, 't-char', 'p-bio', 'number')
    expect(p.entities['e-bo'].values['p-bio']).toBe(12)
    expect(p.entities['e-ana'].values['p-bio']).toBeUndefined()
    expect(p.templates['t-char'].properties['p-bio'].defaultValue).toBeUndefined() // "Unknown" isn't a number

    changePropertyType(p, 't-char', 'p-age', 'text')
    const age = p.templates['t-char'].properties['p-age']
    expect(age.min).toBeUndefined()
    expect(age.integer).toBeUndefined()
    expect(p.entities['e-ana'].values['p-age']).toBe('30')
  })
})
