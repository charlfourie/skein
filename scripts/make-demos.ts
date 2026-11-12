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
import { assignLineIds } from '../src/shared/lineIds'
import type { Flow, Project, PropertyDef } from '../src/shared/schema'
import { serializeProject } from '../src/shared/serialize'

const OUT = 'src/renderer/src/demos'

/**
 * Ids come from a seeded generator, so regenerating a demo only changes what
 * actually changed (random ids would rewrite every line of both files).
 */
function seedIds(seed: number): void {
  let s = seed >>> 0
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }
  const hex = (n: number) => next().toString(16).padStart(8, '0').slice(0, n)
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    configurable: true,
    value: () => `${hex(8)}-${hex(4)}-4${hex(3)}-${((next() & 3) | 8).toString(16)}${hex(3)}-${hex(8)}${hex(4)}`
  })
}
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

/**
 * Minimal graph builder: `n` adds a node (unset fields are dropped), `e` connects two, `chain` connects several.
 * With `ordered`, connections are offered in the order they're made (stored, so layout can't reorder them).
 */
function builder(flow: Flow, ordered = false) {
  const counts = new Map<string, number>()
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
    if (ordered) {
      const k = `${source}|${sourceHandle}`
      flow.edges[id].order = counts.get(k) ?? 0
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
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

/** Every line gets its line ID, as the editor gives them. */
function withLineIds(project: Project): Project {
  assignLineIds(project)
  return project
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
/** Prices on the café menu, in coins. Also used by docs/DEMOS.md. */
export const COFFEE_PRICES = { flatWhite: 4, hotChocolate: 3, biscuit: 1, tip: 1, bigTip: 3 } as const

const coins = (n: number) => `${n} coin${n === 1 ? '' : 's'}`

function coffeeOrder(): Project {
  const p = COFFEE_PRICES
  const project = newDemo(
    'Demo · The Coffee Order',
    `A tiny branching conversation about spending coins. You start with 5 coins (shown at the top of the Play panel). Order anything on the menu: a condition checks you can pay, and if you can't, Pip tells you what it costs and how much you have, and you pick again. Water is always free. After each order Pip asks "anything else?" and the jump loops back to the menu. On the way out there's a tip jar, with the same check if you offer more than you have.`
  )
  const character = createTemplate(newId(), 'Character', 'Character', null, 0, '#818cf8', 'user')
  const bio = prop('Bio', 'longText', 0)
  character.properties[bio.id] = bio
  project.templates[character.id] = character

  const pip = createEntity(newId(), 'Pip the Barista', 'Pip', character.id, null, 0)
  pip.values = { [bio.id]: 'Runs the tiniest café in town. Takes foam art very seriously.' }
  const you = createEntity(newId(), 'You', 'You', character.id, null, 1)
  for (const ent of [pip, you]) project.entities[ent.id] = ent

  variable(project, 'Player', 'Coins', 'number', 0, {
    defaultValue: 5,
    min: 0,
    max: 20,
    integer: true,
    showInPlay: true,
    description: 'Money in your pocket. Shown at the top of the Play panel. Change the starting value to see what Pip says when you come up short.'
  } as Partial<PropertyDef>)
  variable(project, 'Player', 'Items Bought', 'number', 1, { defaultValue: 0, min: 0, integer: true, showInPlay: true, description: 'How many things you ordered.' } as Partial<PropertyDef>)

  const flow = createFlow(newId(), 'The Order', null, 0)
  const { n, e, chain } = builder(flow, true)
  const hello = n('dialogue', { isStart: true, speakerId: pip.id, text: 'Morning! What can I get you?', note: 'Start here. Open Play (the triangle in the toolbar) and watch Coins at the top of the panel.' })
  const menu = n('hub', { label: 'The menu', note: 'A hub with several outputs offers a choice. Everything is on offer whatever you can afford: the condition after each order checks the coins.' })
  const again = n('dialogue', {
    speakerId: pip.id,
    text: 'Anything else? You’ve got {Player.Coins} left.',
    note: 'Braces show a value in the line as it plays: {Player.Coins} becomes the coins you have now. Try it in Play.'
  })
  const loop = n('jump', { targetId: menu, note: 'A jump continues the flow somewhere else: here, back to the menu, so you can keep ordering until the coins run out.' })
  const retry = n('jump', { targetId: menu, note: 'Not enough coins: back to the menu to pick something else. Nothing was spent.' })

  /** A priced order: pick it, check the coins, then Pip serves it (and takes the coins) or says you're short. */
  const buy = (tag: string, menuText: string, text: string, price: number, reply: string, short: string) => {
    const pick = n('dialogue', {
      speakerId: you.id,
      menuText: `${menuText} (${coins(price)})`,
      text,
      requires: `not Seen.${tag}`,
      note: `Offered until Pip has told you it's too dear: coins only go down, so asking again wouldn't change her answer (and Explore can see every path ends).`
    })
    const check = n('condition', { expression: `Player.Coins >= ${price}`, note: `Can you pay ${coins(price)}? True serves it, false sends you back to the menu.` })
    const answer = n('dialogue', {
      speakerId: pip.id,
      text: reply,
      effects: `Player.Coins -= ${price}\nPlayer.ItemsBought += 1`,
      note: 'Effects spend the coins as the story passes through, so only once the check has passed.'
    })
    const tooDear = n('dialogue', { speakerId: pip.id, text: short, tag })
    chain(pick, check)
    e(check, answer, 'true')
    e(check, tooDear, 'false')
    chain(answer, again)
    chain(tooDear, retry)
    return pick
  }
  const flat = buy('FlatWhiteTooDear', 'A flat white', 'A flat white, please.', p.flatWhite, 'One flat white, with a fern on top.', `A flat white's ${coins(p.flatWhite)}, and you've got {Player.Coins}. Something a bit cheaper?`)
  const cocoa = buy('CocoaTooDear', 'Hot chocolate', 'Hot chocolate. Extra marshmallows.', p.hotChocolate, 'Marshmallow tower, coming right up.', `Hot chocolate's ${coins(p.hotChocolate)}. You've only got {Player.Coins}, love. Anything else take your fancy?`)
  const biscuit = buy('BiscuitTooDear', 'A ginger biscuit', 'And one of those ginger biscuits.', p.biscuit, 'Last one in the jar. Lucky you.', "Biscuits are a coin each, and your pockets are empty. Water's free, though.")
  const water = n('dialogue', { speakerId: you.id, menuText: 'Just water (free)', text: 'Just water, thanks.', once: true, note: 'Free, so you are never stuck with nothing to pick. Only once: after a glass it leaves the menu, so every path ends (Explore checks this).' })
  const waterYes = n('dialogue', { speakerId: pip.id, text: 'On the house!' })
  const done = n('dialogue', { speakerId: you.id, menuText: "That's everything", text: "That's everything, thanks." })

  // Leaving: the tip jar, only if you've a coin left.
  const canTip = n('condition', { expression: `Player.Coins >= ${p.tip}`, note: 'Conditions branch automatically: green is true, red is false.' })
  const tipAsk = n('dialogue', { speakerId: pip.id, text: 'There\'s a tip jar by the till, if you like.' })
  const jar = n('hub', { label: 'The tip jar', note: 'A hub of its own, so offering more than you have can come back here without Pip asking twice.' })
  const tip = n('dialogue', { speakerId: you.id, menuText: `Drop a coin in the jar (${coins(p.tip)})`, text: 'Here you go.', note: 'You only get here with a coin or more, so this one needs no check.' })
  const tipThanks = n('dialogue', { speakerId: pip.id, text: 'You\'re a star. Next foam fern is extra leafy.', effects: `Player.Coins -= ${p.tip}`, isEnd: true })
  const bigTip = n('dialogue', { speakerId: you.id, menuText: `Drop in a handful (${coins(p.bigTip)})`, text: 'Keep the change. All of it.', requires: 'not Seen.TipTooBig' })
  const canBigTip = n('condition', { expression: `Player.Coins >= ${p.bigTip}`, note: `Can you spare ${coins(p.bigTip)}? If not, Pip says so and you choose again.` })
  const bigThanks = n('dialogue', { speakerId: pip.id, text: 'Three whole coins? Free refills for life.', effects: `Player.Coins -= ${p.bigTip}`, isEnd: true })
  const bigShort = n('dialogue', { speakerId: pip.id, text: "That's sweet, but you've only got {Player.Coins}. A coin's plenty, honestly.", tag: 'TipTooBig' })
  const backToJar = n('jump', { targetId: jar, note: 'Back to the tip jar to choose again.' })
  const noTip = n('dialogue', { speakerId: you.id, menuText: 'Not today', text: 'Not today, sorry.' })
  const bye = n('dialogue', { speakerId: pip.id, text: 'Enjoy! See you tomorrow.', isEnd: true })
  const broke = n('dialogue', { speakerId: pip.id, text: 'Pockets empty? Come back tomorrow, I\'ll save you a biscuit.', isEnd: true })

  chain(hello, menu)
  for (const option of [flat, cocoa, biscuit, water, done]) e(menu, option)
  chain(water, waterYes, again)
  chain(again, loop)
  chain(done, canTip)
  e(canTip, tipAsk, 'true')
  e(canTip, broke, 'false')
  chain(tipAsk, jar)
  for (const option of [tip, bigTip, noTip]) e(jar, option)
  chain(tip, tipThanks)
  chain(bigTip, canBigTip)
  e(canBigTip, bigThanks, 'true')
  e(canBigTip, bigShort, 'false')
  chain(bigShort, backToJar)
  chain(noTip, bye)
  layout(flow)
  // A comment thread, as a teammate might leave one (select the tip-jar line to read it).
  const c1 = newId()
  const c2 = newId()
  flow.comments = {
    [c1]: { id: c1, nodeId: tipAsk, author: 'Sam', text: 'Should Pip mention the jar before you order instead?', createdAt: CREATED },
    [c2]: { id: c2, nodeId: tipAsk, parentId: c1, author: 'Alex', text: 'Keep it at the end: it only shows up when you have a coin left.', createdAt: CREATED }
  }
  project.flows[flow.id] = flow

  // Story tests: open the Play panel's Tests tab to see them. They re-run after every edit.
  const oneCoin = newId()
  project.scenarios = { [oneCoin]: { id: oneCoin, name: 'Only 1 coin', order: 0, setup: 'Player.Coins = 1' } }
  const t1 = newId()
  const t2 = newId()
  const t3 = newId()
  const t4 = newId()
  const t5 = newId()
  project.tests = {
    [t1]: {
      id: t1,
      name: 'A flat white, no tip',
      order: 0,
      flowId: flow.id,
      scenarioId: null,
      kind: 'play',
      route: [{ choose: flat }, { choose: done }, { choose: noTip }],
      stopsAt: bye,
      ends: true,
      checks: `Player.Coins == ${5 - p.flatWhite}\nPlayer.ItemsBought == 1`
    },
    [t2]: { id: t2, name: 'Every order ends, nothing is unreachable', order: 1, flowId: flow.id, scenarioId: null, kind: 'explore', allEnd: true, allReached: true, checks: 'Player.Coins >= 0' },
    [t3]: {
      id: t3,
      name: 'With 1 coin you can still tip',
      order: 2,
      flowId: flow.id,
      scenarioId: oneCoin,
      kind: 'explore',
      allEnd: true,
      reach: [tipThanks],
      checks: 'Player.ItemsBought <= 1'
    },
    [t4]: {
      id: t4,
      name: 'Too short for a flat white: Pip says so, nothing is spent',
      order: 3,
      flowId: flow.id,
      scenarioId: oneCoin,
      kind: 'play',
      route: [{ choose: flat }, { choose: biscuit }, { choose: done }],
      stopsAt: broke,
      ends: true,
      checks: 'Player.Coins == 0\nPlayer.ItemsBought == 1'
    },
    [t5]: {
      id: t5,
      name: 'Offering more tip than you have: back to the jar',
      order: 4,
      flowId: flow.id,
      scenarioId: null,
      kind: 'play',
      route: [{ choose: flat }, { choose: done }, { choose: bigTip }, { choose: tip }],
      stopsAt: tipThanks,
      ends: true,
      checks: 'Player.Coins == 0'
    }
  }
  return project
}

// =============================================================================
// Demo 2 — The Midnight Museum Heist (complex)
// =============================================================================
function museumHeist(): Project {
  const project = newDemo(
    'Demo · The Midnight Museum Heist',
    'A crew plans a heist to win back the Jade Monkey. Shows templates, items, character state, relationships, world variables, time phases with rules, requirements that hide used options or lock what you can’t afford, a coin budget shown in Play, loops, and five endings across three flows. Play 1 · The Plan, then 2 · The Heist, then 3 · The Getaway.'
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
  variable(project, 'Heist', 'Alarm', 'number', 0, { defaultValue: 0, min: 0, max: 10, integer: true, showInPlay: true, description: 'How suspicious the museum is. At 3 or more, the sirens start.' } as Partial<PropertyDef>)
  variable(project, 'Heist', 'Has Blueprints', 'boolean', 1, { defaultValue: false })
  variable(project, 'Heist', 'Has Lockpicks', 'boolean', 2, { defaultValue: false })
  variable(project, 'Heist', 'Has Cat Treats', 'boolean', 3, { defaultValue: false })
  variable(project, 'Heist', 'Has Jade Monkey', 'boolean', 4, { defaultValue: false })
  variable(project, 'Player', 'Coins', 'number', 5, { defaultValue: 5, min: 0, integer: true, showInPlay: true, description: 'The crew budget. Shown at the top of the Play panel. You cannot afford everything: choose what matters.' } as Partial<PropertyDef>)

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
    const coffee = n('dialogue', { speakerId: rook.id, menuText: 'Buy Juni a coffee (1 coin)', text: 'Flat white, extra shot. You’ve earned it.', requires: 'Juni->Rook.Trust < 2 and Player.Coins >= 1', effects: 'Player.Coins -= 1\nJuni->Rook.Trust += 1' })
    const coffeeYes = n('dialogue', { speakerId: juni.id, text: 'Okay. You’re officially my favourite criminal.' })
    const askBruno = n('dialogue', { speakerId: rook.id, menuText: 'Ask Bruno for lockpicks', text: 'Bruno, we’ll need your lockpicks.', requires: 'not Heist.HasLockpicks' })
    const brunoYes = n('dialogue', { speakerId: bruno.id, text: 'Grandma’s set. Bring them back, or she’ll find you. She always finds you.', effects: 'Heist.HasLockpicks = true' })
    const pep = n('dialogue', { speakerId: rook.id, menuText: 'Give Bruno a pep talk', text: 'Bruno. Best driver in the city. Tonight is going to be easy.', requires: 'Bruno.Nerve < 4' })
    const pepYes = n('dialogue', { speakerId: bruno.id, text: '…Yeah. Yeah! Easy!', effects: 'Bruno.Nerve += 1\nBruno->Rook.Trust += 1' })
    const shop = n('dialogue', { speakerId: rook.id, menuText: 'Buy cat treats (2 coins)', text: 'The guard has a cat, apparently. One packet of salmon treats, please.', requires: 'not Heist.HasCatTreats and Player.Coins >= 2', effects: 'Player.Coins -= 2\nHeist.HasCatTreats = true' })
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
    const bribe = n('dialogue', { speakerId: rook.id, menuText: 'Slip Gustav a bribe (4 coins)', text: 'Gustav. Wake up. Fancy a very long tea break?', requires: 'Player.Coins >= 4', effects: 'Player.Coins -= 4', note: 'Only offered with 4+ coins. With 5 to start, buying treats or coffee in The Plan makes this unaffordable.' })
    const bribeOk = n('dialogue', { speakerId: gustav.id, text: 'Tea break. Twenty minutes. I saw nothing. Biscuit saw nothing.', effects: 'Gustav->Rook.Trust += 1' })
    const grab = n('instruction', { script: 'Heist.HasJadeMonkey = true\nadvance to Midnight', note: 'Advancing to Midnight runs “The midnight patrol”: any alarm at all gets worse.' })
    const got = n('dialogue', { speakerId: rook.id, text: 'Got it. Everyone out. Now.', isEnd: true, note: 'Continue with 3 · The Getaway.' })
    chain(start, vent, gallery)
    e(gallery, treats)
    e(gallery, sneak)
    e(gallery, talk)
    e(gallery, bribe)
    chain(bribe, bribeOk, grab)
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
    const chase = n('dialogue', { speakerId: juni.id, text: 'There’s a car wash on the corner. For a couple of coins they’ll hide us in the tunnel.' })
    const hide = n('dialogue', { speakerId: rook.id, menuText: 'Pay the car wash (2 coins)', text: 'Two coins. Deluxe wax, and take your time.', requires: 'Player.Coins >= 2', effects: 'Player.Coins -= 2\nadvance to Dawn', note: 'Only offered with 2+ coins: a guaranteed escape.' })
    const hidden = n('dialogue', { text: 'HIDDEN IN PLAIN SUDS. The police roar past the car wash. You stroll out at dawn, very clean, Jade Monkey in hand.', isEnd: true, note: 'Ending 5 of 5.' })
    const drive = n('dialogue', { speakerId: rook.id, menuText: 'Floor it, Bruno', text: 'No time. Floor it!' })
    const nerveCheck = n('condition', { expression: 'Bruno.Nerve >= 4', note: 'Bruno’s nerve decides the chase. A pep talk in The Plan helps.' })
    const escape = n('dialogue', { speakerId: bruno.id, text: 'Hold on to something! Left, right, through the car wash… and we’re clear!', effects: 'advance to Dawn' })
    const closeShave = n('dialogue', { text: 'CLOSE SHAVE. The van smells of soap and victory. You deliver the Jade Monkey at sunrise.', isEnd: true, note: 'Ending 1 of 5.' })
    const panic = n('dialogue', { speakerId: bruno.id, text: 'I can’t, I can’t, I CAN’T—', effects: 'Bruno.Nerve -= 1' })
    const caught = n('dialogue', { text: 'CAUGHT. The van stalls outside the museum. Biscuit watches from the window, deeply satisfied.', isEnd: true, note: 'Ending 2 of 5.' })
    const quiet = n('dialogue', { speakerId: juni.id, text: 'Not a single siren. We’re ghosts.', effects: 'advance to Dawn' })
    const vexMeet = n('dialogue', { speakerId: vex.id, text: 'The Jade Monkey. Hand it over, darling, and the rent is gone forever.' })
    const give = n('dialogue', { speakerId: rook.id, menuText: 'Hand it to Madame Vex', text: 'A deal’s a deal.', effects: 'Vex->Rook.Trust += 3\nPlayer.Coins += 50' })
    const clean = n('dialogue', { text: 'CLEAN GETAWAY. No rent, ever again. Bruno buys everyone pancakes.', isEnd: true, note: 'Ending 3 of 5.' })
    const giveBack = n('dialogue', { speakerId: rook.id, menuText: 'Return it to the museum', text: 'Actually… the museum is free on Sundays. Everyone should get to see it.', requires: 'Gustav->Rook.Trust >= 1', note: 'Only offered if Gustav fell for the bluff.' })
    const robin = n('dialogue', { text: 'ROBIN HOOD. The Jade Monkey is back on its plinth by Monday. Gustav swears he saw Biscuit wink.', isEnd: true, note: 'Ending 4 of 5.' })
    e(start, sirens, 'true')
    e(start, quiet, 'false')
    chain(sirens, chase)
    e(chase, hide)
    e(chase, drive)
    chain(hide, hidden)
    chain(drive, nerveCheck)
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

  // Story tests: every path through the getaway ends, from a loud escape and a quiet one.
  const loud = newId()
  const quiet = newId()
  project.scenarios = {
    [loud]: { id: loud, name: 'Loud: alarm at 3', order: 0, setup: 'Heist.HasJadeMonkey = true\nHeist.Alarm = 3' },
    [quiet]: { id: quiet, name: 'Quiet: no alarm, Gustav fooled', order: 1, setup: 'Heist.HasJadeMonkey = true\nGustav->Rook.Trust = 1' }
  }
  const ending = (prefix: string) => Object.values(away.nodes).find((x) => String(x.data.text).startsWith(prefix))!.id
  const t1 = newId()
  const t2 = newId()
  project.tests = {
    [t1]: { id: t1, name: 'Sirens: every path ends, never below 0 coins', order: 0, flowId: away.id, scenarioId: loud, kind: 'explore', allEnd: true, checks: 'Player.Coins >= 0' },
    [t2]: { id: t2, name: 'Quiet: both endings are reachable', order: 1, flowId: away.id, scenarioId: quiet, kind: 'explore', allEnd: true, reach: [ending('CLEAN'), ending('ROBIN')].sort(), checks: 'Time.Phase is Dawn' }
  }
  return project
}

mkdirSync(OUT, { recursive: true })
seedIds(1)
writeFileSync(`${OUT}/coffee-order.skein.json`, serializeProject(withLineIds(coffeeOrder())))
seedIds(2)
writeFileSync(`${OUT}/museum-heist.skein.json`, serializeProject(withLineIds(museumHeist())))
console.log(`Wrote ${OUT}/coffee-order.skein.json and ${OUT}/museum-heist.skein.json`)
