import { produce } from 'immer'
import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { buildExport } from '../export/build'
import { SkeinStory, SkeinWorld } from '../export/runtime'
import { parseProject } from '../parse'
import type { Project } from '../schema'
import { validateProject } from '../validate'
import { applyRename } from './sites'
import { parseTemplate, placeholderSources, replacePlaceholder } from './template'

function coffee(): Project {
  const r = parseProject(readFileSync('src/renderer/src/demos/coffee-order.skein.json', 'utf8'))
  if (!r.ok) throw new Error(r.error)
  return r.project
}
const flowOf = (p: Project) => Object.values(p.flows)[0]
const byText = (p: Project, start: string) => Object.values(flowOf(p).nodes).find((n) => String(n.data.text ?? '').startsWith(start))!

describe('variables inside lines', () => {
  it('splits text, braces and placeholders', () => {
    expect(placeholderSources('You have {Player.Coins} coins, {{not this}} and { Player.Coins }.')).toEqual(['Player.Coins'])
    const { problems } = parseTemplate('Oops {} and } and {')
    expect(problems.map((p) => p.message)).toEqual([
      'Empty braces: put a value inside, such as {Player.Coins}.',
      'A “}” has no matching “{”. Write }} for a literal brace.',
      'A “{” has no matching “}”. Write {{ for a literal brace.'
    ])
    expect(replacePlaceholder('a {X.Y} b {Z.W}', 1, 'Q.R')).toBe('a {X.Y} b {Q.R}')
  })

  it('fills placeholders as the line plays, with labels for options and names for entities', () => {
    const p = produce(coffee(), (d) => {
      const hello = byText(d as Project, 'Morning!')
      hello.data.text = 'Morning! You have {Player.Coins} coins, {Player.Coins / 4} flat whites, {{braces}} and {Nobody.Here}.'
    })
    const { file, problems } = buildExport(p)
    expect(problems.map((x) => x.message)).toEqual([expect.stringMatching(/\{Nobody\.Here\}: There’s nothing called “Nobody”/)])
    expect(file.version).toBeGreaterThanOrEqual(4) // variables inside lines (v4); the demo's priced hub also needs v5
    const beat = new SkeinStory(new SkeinWorld(file), flowOf(p).id).start()
    if (beat.kind !== 'line') throw new Error('expected a line')
    expect(beat.text).toBe('Morning! You have 5 coins, 1.25 flat whites, {braces} and {Nobody.Here}.')
    expect(beat.lineId).toMatch(/^ORDER_[0-9a-f]{6}$/)
  })

  it('formats numbers the same way everywhere', () => {
    const w = new SkeinWorld(buildExport(coffee()).file)
    const f = (n: number) => w.format({ lit: n }, n)
    expect([3, 2.5, 1 / 3, 2 / 3, -1.234, 0.1 + 0.2, 1.005].map(f)).toEqual(['3', '2.5', '0.33', '0.67', '-1.23', '0.3', '1'])  // 1.005 is 1.00499… as a double
  })

  it('checks placeholders as you type, and follows renames', () => {
    const p = produce(coffee(), (d) => {
      byText(d as Project, 'Morning!').data.text = 'Coins: {Player.Coin} and {Player.Coins} and {'
    })
    const issues = validateProject(p).get(byText(p, 'Coins:').id) ?? []
    expect(issues.map((i) => i.message)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^Line: .*Coin/), 'Line: A “{” has no matching “}”. Write {{ for a literal brace.'])
    )
    const q = produce(coffee(), (d) => {
      byText(d as Project, 'Morning!').data.text = '{Player.Coins} then {Player.Coins + 1}'
      const v = Object.values(d.state.variables).find((x) => x.technicalName === 'Coins')!
      v.technicalName = 'Money'
      applyRename(d as Project, { kind: 'variable', fromNamespace: 'Player', fromName: 'Coins', toNamespace: 'Player', toName: 'Money' })
    })
    expect(byText(q, '{Player.Money}').data.text).toBe('{Player.Money} then {Player.Money + 1}')
  })

  it('exports line IDs on lines and choices, without raising the format version', () => {
    const plain = produce(coffee(), (d) => {
      for (const n of Object.values(flowOf(d as Project).nodes)) if (typeof n.data.text === 'string') n.data.text = n.data.text.replace(/\{[^}]*\}/g, 'some')
    })
    const { file } = buildExport(plain)
    // Line IDs are extras: stripping them all leaves the version where it was.
    const bare = buildExport(produce(plain, (d) => { for (const n of Object.values(flowOf(d as Project).nodes)) delete n.data.lineId }))
    expect(file.version).toBe(bare.file.version)
    // Choice text lives on the choice (v5), and keeps the `_M` ID it had on the line before it moved.
    const nodes = Object.values(Object.values(file.flows)[0].nodes)
    const hub = nodes.find((n) => 'choices' in n && n.choices?.some((c) => c?.text?.startsWith('A flat white')))!
    if (!('choices' in hub) || !hub.choices) throw new Error()
    const i = hub.choices.findIndex((c) => c?.text?.startsWith('A flat white'))
    const target = Object.values(file.flows)[0].nodes[hub.next[i]]
    if (target.type !== 'dialogue') throw new Error()
    expect(hub.choices[i]?.line).toBe(`${target.line}_M`)
    const story = new SkeinStory(new SkeinWorld(file), Object.values(file.flows)[0].id)
    story.start()
    const menu = story.choose(0)
    expect(menu.kind).toBe('choice')
    if (menu.kind === 'choice') expect(menu.choices.find((c) => c.text.startsWith('A flat white'))?.lineId).toBe(hub.choices[i]?.line)
  })
})
