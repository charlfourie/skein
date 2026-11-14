import { describe, expect, it } from 'vitest'
import { buildExport } from './export/build'
import { SkeinStory, SkeinWorld, type Beat } from './export/runtime'
import { createEmptyProject, createFlow } from './factory'
import { scriptOf } from './script'
import type { Project } from './schema'

/**
 * "Hi." → hub "Talk": 1 "Tell a joke" (only once) → back to the hub, 2 "Leave" (only once) → "Bye."
 * The hub's fallback, when given, goes to "I've heard enough jokes."
 */
function project(opts: { fallback?: boolean; onceLeave?: boolean } = {}): Project {
  const p = createEmptyProject('Hub')
  p.state.time.speakingRate = 0
  p.flows = {}
  const f = createFlow('f1', 'Talk', null, 0)
  const node = (id: string, type: string, data: Record<string, unknown>) => (f.nodes[id] = { id, type, position: { x: 0, y: 0 }, data })
  let n = 0
  const edge = (source: string, target: string, sourceHandle = 'out', order = 0) => {
    const id = `e${n++}`
    f.edges[id] = { id, source, target, sourceHandle, targetHandle: 'in', order }
  }
  node('s', 'dialogue', { isStart: true, text: 'Hi.' })
  node('h', 'hub', { label: 'Talk' })
  node('j', 'dialogue', { text: 'Haha! Good joke!', menuText: 'Tell a joke', once: true })
  node('l', 'dialogue', { text: 'Bye.', menuText: 'Leave', isEnd: true, ...(opts.onceLeave ? { once: true } : {}) })
  edge('s', 'h')
  edge('h', 'j', 'out', 0)
  edge('h', 'l', 'out', 1)
  edge('j', 'h')
  if (opts.fallback) {
    node('f', 'dialogue', { text: "I've heard enough jokes.", isEnd: true })
    edge('h', 'f', 'fallback')
  }
  p.flows[f.id] = f
  return p
}

const texts = (b: Beat) => (b.kind === 'end' ? [] : b.choices.map((c) => c.text))

describe('hubs: asking and falling back (export v5)', () => {
  it('keeps the menu up when only one choice is left', () => {
    const { file } = buildExport(project())
    expect(file.flows.f1.nodes.h).toMatchObject({ type: 'hub', ask: true, next: ['j', 'l'] })
    expect(file.version).toBe(5)
    const story = new SkeinStory(new SkeinWorld(file), 'f1')
    story.start() // Hi.
    expect(texts(story.choose(0))).toEqual(['Tell a joke', 'Leave'])
    story.choose(0) // the joke
    const back = story.choose(0) // back at the hub: the joke is gone, but the player still chooses
    expect(back.kind).toBe('choice')
    expect(texts(back)).toEqual(['Leave'])
  })

  it('follows the fallback when nothing is left', () => {
    const { file } = buildExport(project({ fallback: true, onceLeave: true }))
    expect(file.flows.f1.nodes.h).toMatchObject({ fallback: 'f' })
    expect(file.flows.f1.nodes.h).not.toHaveProperty('next', expect.arrayContaining(['f']))
    const story = new SkeinStory(new SkeinWorld(file), 'f1')
    story.start()
    story.choose(0) // → hub
    story.choose(0) // joke
    story.choose(0) // → hub: Leave left
    story.choose(0) // Leave → Bye. (ends)
    // Play it again from the top: both once-only choices are used up, so the hub falls back.
    const again = new SkeinStory(story.world, 'f1')
    again.start()
    const b = again.choose(0)
    expect(b.kind).toBe('line')
    expect(b.kind === 'line' && b.text).toBe("I've heard enough jokes.")
  })

  it('needs no v5 runtime when no choice can disappear', () => {
    const p = project()
    delete p.flows.f1.nodes.j.data.once
    const { file } = buildExport(p)
    expect(file.flows.f1.nodes.h).not.toHaveProperty('ask')
    expect(file.version).toBeLessThan(5)
  })

  it('shows the fallback in the script view, not as a choice', () => {
    const p = project({ fallback: true })
    const items = scriptOf(p.flows.f1)
    expect(items.some((i) => i.kind === 'when' && i.outcome === 'fallback')).toBe(true)
    const choiceCounts = items.flatMap((i) => ('branch' in i && i.branch ? [i.branch.count] : []))
    expect(new Set(choiceCounts)).toEqual(new Set([2]))
  })
})
