import { outcomesOf, SkeinStory, SkeinWorld, type Beat, type Choice } from '@shared/export/runtime'
import type { ExportFile, ExportNode, ExportValue } from '@shared/export/types'
import { applyStart, labelForKey, pathFromKey, tagsOf, type StartState, type StateKey } from '@shared/play/explore'

/** One line of the Play panel's transcript. */
export type PlayEntry =
  | { kind: 'line'; nodeId: string; speaker: string | null; text: string }
  | { kind: 'pick'; nodeId: string; text: string }
  | { kind: 'time'; text: string }
  | { kind: 'rule'; text: string }
  | { kind: 'change'; key: StateKey; label: string; from: ExportValue; to: ExportValue }
  | { kind: 'end'; nodeId: string | null; marked: boolean }
  | { kind: 'note'; text: string }
  /** Something that's probably a design mistake, e.g. `advance to Night` at Night skipping a whole day. */
  | { kind: 'warn'; nodeId: string | null; text: string }
  /** A chance() or roll() and how it came out. */
  | { kind: 'dice'; text: string }
  /** Time passing on the clock: an activity, a spoken line or `pass`. */
  | { kind: 'pass'; minutes: number; activity?: string; clock: string }

export interface PlayOption {
  nodeId: string
  text: string
  available: boolean
  /** The requirement that hides it, as written in Skein. */
  requires?: string
  /** Index to pass to choose(), when available. */
  index?: number
  /** Minutes picking it takes (the target's activity or line), and the activity's name. */
  takes?: number
  activity?: string
}

/**
 * A play-through of one flow with the reference runtime: exactly what a game
 * using the export would do. Records a transcript, including every state
 * change and the time and rule activity each step causes.
 */
export class PlaySession {
  readonly world: SkeinWorld
  story: SkeinStory
  beat: Beat
  readonly entries: PlayEntry[] = []
  readonly visited = new Set<string>()
  private readonly baseline: SkeinWorld
  private readonly tags: Map<string, string>

  constructor(
    readonly file: ExportFile,
    flowId: string,
    readonly start: StartState,
    extra: Record<StateKey, ExportValue> = {},
    /** Replay a path from the explorer: its picks, in order (choices and dice outcomes). */
    picks?: number[]
  ) {
    this.tags = tagsOf(file)
    this.world = new SkeinWorld(file)
    applyStart(this.world, start, extra)
    if (picks) {
      // Replaying an explored path: choices and dice come out as recorded, in order.
      this.replayPicks = picks
      this.world.decide = (d) => {
        if (this.replayIndex < picks.length) return picks[this.replayIndex++]
        this.world.decide = undefined // past the recorded path: roll as usual
        const x = this.world.nextRandom()
        return d.kind === 'chance' ? (x % 100 < d.p ? 0 : 1) : x % outcomesOf(d)
      }
    }
    this.world.onPass = (minutes) => {
      const node = this.story?.current
      const activity = node?.takes === minutes ? node.activity : undefined
      // Merge with the previous entry when one beat passes time in pieces (a line, then its effects).
      this.pendingPass.push({ minutes, ...(activity ? { activity } : {}) })
    }
    this.world.onRandom = (d, result) =>
      this.entries.push({
        kind: 'dice',
        text: d.kind === 'chance' ? `chance ${d.p}% → ${result ? 'yes' : 'no'}` : `roll ${d.min}–${d.max} → ${result}`
      })
    this.world.onFullDay = (phase) =>
      this.entries.push({
        kind: 'warn',
        nodeId: this.story.current?.id ?? null,
        text: `“advance to ${phase}” ran during ${phase}, so it skipped a whole day. Use “advance until ${phase}” to stay.`
      })
    this.baseline = new SkeinWorld(file)
    applyStart(this.baseline, start, extra)
    this.story = this.attach(new SkeinStory(this.world, flowId))
    this.beat = this.step(() => this.story.start())
  }

  private pendingPass: { minutes: number; activity?: string }[] = []
  private replayPicks: number[] | null = null
  private replayIndex = 0

  get flowId(): string {
    return this.story.flow.id
  }

  get ended(): boolean {
    return this.beat.kind === 'end'
  }

  get currentNodeId(): string | null {
    return this.beat.node?.id ?? null
  }

  speakerName(speaker: string | null): string | null {
    if (!speaker) return null
    return this.file.entities[speaker]?.name ?? speaker
  }

  /** Every option the current beat could offer, in order, with the unavailable ones and why. */
  options(): PlayOption[] {
    const node = this.beat.node
    if (!node || this.beat.kind === 'end' || !('next' in node)) return []
    const available = new Map(choicesOf(this.beat).map((c) => [c.node, c.index]))
    return node.next.map((id) => {
      const target = this.story.flow.nodes[id]
      const index = available.get(id)
      return {
        nodeId: id,
        text: label(target),
        available: index !== undefined,
        ...(index !== undefined ? { index } : {}),
        ...(target?.takes ? { takes: target.takes } : {}),
        ...(target?.activity ? { activity: target.activity } : {}),
        ...(target?.requires?.source ? { requires: target.requires.source } : target?.requires ? { requires: '(requirement)' } : {})
      }
    })
  }

  choose(index: number): void {
    if (this.ended) return
    const choices = choicesOf(this.beat)
    const choice = choices[index]
    if (!choice) {
      // A line with nothing after it: moving on ends the story.
      if (choices.length === 0) this.beat = this.step(() => this.story.choose(0))
      return
    }
    if (choices.length > 1) this.entries.push({ kind: 'pick', nodeId: choice.node, text: choice.text })
    this.beat = this.step(() => this.story.choose(index))
  }

  /** Move time on, as a game clock would between beats. */
  advance(phases = 1): void {
    this.step(() => {
      this.world.advance(phases)
      return this.beat
    })
  }

  /** Carry the same world into another flow (e.g. the next scene). */
  continueIn(flowId: string): void {
    this.story = this.attach(new SkeinStory(this.world, flowId))
    this.visited.clear()
    this.entries.push({ kind: 'note', text: `Continued in “${this.story.flow.name}”` })
    this.beat = this.step(() => this.story.start())
  }

  /** Play on to the end of the recorded path given to the constructor (choices and dice in order). */
  replay(): void {
    const picks = this.replayPicks
    if (!picks) return
    for (let guard = 0; guard < 1000 && !this.ended; guard++) {
      if (choicesOf(this.beat).length > 1) {
        if (this.replayIndex >= picks.length) break
        this.choose(picks[this.replayIndex++])
      } else this.choose(0)
    }
    this.world.decide = undefined
  }

  private attach(story: SkeinStory): SkeinStory {
    story.onEnter = (n) => this.visited.add(n.id)
    return story
  }

  private step(run: () => Beat): Beat {
    const before = new Map(this.world.changes)
    let beat: Beat
    try {
      beat = run()
    } catch (err) {
      this.entries.push({ kind: 'note', text: err instanceof Error ? err.message : String(err) })
      return { kind: 'end', node: this.story.current }
    }
    // Spoken lines take seconds; only time worth noticing goes in the transcript (the clock shows the rest).
    for (const p of this.pendingPass) if (p.minutes >= 1 || p.activity) this.entries.push({ kind: 'pass', ...p, clock: clockText(this.world) })
    this.pendingPass = []
    for (const line of this.world.log) {
      if (line.startsWith('Time')) this.entries.push({ kind: 'time', text: line.replace(/^Time → /, '') })
      else this.entries.push({ kind: 'rule', text: line })
    }
    this.world.log.length = 0
    for (const [key, to] of this.world.changes) {
      const had = before.has(key)
      const from = had ? before.get(key)! : this.initial(key)
      if (had ? before.get(key) === to : from === to) continue
      this.entries.push({ kind: 'change', key, label: labelForKey(key, this.tags), from, to })
    }
    if (beat !== this.beat) {
      if (beat.kind === 'line') this.entries.push({ kind: 'line', nodeId: beat.node.id, speaker: this.speakerName(beat.speaker), text: beat.text })
      if (beat.kind === 'end') this.entries.push({ kind: 'end', nodeId: beat.node?.id ?? null, marked: beat.node?.end === true })
    }
    return beat
  }

  /** The value a key had at the start of this play-through. */
  initial(key: StateKey): ExportValue {
    const path = pathFromKey(key)
    return path ? this.baseline.read(path) : null
  }

  /** Every value that differs from the start, for the state view. */
  changed(): { key: StateKey; label: string; from: ExportValue; to: ExportValue }[] {
    return [...this.world.changes.entries()]
      .map(([key, to]) => ({ key, label: labelForKey(key, this.tags), from: this.initial(key), to }))
      .filter((c) => c.from !== c.to)
      .sort((a, b) => a.label.localeCompare(b.label))
  }
}

/** The choices a beat offers (none once the story has ended). */
export function choicesOf(beat: Beat): Choice[] {
  return beat.kind === 'end' ? [] : beat.choices
}

function label(node: ExportNode | undefined): string {
  if (!node) return '(missing)'
  if (node.type === 'dialogue') return node.menuText || node.text || '(empty line)'
  if (node.type === 'hub') return node.label || '(hub)'
  return `(${node.type})`
}

export function formatValue(v: ExportValue): string {
  if (v === null) return '—'
  if (typeof v === 'string') return v === '' ? '""' : v
  return String(v)
}

/** "Day 2 · Night · 22:40". */
export function clockText(w: SkeinWorld): string {
  const t = w.clock
  const phase = w.phase ? ` · ${w.data.state.time.labels[w.phaseIndex] ?? w.phase}` : ''
  return `Day ${w.day}${phase} · ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`
}
