/**
 * The shared conformance kit for every Skein runtime (see README.md here).
 *
 * Writes, into runtimes/conformance/fixtures (or the directory given):
 *   - <name>.game.json  an export (the Lighthouse example, plus seeded synthetic exports
 *                       that exercise every operator, statement, node type and coercion edge)
 *   - <name>.trace.txt  what the reference runtime (src/shared/export/runtime.ts) does with it
 *
 * A port is conformant when it produces byte-identical traces from the same exports,
 * by doing exactly the steps in `trace()` below. The fixtures are committed, so a port
 * needs nothing but these files. With --check, nothing is written: it fails if the
 * committed fixtures are out of date (CI runs this).
 *
 *   npx tsx runtimes/conformance/generate.ts [out-dir] [--check]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { SkeinStory, SkeinWorld, type Beat } from '../../src/shared/export/runtime'
import type { ExportFile, ExportNode, ExprNode, StatePath, Statement } from '../../src/shared/export/types'

const args = process.argv.slice(2)
const check = args.includes('--check')
const out = args.find((a) => !a.startsWith('--')) ?? join(__dirname, 'fixtures')

// ---- Deterministic PRNG (generation only; the harness itself uses no randomness) ----
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

// ---- Synthetic export ----
function synth(seed: number): ExportFile {
  const r = rng(seed)
  const int = (n: number) => Math.floor(r() * n)
  const pick = <T,>(xs: readonly T[]): T => xs[int(xs.length)]
  const hex = () => Array.from({ length: 8 }, () => '0123456789abcdef'[int(16)]).join('')

  const phases = ['Dawn', 'Day', 'Dusk', 'Night']
  const chars = ['Keeper', 'Stranger', 'Child', 'Fisher']
  const factions = ['Watch', 'Guild']
  const entities: ExportFile['entities'] = {}
  for (const name of chars)
    entities[name] = {
      id: hex(),
      name: `${name} (shown)`,
      template: 'Character',
      values: { Mood: pick(['Calm', 'Wary', 'Warm']), Energy: int(6), Title: pick(['', 'Sir', '3', 'Dusk']), Brave: r() < 0.5, Ally: pick([...factions, null]) }
    }
  for (const name of factions) entities[name] = { id: hex(), name: `The ${name}`, template: 'Faction', values: { Power: int(10) - 3 } }

  const lits: ExprNode[] = [
    ...[-2, -1, 0, 0.5, 1, 2, 3, 10, 0.1, 7].map((v) => ({ lit: v })),
    { lit: true }, { lit: false }, { lit: null },
    ...['', 'Dusk', 'Night', '3', ' 4 ', 'abc', 'Calm', 'Watch', '0x1f'].map((v) => ({ lit: v }))
  ]
  // Node ids are drawn up front so expressions can read visit counts of nodes in any flow (v2).
  const flowIds = Array.from({ length: 4 }, (_, f) => Array.from({ length: 6 + int(8) }, (_, i) => `f${f}n${i}-${hex()}`))
  const allNodeIds = flowIds.flat()
  const flowKeys = flowIds.map((_, f) => `flow-${f}-${hex()}`)
  const self = () => pick(['$self', ...chars])
  const paths = (writable: boolean): StatePath[] => [
    { get: 'var', var: 'World.Storm' }, { get: 'var', var: 'World.Count' }, { get: 'var', var: 'World.Ratio' },
    { get: 'var', var: 'World.Label' }, { get: 'var', var: 'World.Missing' },
    { get: 'prop', entity: self(), prop: 'Mood' }, { get: 'prop', entity: self(), prop: 'Energy' },
    { get: 'prop', entity: self(), prop: 'Brave' }, { get: 'prop', entity: pick(factions), prop: 'Power' },
    { get: 'prop', entity: self(), prop: 'Title' },
    { get: 'rel', rel: 'Character->Character.Trust', from: self(), to: self() },
    { get: 'rel', rel: 'Character->Faction.Loyal', from: self(), to: pick(factions) },
    ...(writable
      ? []
      : [
          { get: 'time', field: 'day' } as StatePath,
          { get: 'time', field: 'phase' } as StatePath,
          { get: 'time', field: 'hour' } as StatePath,
          { get: 'time', field: 'minute' } as StatePath,
          { get: 'visit', node: pick(allNodeIds) } as StatePath
        ])
  ]
  const ops = ['and', 'or', '==', '!=', '<', '<=', '>', '>=', 'phase<', 'phase<=', 'phase>', 'phase>=', '+', '-', '*', '/'] as const
  const expr = (depth: number): ExprNode => {
    const roll = r()
    if (depth <= 0 || roll < 0.25) return r() < 0.5 ? pick(lits) : pick(paths(false))
    if (roll < 0.29) return r() < 0.5 ? { chance: int(101) } : { roll: [int(5) - 2, int(5) + 3] }
    if (roll < 0.32) return { not: expr(depth - 1) }
    if (roll < 0.38) return { neg: expr(depth - 1) }
    const op = pick(ops)
    if (op.startsWith('phase')) return { op, a: r() < 0.6 ? { get: 'time', field: 'phase' } : expr(depth - 1), b: { lit: pick([...phases, 'Nope', null]) } }
    return { op, a: expr(depth - 1), b: expr(depth - 1) }
  }
  const statement = (allowTime: boolean): Statement => {
    const roll = r()
    if (allowTime && roll < 0.08) return { advance: 1 + int(3) }
    if (allowTime && roll < 0.14) return { advanceTo: pick([...phases, 'Nope']), ...(r() < 0.5 ? { stay: true as const } : {}) }
    if (allowTime && roll < 0.2) return { pass: pick([1 / 60, 0.5, 7, 45, 125.25, 600, 1500]) }
    return { set: pick(paths(true)), op: pick(['=', '+=', '-='] as const), value: expr(2) }
  }
  const effects = (n: number, allowTime: boolean) => ({ do: Array.from({ length: n }, () => statement(allowTime)) })

  // v4: values a line can show. Options show their label, entities their name, the phase its label.
  const placeholderPool: Record<string, () => ExprNode> = {
    Count: () => ({ get: 'var', var: 'World.Count' }),
    Ratio: () => ({ op: '*', a: { get: 'var', var: 'World.Ratio' }, b: { lit: pick([1, 0.3333, -2.5, 1.005, 7]) } }),
    Third: () => ({ op: '/', a: { get: 'var', var: 'World.Count' }, b: { lit: 3 } }),
    Label: () => ({ get: 'var', var: 'World.Label' }),
    Storm: () => ({ get: 'var', var: 'World.Storm' }),
    Missing: () => ({ get: 'var', var: 'World.Missing' }),
    Mood: () => ({ get: 'prop', entity: pick(chars), prop: 'Mood' }),
    Ally: () => ({ get: 'prop', entity: pick(chars), prop: 'Ally' }),
    Trust: () => ({ get: 'rel', rel: 'Character->Character.Trust', from: pick(chars), to: pick(chars) }),
    Phase: () => ({ get: 'time', field: 'phase' }),
    Day: () => ({ get: 'time', field: 'day' }),
    Clock: () => ({ op: '+', a: { get: 'time', field: 'hour' }, b: { op: '/', a: { get: 'time', field: 'minute' }, b: { lit: 60 } } }),
    Text: () => ({ lit: pick(['plain', '{braces}', '']) })
  }

  // Flows: random graphs. Conditions/jumps may loop; the runtimes must then agree on the error.
  const flows: ExportFile['flows'] = {}
  for (let f = 0; f < 4; f++) {
    const ids = flowIds[f]
    const ref = () => (r() < 0.15 ? null : pick(ids))
    const refs = () => Array.from({ length: int(4) }, () => pick(ids))
    const nodes: Record<string, ExportNode> = {}
    for (const id of ids) {
      const counted = r() < 0.45
      const base = {
        id,
        ...(counted ? { count: true as const } : {}),
        // "only once" as the exporter writes it, sometimes combined with a requirement
        ...(counted && r() < 0.4
          ? { requires: { expr: r() < 0.5 ? { op: '==', a: { get: 'visit', node: id }, b: { lit: 0 } } : { op: 'and', a: { op: '<', a: { get: 'visit', node: id }, b: { lit: 2 } }, b: expr(2) } } as ExportNode['requires'] }
          : r() < 0.25 ? { requires: { expr: expr(2) } } : {}),
        ...(r() < 0.3 ? { effects: effects(1 + int(2), r() < 0.3) } : {}),
        ...(r() < 0.35 ? { takes: pick([4 / 60, 0.1, 3, 20, 90, 240.5, 700]) } : {})
      }
      const t = r()
      if (t < 0.45) {
        // v4: line IDs, and variables inside lines (with escapes, unknown and stray braces).
        const vars: Record<string, ExprNode> = {}
        const fill = (base: string) => {
          let text = base
          for (let k = int(4); k > 0; k--) {
            const key = pick(Object.keys(placeholderPool))
            vars[key] = placeholderPool[key]()
            text += pick([` {${key}}`, ` { ${key} }`, `{${key}}.`])
          }
          if (r() < 0.25) text += pick([' {{literal}}', ' }} and {{', ' {Nope}', ' stray } here', ' open { here', ' {}'])
          return text
        }
        const text = fill(`Line ${id}`)
        const menu = r() < 0.3 ? (r() < 0.2 ? '' : fill(`Choose ${id}`)) : undefined
        nodes[id] = {
          ...base,
          type: 'dialogue',
          speaker: pick([...chars, null]),
          text,
          ...(menu !== undefined ? { menuText: menu } : {}),
          ...(r() < 0.8 ? { line: `L_${id}`, ...(menu ? { menuLine: `L_${id}_M` } : {}) } : {}),
          ...(Object.keys(vars).length ? { vars } : {}),
          next: refs()
        }
      }
      else if (t < 0.6) nodes[id] = { ...base, type: 'condition', condition: r() < 0.1 ? null : { expr: expr(3) }, onTrue: ref(), onFalse: ref() }
      else if (t < 0.75) nodes[id] = { ...base, type: 'instruction', instruction: r() < 0.1 ? null : effects(1 + int(3), true), next: refs() }
      else if (t < 0.85) nodes[id] = { ...base, type: 'hub', label: `Hub ${id}`, next: refs() }
      // v2: calls into other flows (including this one, and missing flows), and hand-off jumps.
      else if (t < 0.93) nodes[id] = { ...base, type: 'call', flow: r() < 0.1 ? null : r() < 0.1 ? 'missing-flow' : pick(flowKeys), next: refs() }
      else if (r() < 0.6) nodes[id] = { ...base, type: 'jump', jumpTo: ref() }
      else nodes[id] = { ...base, type: 'jump', jumpTo: null, jumpFlow: r() < 0.1 ? 'missing-flow' : pick(flowKeys) }
    }
    flows[flowKeys[f]] = { id: '', name: `Flow ${f}`, start: [ids[0], pick(ids)], nodes }
  }
  for (const [id, flow] of Object.entries(flows)) flow.id = id

  const rules: ExportFile['state']['rules'] = Array.from({ length: 4 }, (_, i) => ({
    id: hex(),
    name: `Rule ${i}`,
    trigger: i === 0 ? 'day' : pick(['phase', 'phase', 'day'] as const),
    phase: r() < 0.4 ? null : pick(phases),
    forEach: r() < 0.5 ? 'Character' : null,
    ...(r() < 0.35 ? { flow: pick(flowKeys) } : {}),
    ...(r() < 0.6 ? { when: { expr: expr(2) } } : {}),
    effects: effects(1 + int(2), false)
  }))

  return {
    format: 'skein.export',
    version: 4,
    project: { id: hex(), name: `Synthetic ${seed}` },
    templates: {
      Character: {
        id: hex(),
        name: 'Character',
        properties: {
          Mood: { type: 'enum', options: ['Calm', 'Wary', 'Warm'], labels: ['Calm', 'Wary', 'Warm'], default: 'Calm', state: true },
          Energy: { type: 'number', default: 3, min: 0, max: 5, integer: true, state: true },
          Title: { type: 'text', default: '' },
          Brave: { type: 'boolean', default: false, state: true },
          Ally: { type: 'entity', template: 'Faction', default: null }
        }
      },
      Faction: { id: hex(), name: 'Faction', properties: { Power: { type: 'number', default: 0, min: -3, max: 9, state: true } } }
    },
    entities,
    state: {
      variables: {
        'World.Storm': { type: 'boolean', default: true },
        'World.Count': { type: 'number', default: 1, min: -3, max: 7, integer: true },
        'World.Ratio': { type: 'number', default: 0.5 },
        'World.Label': { type: 'text', default: 'Dusk' }
      },
      relationships: {
        'Character->Character.Trust': {
          name: 'Trust', from: 'Character', to: 'Character', type: 'number', default: 0, min: -5, max: 5, integer: true,
          values: { Keeper: { Stranger: -1, Child: 2 }, Child: { Keeper: 4 } }
        },
        'Character->Faction.Loyal': { name: 'Loyal', from: 'Character', to: 'Faction', type: 'boolean', default: false, values: { Fisher: { Guild: true } } }
      },
      // v3 clock: uneven phase lengths (sometimes absent: the even split), a day start, a start minute.
      time: {
        phases,
        labels: phases.map((p) => `${p} time`),
        start: { day: 1, phase: pick(phases), ...(r() < 0.5 ? { minute: int(90) + 0.25 } : {}) },
        ...(r() < 0.8 ? { minutes: phases.map(() => 30 + int(600) + (r() < 0.3 ? 0.5 : 0)) } : {}),
        ...(r() < 0.8 ? { dayStart: int(1440) } : {})
      },
      rules
    },
    flows
  } as ExportFile
}

// ---- The trace: every step here is mirrored in Program.cs ----
const json = (v: unknown) => JSON.stringify(v === undefined ? null : v)

function collect(file: ExportFile) {
  const conds: ExprNode[] = []
  const stmts: Statement[] = []
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk)
    if (!v || typeof v !== 'object') return
    const o = v as Record<string, unknown>
    if ('expr' in o && o.expr && typeof o.expr === 'object') conds.push(o.expr as ExprNode)
    if (Array.isArray(o.do)) for (const s of o.do) stmts.push(s as Statement)
    for (const k of Object.keys(o).sort()) walk(o[k])
  }
  walk(file)
  return { conds, stmts }
}

function beatLine(b: Beat): string {
  if (b.kind === 'end') return `END ${b.node?.id ?? '-'}`
  const choices = b.choices.map((c) => `${c.index}:${c.node}:${c.text}#${c.lineId ?? '-'}`).join(' | ')
  if (b.kind === 'line') return `LINE ${b.node.id} ${b.speaker ?? '-'} ${json(b.text)} #${b.lineId ?? '-'} [${choices}]`
  return `CHOICE ${b.node.id} [${choices}]`
}

function trace(file: ExportFile): string {
  const lines: string[] = []
  const { conds, stmts } = collect(file)
  const selves = [null, ...Object.keys(file.entities).sort()]

  // 1. Statement sweep: run each statement, then evaluate every condition for each self.
  {
    const world = new SkeinWorld(file)
    stmts.forEach((s, i) => {
      const self = selves[i % selves.length] ?? undefined
      world.execute(s, self)
      const vals = conds.map((c, j) => json(world.evaluate(c, selves[j % selves.length] ?? undefined)))
      lines.push(`S${i} day=${world.day} phase=${world.phase ?? '-'} s=${world.seconds} ${vals.join(',')}`)
    })
    lines.push(`SAVE ${json(world.save())}`)
    lines.push(...world.log.map((l) => `LOG ${l}`))
  }

  // 2. Playthroughs: every flow, several choice policies, time advancing between beats.
  for (const flowId of Object.keys(file.flows)) {
    for (let seed = 0; seed < 6; seed++) {
      const world = new SkeinWorld(file, undefined, { seed: seed === 0 ? undefined : seed * 2654435761 })
      lines.push(`FLOW ${flowId} seed=${seed}`)
      try {
        const story = new SkeinStory(world, flowId)
        let beat = story.start()
        for (let step = 0; step < 40; step++) {
          lines.push(`${beatLine(beat)} playing=${world.playing ?? '-'} flow=${story.flow.id} depth=${story.calls.length} t=${world.day}/${world.phase ?? '-'}/${world.seconds}/${world.clock.hour}:${world.clock.minute}`)
          if (beat.kind === 'end') break
          if ((step + seed) % 3 === 0) world.advance(1 + (seed % 2))
          const n = beat.choices.length
          beat = story.choose(n === 0 ? 0 : (step * 31 + seed * 17) % n)
        }
      } catch (err) {
        lines.push(`ERROR ${(err as Error).message}`)
      }
      lines.push(`SAVE ${json(world.save())}`)
    }
  }

  // 3. Save/restore round trip.
  {
    const a = new SkeinWorld(file)
    for (const s of stmts.slice(0, 20)) a.execute(s)
    const b = new SkeinWorld(file, JSON.parse(JSON.stringify(a.save())))
    lines.push(`RESTORE ${json(b.save()) === json(a.save())} ${conds.map((c) => json(b.evaluate(c))).join(',')}`)
  }

  // 4. The clock at a phase's exact end, a minute short of it, and across several days.
  for (const back of [0, 1]) {
    const w = new SkeinWorld(file)
    w.pass((w.phaseSeconds(w.phaseIndex) - w.seconds) / 60 - back)
    lines.push(`EDGE${back} ${w.day} ${w.phase ?? '-'} ${w.seconds} ${w.clock.hour}:${w.clock.minute}`)
    w.pass(3 * 1440 + 17.5)
    lines.push(`DAYS${back} ${w.day} ${w.phase ?? '-'} ${w.seconds} ${w.clock.hour}:${w.clock.minute}`)
  }
  return lines.join('\n') + '\n'
}

const fixtures: Record<string, ExportFile> = {
  lighthouse: JSON.parse(readFileSync(join(__dirname, '../../examples/lighthouse-v2.game.json'), 'utf8'))
}
for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) fixtures[`synthetic-${seed}`] = synth(seed)

const files: Record<string, string> = {}
for (const [name, file] of Object.entries(fixtures)) {
  files[`${name}.game.json`] = JSON.stringify(file, null, 2) + '\n'
  files[`${name}.trace.txt`] = trace(file)
}

if (check) {
  const stale = Object.entries(files).filter(([f, text]) => !existsSync(join(out, f)) || readFileSync(join(out, f), 'utf8') !== text)
  const extra = existsSync(out) ? readdirSync(out).filter((f) => /\.(game\.json|trace\.txt)$/.test(f) && !(f in files)) : []
  if (stale.length || extra.length) {
    console.error(`Conformance fixtures are out of date (${[...stale.map(([f]) => f), ...extra].join(', ')}).`)
    console.error('Run: npx tsx runtimes/conformance/generate.ts, and commit the result.')
    process.exit(1)
  }
  console.log(`${Object.keys(fixtures).length} conformance fixtures are up to date.`)
} else {
  mkdirSync(out, { recursive: true })
  for (const [f, text] of Object.entries(files)) writeFileSync(join(out, f), text)
  console.log(`Wrote ${Object.keys(fixtures).length} fixtures to ${out}`)
}
