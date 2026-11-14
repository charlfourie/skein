import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { buildExport } from '@shared/export/build'
import { parseProject } from '@shared/parse'
import { PlaySession } from './playSession'
import { playLog, playLogName } from './playLog'

describe('play log', () => {
  it('reads as a plain transcript with picks, changes and the ending', () => {
    const r = parseProject(readFileSync('src/renderer/src/demos/coffee-order.skein.json', 'utf8'))
    if (!r.ok) throw new Error(r.error)
    const { file } = buildExport(r.project)
    const flowId = Object.keys(file.flows)[0]
    const s = new PlaySession(file, flowId, { seed: 3 })
    s.skipToChoice()
    const flat = s.options().findIndex((o) => o.text.startsWith('A flat white'))
    s.choose(s.options()[flat].index!)
    s.skipToChoice() // your line, then Pip's (which charges you), back to the menu
    const when = new Date(2026, 10, 14, 7, 15)
    const log = playLog(s, { project: 'Coffee', flow: 'The Order', when })
    expect(log).toMatch(/^SKEIN PLAY LOG\nProject: Coffee\nFlow: {4}The Order\nPlayed: {2}2026-11-14 07:15\nStart: {3}seed 3\n/)
    expect(log).toContain('Pip the Barista: Morning! What can I get you?')
    expect(log).toContain('  > A flat white (4 coins)')
    expect(log).toMatch(/Player\.Coins: 5 → 1/)
    expect(log).toContain('… (still playing)')
    expect(log).toContain('Steps:   1 choice, 0 dice')
    expect(playLogName('The Order', when)).toBe('the-order-2026-11-14-0715.log.txt')
  })
})
