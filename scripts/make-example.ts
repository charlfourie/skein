/**
 * Regenerates examples/lighthouse-v2.skein.json — a small sample project.
 * Usage: npm run make:example
 */
import { mkdirSync, writeFileSync } from 'fs'
import {
  createEmptyProject,
  createEntity,
  createFlow,
  createFolder,
  createProperty,
  createRelationship,
  createRule,
  createStateVariable,
  createTemplate
} from '../src/shared/factory'
import { newId } from '../src/shared/ids'
import type { Flow, PropertyDef } from '../src/shared/schema'
import { serializeProject } from '../src/shared/serialize'

const project = createEmptyProject('The Lighthouse Keeper')
project.meta.description = 'Sample project: a short branching conversation on a storm-bound island.'
project.flows = {}

const act1 = newId()
const characters = newId()
project.folders[act1] = createFolder(act1, 'Act I', 'flows', null, 0)
project.folders[characters] = createFolder(characters, 'Characters', 'entities', null, 0)

// --- Templates -------------------------------------------------------------
const prop = (name: string, type: PropertyDef['type'], order: number, extra: Partial<PropertyDef> = {}): PropertyDef => ({
  ...createProperty(newId(), name, name.replace(/[^A-Za-z0-9]/g, ''), type, order),
  ...extra
})
const options = (...labels: string[]) => {
  const out: NonNullable<PropertyDef['options']> = {}
  labels.forEach((label, order) => {
    const id = newId()
    out[id] = { id, label, order }
  })
  return out
}

const faction = createTemplate(newId(), 'Faction', 'Faction', null, 0, '#34d399', 'flag')
const motto = prop('Motto', 'text', 0)
faction.properties[motto.id] = motto
project.templates[faction.id] = faction

const character = createTemplate(newId(), 'Character', 'Character', null, 1, '#818cf8', 'user')
character.description = 'Anyone who can speak a line of dialogue.'
const role = prop('Role', 'enum', 0, { options: options('Protagonist', 'Ally', 'Antagonist', 'Bystander') })
const moodOptions = options('Calm', 'Wary', 'Warm')
const mood = prop('Mood', 'enum', 1, { options: moodOptions, mutable: true, defaultValue: Object.keys(moodOptions)[0] })
const energy = prop('Energy', 'number', 2, { min: 0, max: 5, integer: true, mutable: true, defaultValue: 5 })
const isAlive = prop('Is Alive', 'boolean', 3, { defaultValue: true, mutable: true })
const age = prop('Age', 'number', 4, { min: 0, max: 150, integer: true })
const memberOf = prop('Member Of', 'reference', 5, { referenceTemplateId: faction.id })
const accent = prop('Dialogue Colour', 'color', 6, { defaultValue: '#e4e7ef' })
const bio = prop('Biography', 'longText', 7, { description: 'Private notes for writers; not shown in game.' })
for (const p of [role, mood, energy, isAlive, age, memberOf, accent, bio]) character.properties[p.id] = p
project.templates[character.id] = character

const item = createTemplate(newId(), 'Item', 'Item', null, 2, '#fbbf24', 'gem')
const rarity = prop('Rarity', 'enum', 0, { options: options('Common', 'Rare', 'Legendary') })
const weight = prop('Weight', 'number', 1, { min: 0 })
for (const p of [rarity, weight]) item.properties[p.id] = p
project.templates[item.id] = item

// --- Entities --------------------------------------------------------------
const optionId = (p: PropertyDef, label: string) => Object.values(p.options ?? {}).find((o) => o.label === label)!.id
const watchFaction = createEntity(newId(), 'Lighthouse Watch', 'LighthouseWatch', faction.id, null, 0)
watchFaction.values[motto.id] = 'The light does not go out.'
project.entities[watchFaction.id] = watchFaction

const keeper = createEntity(newId(), 'Keeper', 'Keeper', character.id, characters, 1)
keeper.values = {
  [role.id]: optionId(role, 'Ally'),
  [age.id]: 61,
  [memberOf.id]: watchFaction.id,
  [accent.id]: '#fbbf24',
  [bio.id]: 'Has kept the light for forty winters. Lost his son to the same fog.'
}
project.entities[keeper.id] = keeper
const stranger = createEntity(newId(), 'Stranger', 'Stranger', character.id, characters, 2)
stranger.values = { [role.id]: optionId(role, 'Protagonist') }
project.entities[stranger.id] = stranger
const lantern = createEntity(newId(), 'Storm Lantern', 'StormLantern', item.id, null, 3)
lantern.values = { [rarity.id]: optionId(rarity, 'Rare'), [weight.id]: 1.5 }
project.entities[lantern.id] = lantern

// --- State -----------------------------------------------------------------
const state = project.state
const storm = { ...createStateVariable(newId(), 'World', 'Storm Raging', 'StormRaging', 'boolean', 0), defaultValue: true }
const lit = { ...createStateVariable(newId(), 'World', 'Lighthouse Lit', 'LighthouseLit', 'boolean', 1), defaultValue: false }
const reputation = {
  ...createStateVariable(newId(), 'Player', 'Reputation', 'Reputation', 'number', 2),
  defaultValue: 1,
  min: 0,
  max: 10,
  integer: true,
  description: 'How the island folk regard the player.'
}
for (const v of [storm, lit, reputation]) state.variables[v.id] = v

const trust = {
  ...createRelationship(newId(), 'Trust', 'Trust', character.id, character.id, 'number', 0),
  min: -5,
  max: 5,
  integer: true,
  defaultValue: 0,
  description: 'How far one character trusts another. One-way.'
}
state.relationships[trust.id] = trust
keeper.relations = { [trust.id]: { [stranger.id]: -1 } } // the Keeper starts out suspicious

const night = Object.values(state.time.phases).find((p) => p.label === 'Night')!
const tired = createRule(newId(), 'Night wears everyone down', 0)
Object.assign(tired, { phaseId: night.id, forEachTemplateId: character.id, effects: 'self.Energy -= 1' })
const calm = createRule(newId(), 'The storm blows over', 1)
Object.assign(calm, { trigger: 'day', condition: 'Time.Day >= 3', effects: 'World.StormRaging = false' })
state.rules[tired.id] = tired
state.rules[calm.id] = calm

// --- Flows -----------------------------------------------------------------
function builder(flow: Flow) {
  const node = (type: string, x: number, y: number, data: Record<string, unknown>) => {
    const id = newId()
    flow.nodes[id] = { id, type, position: { x, y }, data }
    return id
  }
  const link = (source: string, target: string, sourceHandle = 'out') => {
    const id = newId()
    flow.edges[id] = { id, source, target, sourceHandle, targetHandle: 'in' }
  }
  return { node, link }
}

const arrival = createFlow(newId(), 'Arrival', act1, 0)
{
  const { node, link } = builder(arrival)
  const start = node('dialogue', 0, 0, { isStart: true, speakerId: keeper.id, text: 'Another ship lost to the fog…' })
  const ask = node('dialogue', 0, 170, {
    speakerId: stranger.id,
    text: 'I need shelter for the night.',
    requires: 'World.StormRaging'
  })
  const check = node('condition', 0, 360, { expression: 'Keeper->Stranger.Trust >= 1 or Player.Reputation >= 2' })
  const welcome = node('dialogue', -230, 540, {
    speakerId: keeper.id,
    text: 'Come in, then. Mind the stairs.',
    isEnd: true,
    effects: 'Keeper.Mood = Warm\nKeeper->Stranger.Trust += 1'
  })
  const refuse = node('dialogue', 230, 540, {
    speakerId: keeper.id,
    text: 'The mainland is that way.',
    effects: 'Keeper.Mood = Wary\nPlayer.Reputation -= 1'
  })
  const plead = node('hub', 260, 730, { label: 'Plead again' })
  const back = node('jump', 260, 860, { targetId: ask, note: 'Loops back so the player can try again.' })
  link(start, ask)
  link(ask, check)
  link(check, welcome, 'true')
  link(check, refuse, 'false')
  link(refuse, plead)
  link(plead, back)
}
project.flows[arrival.id] = arrival

const nightWatch = createFlow(newId(), 'Night Watch', act1, 1)
{
  const { node, link } = builder(nightWatch)
  const s = node('dialogue', 0, 0, { isStart: true, speakerId: keeper.id, text: 'Trim the wick. Every hour, without fail.' })
  const set = node('instruction', 0, 170, { script: 'World.LighthouseLit = true\nadvance to Night' })
  const done = node('dialogue', 0, 330, { speakerId: stranger.id, text: 'The light holds.', isEnd: true, requires: 'World.LighthouseLit' })
  link(s, set)
  link(set, done)
}
project.flows[nightWatch.id] = nightWatch

const prologue = createFlow(newId(), 'Prologue', null, 0)
project.flows[prologue.id] = prologue

mkdirSync('examples', { recursive: true })
writeFileSync('examples/lighthouse-v2.skein.json', serializeProject(project))
console.log('Wrote examples/lighthouse-v2.skein.json')
