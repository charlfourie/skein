/**
 * Regenerates the demo projects bundled with Skein (shown on the Welcome screen).
 * Usage: npm run make:demos
 *
 *   coffee-order.skein.json  — simple: one flow, a choice, a condition, a loop
 *   museum-heist.skein.json  — complex: templates, items, state, time, rules,
 *                              relationships, three chained flows, several endings
 */
import dagre from '@dagrejs/dagre'
import { mkdirSync, writeFileSync } from 'fs'
import {
  createEmptyProject,
  createEntity,
  createFlow,
  createFolder,
  createPhase,
  createProperty,
  createRelationship,
  createRule,
  createStateVariable,
  createTemplate
} from '../src/shared/factory'
import { analyzeFlow } from '../src/shared/flowAnalysis'
import { newId } from '../src/shared/ids'
import type { Flow, Project, PropertyDef } from '../src/shared/schema'
import { serializeProject } from '../src/shared/serialize'

const OUT = 'src/renderer/src/demos'
const CREATED = '2026-01-01T00:00:00.000Z'

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
const optionId = (p: PropertyDef, label: string) => Object.values(p.options ?? {}).find((o) => o.label === label)!.id

function variable(project: Project, ns: string, name: string, type: PropertyDef['type'], order: number, extra: Partial<PropertyDef>) {
  const v = { ...createStateVariable(newId(), ns, name, name.replace(/[^A-Za-z0-9]/g, ''), type, order), ...extra }
  project.state.variables[v.id] = v
}

/** Minimal graph builder: `n` adds a node (unset fields are dropped), `e` connects two, `chain` connects several. */
function builder(flow: Flow) {
  const n = (type: string, data: Record<string, unknown>) => {
    const id = newId()
    const clean: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data)) if (v !== undefined && v !== null && v !== '' && v !== false) clean[k] = v
    flow.nodes[id] = { id, type, position: { x: 0, y: 0 }, data: clean }
    return id
  }
  const e = (source: string, target: string, sourceHandle = 'out') => {
    const id = newId()
    flow.edges[id] = { id, source, target, sourceHandle, targetHandle: 'in' }
  }
  const chain = (...ids: string[]) => ids.slice(1).forEach((id, i) => e(ids[i], id))
  return { n, e, chain }
}

/** Same approach as the editor's Auto-layout: dagre, top to bottom, loop edges left out. */
function layout(flow: Flow) {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 56, ranksep: 80, marginx: 0, marginy: 0 })
  g.setDefaultEdgeLabel(() => ({}))
  const loops = analyzeFlow(flow).loopEdges
  for (const id of Object.keys(flow.nodes)) g.setNode(id, { width: 260, height: 130 })
  for (const edge of Object.values(flow.edges)) if (!loops.has(edge.id)) g.setEdge(edge.source, edge.target)
  dagre.layout(g)
  for (const id of Object.keys(flow.nodes)) {
    const p = g.node(id)
    flow.nodes[id].position = { x: Math.round((p.x - p.width / 2) / 8) * 8, y: Math.round((p.y - p.height / 2) / 8) * 8 }
  }
}

function newDemo(name: string, description: string): Project {
  const project = createEmptyProject(name)
  project.meta.description = description
  project.meta.createdAt = CREATED
  project.flows = {}
  return project
}

// =============================================================================
// Demo 1 — The Coffee Order (simple)
// =============================================================================
function coffeeOrder(): Project {
  const project = newDemo(
    'Demo · The Coffee Order',
    'A tiny branching conversation. Shows dialogue, a player choice, a condition, an instruction that spends coins, and a jump that loops back. You start with 3 coins, so ordering the flat white shows the loop back to the menu.'
  )
  const character = createTemplate(newId(), 'Character', 'Character', null, 0, '#818cf8', 'user')
  const bio = prop('Bio', 'longText', 0)
  character.properties[bio.id] = bio
  project.templates[character.id] = character

  const pip = createEntity(newId(), 'Pip the Barista', 'Pip', character.id, null, 0)
  pip.values = { [bio.id]: 'Runs the tiniest café in town. Takes foam art very seriously.' }
  const you = createEntity(newId(), 'You', 'You', character.id, null, 1)
  for (const ent of [pip, you]) project.entities[ent.id] = ent

  variable(project, 'Player', 'Coins', 'number', 0, { defaultValue: 3, min: 0, max: 20, integer: true, description: 'Money in your pocket. Raise it to 4 or more under State and the flat white goes through.' })

  const flow = createFlow(newId(), 'The Order', null, 0)
  const { n, e, chain } = builder(flow)
  const hello = n('dialogue', { isStart: true, speakerId: pip.id, text: 'Morning! What can I get you?', note: 'Start here.' })
  const menu = n('hub', { label: 'The menu', note: 'A hub is a meeting point. With several outputs it offers the player a choice. The jump below loops back to it.' })
  const flat = n('dialogue', { speakerId: you.id, menuText: 'A flat white (4 coins)', text: 'A flat white, please.' })
  const cocoa = n('dialogue', { speakerId: you.id, menuText: 'Hot chocolate (3 coins)', text: 'Hot chocolate. Extra marshmallows.', effects: 'Player.Coins -= 3', note: 'Effects change state as the story passes through.' })
  const water = n('dialogue', { speakerId: you.id, menuText: 'Just water', text: 'Just water, thanks.' })
  const canPay = n('condition', { expression: 'Player.Coins >= 4', note: 'Conditions branch automatically: green is true, red is false.' })
  const pay = n('instruction', { script: 'Player.Coins -= 4', note: 'Instructions change state.' })
  const flatYes = n('dialogue', { speakerId: pip.id, text: 'Four coins. One flat white, with a fern on top.' })
  const short = n('dialogue', { speakerId: pip.id, text: "Ah, you're a little short for that one. Anything else?" })
  const back = n('jump', { targetId: menu, note: 'A jump continues the flow somewhere else: here, back to the menu.' })
  const cocoaYes = n('dialogue', { speakerId: pip.id, text: 'Marshmallow tower, coming right up.' })
  const waterYes = n('dialogue', { speakerId: pip.id, text: 'On the house!' })
  const bye = n('dialogue', { speakerId: pip.id, text: 'Enjoy! See you tomorrow.', isEnd: true })
  chain(hello, menu)
  e(menu, flat)
  e(menu, cocoa)
  e(menu, water)
  chain(flat, canPay)
  e(canPay, pay, 'true')
  e(canPay, short, 'false')
  chain(pay, flatYes, bye)
  chain(short, back)
  chain(cocoa, cocoaYes, bye)
  chain(water, waterYes, bye)
  layout(flow)
  project.flows[flow.id] = flow
  return project
}

// =============================================================================
// Demo 2 — The Midnight Museum Heist (complex)
// =============================================================================
function museumHeist(): Project {
  const project = newDemo(
    'Demo · The Midnight Museum Heist',
    'A crew plans a heist to win back the Jade Monkey. Shows templates, items, character state, relationships, world variables, time phases with rules, requirements that hide used options, loops, and four endings across three flows. Play 1 · The Plan, then 2 · The Heist, then 3 · The Getaway.'
  )
  const fCrew = newId(), fItems = newId(), fPlaces = newId(), fFlows = newId()
  project.folders[fFlows] = createFolder(fFlows, 'The Heist', 'flows', null, 0)
  project.folders[fCrew] = createFolder(fCrew, 'Characters', 'entities', null, 0)
  project.folders[fItems] = createFolder(fItems, 'Items', 'entities', null, 1)
  project.folders[fPlaces] = createFolder(fPlaces, 'Locations', 'entities', null, 2)

  // Templates
  const character = createTemplate(newId(), 'Character', 'Character', null, 0, '#818cf8', 'user')
  const role = prop('Role', 'enum', 0, { options: options('Crew', 'Client', 'Guard') })
  const specialty = prop('Specialty', 'text', 1)
  const nerve = prop('Nerve', 'number', 2, { min: 0, max: 5, integer: true, defaultValue: 3, mutable: true, description: 'Courage under pressure. Drops at dawn.' })
  const colour = prop('Dialogue Colour', 'color', 3, { defaultValue: '#e4e7ef' })
  for (const p of [role, specialty, nerve, colour]) character.properties[p.id] = p
  project.templates[character.id] = character

  const item = createTemplate(newId(), 'Item', 'Item', null, 1, '#fbbf24', 'gem')
  const itemDesc = prop('Description', 'longText', 0)
  const worth = prop('Value', 'number', 1, { min: 0 })
  for (const p of [itemDesc, worth]) item.properties[p.id] = p
  project.templates[item.id] = item

  const location = createTemplate(newId(), 'Location', 'Location', null, 2, '#34d399', 'map')
  const locDesc = prop('Description', 'longText', 0)
  location.properties[locDesc.id] = locDesc
  project.templates[location.id] = location

  // Entities
  let order = 0
  const person = (name: string, tech: string, r: string, spec: string, extra: Record<string, string | number> = {}) => {
    const ent = createEntity(newId(), name, tech, character.id, fCrew, order++)
    ent.values = { [role.id]: optionId(role, r), [specialty.id]: spec, ...extra }
    project.entities[ent.id] = ent
    return ent
  }
  const rook = person('Rook', 'Rook', 'Crew', 'The planner. That is you.')
  const juni = person('Juniper "Juni" Vale', 'Juni', 'Crew', 'Hacker. Can open anything with a keypad.', { [nerve.id]: 2, [colour.id]: '#2dd4bf' })
  const bruno = person('Bruno', 'Bruno', 'Crew', 'Driver. Gentle giant. Hates loud noises.', { [colour.id]: '#fb923c' })
  const vex = person('Madame Vex', 'Vex', 'Client', 'Collector of rare things. Wants the Jade Monkey back.', { [colour.id]: '#c084fc' })
  const gustav = person('Gustav', 'Gustav', 'Guard', 'Night guard. Owns a very nosy cat called Biscuit.', { [colour.id]: '#60a5fa' })

  const thing = (name: string, tech: string, desc: string, value: number) => {
    const ent = createEntity(newId(), name, tech, item.id, fItems, order++)
    ent.values = { [itemDesc.id]: desc, [worth.id]: value }
    project.entities[ent.id] = ent
  }
  thing('Museum Blueprints', 'Blueprints', 'Shows the air vent above the Grand Gallery.', 0)
  thing('Lockpick Set', 'Lockpicks', "Bruno's grandmother's. Do not lose them.", 15)
  thing('Cat Treats', 'CatTreats', 'Salmon flavour. Irresistible to cats.', 2)
  thing('The Jade Monkey', 'JadeMonkey', 'A small jade statue. Priceless, and slightly smug-looking.', 100000)

  const place = (name: string, tech: string, desc: string) => {
    const ent = createEntity(newId(), name, tech, location.id, fPlaces, order++)
    ent.values = { [locDesc.id]: desc }
    project.entities[ent.id] = ent
  }
  place('The Safehouse', 'Safehouse', 'A flat above a laundrette. Smells of fabric softener.')
  place('Museum Roof', 'MuseumRoof', 'Pigeons, skylights and a very good view.')
  place('The Grand Gallery', 'GrandGallery', 'Marble, moonlight, and one jade monkey on a plinth.')
  place('The Getaway Van', 'GetawayVan', 'Painted to look like a flower delivery.')

  // State
  variable(project, 'Heist', 'Alarm', 'number', 0, { defaultValue: 0, min: 0, max: 10, integer: true, description: 'How suspicious the museum is. At 3 or more, the sirens start.' })
  variable(project, 'Heist', 'Has Blueprints', 'boolean', 1, { defaultValue: false })
  variable(project, 'Heist', 'Has Lockpicks', 'boolean', 2, { defaultValue: false })
  variable(project, 'Heist', 'Has Cat Treats', 'boolean', 3, { defaultValue: false })
  variable(project, 'Heist', 'Has Jade Monkey', 'boolean', 4, { defaultValue: false })
  variable(project, 'Player', 'Cash', 'number', 5, { defaultValue: 5, min: 0, integer: true })

  const trust = {
    ...createRelationship(newId(), 'Trust', 'Trust', character.id, character.id, 'number', 0),
    min: -5,
    max: 5,
    integer: true,
    defaultValue: 0,
    description: 'How much one character trusts another. One-way.'
  }
  project.state.relationships[trust.id] = trust
  vex.relations = { [trust.id]: { [rook.id]: -1 } } // Vex has been burned before

  project.state.time.phases = {}
  const phase: Record<string, string> = {}
  ;['Evening', 'Night', 'Midnight', 'Dawn'].forEach((label, i) => {
    const id = newId()
    project.state.time.phases[id] = createPhase(id, label, label, i)
    phase[label] = id
  })
  project.state.time.startPhaseId = phase.Evening
  const patrol = createRule(newId(), 'The midnight patrol', 0)
  Object.assign(patrol, { phaseId: phase.Midnight, condition: 'Heist.Alarm > 0', effects: 'Heist.Alarm += 1' })
  const tired = createRule(newId(), 'Dawn wears everyone down', 1)
  Object.assign(tired, { phaseId: phase.Dawn, forEachTemplateId: character.id, effects: 'self.Nerve -= 1' })
  project.state.rules[patrol.id] = patrol
  project.state.rules[tired.id] = tired

  // --- Flow 1: The Plan ------------------------------------------------------
  const plan = createFlow(newId(), '1 · The Plan', fFlows, 0)
  {
    const { n, e, chain } = builder(plan)
    const start = n('dialogue', { isStart: true, speakerId: vex.id, text: 'The Jade Monkey was mine before the museum "found" it. Bring it back by dawn, and you never pay rent again.' })
    const promise = n('dialogue', { speakerId: rook.id, text: 'Leave it with us, Madame Vex.' })
    const hub = n('hub', { label: 'Get ready', note: 'Each option has a Requires, so it disappears once done. The jumps loop back here.' })
    const askJuni = n('dialogue', { speakerId: rook.id, menuText: 'Ask Juni for the blueprints', text: 'Juni, can you get us into the museum’s plans?', requires: 'not Heist.HasBlueprints' })
    const juniYes = n('dialogue', { speakerId: juni.id, text: 'Already done. There’s an air vent right above the Grand Gallery.', effects: 'Heist.HasBlueprints = true\nJuni->Rook.Trust += 1' })
    const coffee = n('dialogue', { speakerId: rook.id, menuText: 'Buy Juni a coffee (1 cash)', text: 'Flat white, extra shot. You’ve earned it.', requires: 'Juni->Rook.Trust < 2 and Player.Cash >= 1', effects: 'Player.Cash -= 1\nJuni->Rook.Trust += 1' })
    const coffeeYes = n('dialogue', { speakerId: juni.id, text: 'Okay. You’re officially my favourite criminal.' })
    const askBruno = n('dialogue', { speakerId: rook.id, menuText: 'Ask Bruno for lockpicks', text: 'Bruno, we’ll need your lockpicks.', requires: 'not Heist.HasLockpicks' })
    const brunoYes = n('dialogue', { speakerId: bruno.id, text: 'Grandma’s set. Bring them back, or she’ll find you. She always finds you.', effects: 'Heist.HasLockpicks = true' })
    const pep = n('dialogue', { speakerId: rook.id, menuText: 'Give Bruno a pep talk', text: 'Bruno. Best driver in the city. Tonight is going to be easy.', requires: 'Bruno.Nerve < 4' })
    const pepYes = n('dialogue', { speakerId: bruno.id, text: '…Yeah. Yeah! Easy!', effects: 'Bruno.Nerve += 1\nBruno->Rook.Trust += 1' })
    const shop = n('dialogue', { speakerId: rook.id, menuText: 'Buy cat treats (2 cash)', text: 'The guard has a cat, apparently. One packet of salmon treats, please.', requires: 'not Heist.HasCatTreats and Player.Cash >= 2', effects: 'Player.Cash -= 2\nHeist.HasCatTreats = true' })
    const ready = n('dialogue', { speakerId: rook.id, menuText: 'We’re ready. Let’s go.', text: 'Right. Everyone in the van.' })
    const check = n('condition', { expression: 'Heist.HasBlueprints and Heist.HasLockpicks', note: 'You need both the blueprints and the lockpicks to leave.' })
    const notYet = n('dialogue', { speakerId: juni.id, text: 'Without the blueprints and the lockpicks? Bold. Also no.' })
    const go = n('instruction', { script: 'advance to Night', note: 'Time moves only through advance.' })
    const end = n('dialogue', { speakerId: bruno.id, text: 'Seatbelts, everyone. Next stop: the museum roof.', isEnd: true, note: 'Continue with 2 · The Heist.' })
    const pair = (a: string, b: string) => {
      chain(a, b)
      return b
    }
    chain(start, promise, hub)
    for (const option of [askJuni, coffee, askBruno, pep, shop, ready]) e(hub, option)
    for (const tail of [pair(askJuni, juniYes), pair(coffee, coffeeYes), pair(askBruno, brunoYes), pair(pep, pepYes), shop]) {
      e(tail, n('jump', { targetId: hub }))
    }
    chain(ready, check)
    e(check, go, 'true')
    e(check, notYet, 'false')
    chain(go, end)
    e(notYet, n('jump', { targetId: hub }))
    layout(plan)
  }
  project.flows[plan.id] = plan

  // --- Flow 2: The Heist -----------------------------------------------------
  const heist = createFlow(newId(), '2 · The Heist', fFlows, 1)
  {
    const { n, e, chain } = builder(heist)
    const start = n('dialogue', { isStart: true, text: 'The museum roof. Pigeons. A skylight. Somewhere below, a cat is purring.', requires: 'Time.Phase is Night' })
    const vent = n('dialogue', { speakerId: juni.id, text: 'The vent’s exactly where the blueprints said. In we go.' })
    const gallery = n('dialogue', { text: 'The Grand Gallery. Gustav dozes in a chair. His cat, Biscuit, sits on the plinth beside the Jade Monkey, staring at you.' })
    const treats = n('dialogue', { speakerId: rook.id, menuText: 'Roll a cat treat across the floor', text: 'Here, Biscuit. Salmon. Your favourite.', requires: 'Heist.HasCatTreats', effects: 'Heist.HasCatTreats = false' })
    const treatsOk = n('dialogue', { text: 'Biscuit pounces on the treat and forgets you exist. Silent as a shadow.' })
    const sneak = n('dialogue', { speakerId: rook.id, menuText: 'Tiptoe past Biscuit', text: 'Easy… easy…' })
    const sneakBad = n('dialogue', { text: 'Biscuit yowls. Gustav snorts in his sleep. Somewhere, a light blinks red.', effects: 'Heist.Alarm += 2' })
    const talk = n('dialogue', { speakerId: rook.id, menuText: 'Wake Gustav and bluff', text: 'Evening! Pest control. We had reports of a… monkey.' })
    const bluff = n('condition', { expression: 'Juni->Rook.Trust >= 2', note: 'The bluff only works if Juni trusts you enough to play along. Buying her a coffee in The Plan helps.' })
    const bluffOk = n('dialogue', { speakerId: juni.id, text: 'Very dangerous monkey. We’ll take it from here, sir.' })
    const bluffOk2 = n('dialogue', { speakerId: gustav.id, text: 'Oh! Right. Mind Biscuit, she bites.', effects: 'Gustav->Rook.Trust += 1' })
    const bluffBad = n('dialogue', { speakerId: gustav.id, text: 'Pest control? At midnight? I’m calling my supervisor.', effects: 'Heist.Alarm += 3' })
    const grab = n('instruction', { script: 'Heist.HasJadeMonkey = true\nadvance to Midnight', note: 'Advancing to Midnight runs “The midnight patrol”: any alarm at all gets worse.' })
    const got = n('dialogue', { speakerId: rook.id, text: 'Got it. Everyone out. Now.', isEnd: true, note: 'Continue with 3 · The Getaway.' })
    chain(start, vent, gallery)
    e(gallery, treats)
    e(gallery, sneak)
    e(gallery, talk)
    chain(treats, treatsOk, grab)
    chain(sneak, sneakBad, grab)
    chain(talk, bluff)
    e(bluff, bluffOk, 'true')
    e(bluff, bluffBad, 'false')
    chain(bluffOk, bluffOk2, grab)
    chain(bluffBad, grab)
    chain(grab, got)
    layout(heist)
  }
  project.flows[heist.id] = heist

  // --- Flow 3: The Getaway ---------------------------------------------------
  const away = createFlow(newId(), '3 · The Getaway', fFlows, 2)
  {
    const { n, e, chain } = builder(away)
    const start = n('condition', { isStart: true, expression: 'Heist.Alarm >= 3', requires: 'Heist.HasJadeMonkey', note: 'Three or more alarm points and the sirens start.' })
    const sirens = n('dialogue', { speakerId: bruno.id, text: 'Sirens! Why is it always sirens?' })
    const nerveCheck = n('condition', { expression: 'Bruno.Nerve >= 4', note: 'Bruno’s nerve decides the chase. A pep talk in The Plan helps.' })
    const escape = n('dialogue', { speakerId: bruno.id, text: 'Hold on to something! Left, right, through the car wash… and we’re clear!', effects: 'advance to Dawn' })
    const closeShave = n('dialogue', { text: 'CLOSE SHAVE. The van smells of soap and victory. You deliver the Jade Monkey at sunrise.', isEnd: true, note: 'Ending 1 of 4.' })
    const panic = n('dialogue', { speakerId: bruno.id, text: 'I can’t, I can’t, I CAN’T—', effects: 'Bruno.Nerve -= 1' })
    const caught = n('dialogue', { text: 'CAUGHT. The van stalls outside the museum. Biscuit watches from the window, deeply satisfied.', isEnd: true, note: 'Ending 2 of 4.' })
    const quiet = n('dialogue', { speakerId: juni.id, text: 'Not a single siren. We’re ghosts.', effects: 'advance to Dawn' })
    const vexMeet = n('dialogue', { speakerId: vex.id, text: 'The Jade Monkey. Hand it over, darling, and the rent is gone forever.' })
    const give = n('dialogue', { speakerId: rook.id, menuText: 'Hand it to Madame Vex', text: 'A deal’s a deal.', effects: 'Vex->Rook.Trust += 3\nPlayer.Cash += 50' })
    const clean = n('dialogue', { text: 'CLEAN GETAWAY. No rent, ever again. Bruno buys everyone pancakes.', isEnd: true, note: 'Ending 3 of 4.' })
    const giveBack = n('dialogue', { speakerId: rook.id, menuText: 'Return it to the museum', text: 'Actually… the museum is free on Sundays. Everyone should get to see it.', requires: 'Gustav->Rook.Trust >= 1', note: 'Only offered if Gustav fell for the bluff.' })
    const robin = n('dialogue', { text: 'ROBIN HOOD. The Jade Monkey is back on its plinth by Monday. Gustav swears he saw Biscuit wink.', isEnd: true, note: 'Ending 4 of 4.' })
    e(start, sirens, 'true')
    e(start, quiet, 'false')
    chain(sirens, nerveCheck)
    e(nerveCheck, escape, 'true')
    e(nerveCheck, panic, 'false')
    chain(escape, closeShave)
    chain(panic, caught)
    chain(quiet, vexMeet)
    e(vexMeet, give)
    e(vexMeet, giveBack)
    chain(give, clean)
    chain(giveBack, robin)
    layout(away)
  }
  project.flows[away.id] = away
  return project
}

mkdirSync(OUT, { recursive: true })
writeFileSync(`${OUT}/coffee-order.skein.json`, serializeProject(coffeeOrder()))
writeFileSync(`${OUT}/museum-heist.skein.json`, serializeProject(museumHeist()))
console.log(`Wrote ${OUT}/coffee-order.skein.json and ${OUT}/museum-heist.skein.json`)
