import { dataRef, dataString } from './nodes'
import type { FlowNode, Project } from './schema'

/**
 * The clock: each phase of the day has a length, and the day's first phase
 * begins at `dayStart` (minutes after midnight). Activities take minutes that
 * add up and roll over into the next phase, which runs that phase's rules.
 */

export const MINUTES_PER_DAY = 24 * 60
/** Dialogue speaking rate for new projects, in words per minute. */
export const DEFAULT_SPEAKING_RATE = 150

/** Phase lengths for the default four phases: Dawn 05:00, Day 07:00, Dusk 18:00, Night 20:00. */
export const DEFAULT_PHASE_MINUTES: Record<string, number> = { Dawn: 120, Day: 660, Dusk: 120, Night: 540 }
export const DEFAULT_DAY_START = 5 * 60

export interface ClockSettings {
  /** Minutes in each phase, in phase order. */
  lengths: number[]
  /** Minutes after midnight when the first phase begins. */
  dayStart: number
}

/** The project's clock: lengths of phases that don't set one split what's left of the day evenly. */
export function clockOf(project: Project): ClockSettings {
  const phases = Object.values(project.state.time.phases).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))
  const set = phases.map((p) => (typeof p.minutes === 'number' && p.minutes > 0 ? p.minutes : null))
  const used = set.reduce<number>((n, m) => n + (m ?? 0), 0)
  const unset = set.filter((m) => m === null).length
  const share = unset ? Math.max(1, Math.round((MINUTES_PER_DAY - used) / unset)) : 0
  return { lengths: set.map((m) => m ?? share), dayStart: project.state.time.dayStart ?? 0 }
}

/** Hour (0–23) and minute (0–59) of the day at `minute` minutes into phase `phase`. */
export function timeOfDay(clock: ClockSettings, phase: number, minute: number): { hour: number; minute: number } {
  let total = clock.dayStart + minute
  for (let i = 0; i < phase; i++) total += clock.lengths[i] ?? 0
  const m = ((Math.floor(total) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return { hour: Math.floor(m / 60), minute: m % 60 }
}

export function formatClock(t: { hour: number; minute: number }): string {
  return `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Durations

/**
 * Parse a duration: "45m", "2h", "1h 30m", "1.5h", "90" (minutes), "20s".
 * Returns minutes, or null if it isn't a duration.
 */
export function parseDuration(text: string): number | null {
  const s = text.trim().toLowerCase().replace(/\s+/g, '')
  if (!s) return null
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s)
  const m = /^(?:(\d+(?:\.\d+)?)(?:h|hr|hrs|hour|hours))?(?:(\d+(?:\.\d+)?)(?:m|min|mins|minute|minutes))?(?:(\d+(?:\.\d+)?)(?:s|sec|secs|second|seconds))?$/.exec(s)
  if (!m || (!m[1] && !m[2] && !m[3])) return null
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) + Number(m[3] ?? 0) / 60
}

/** "1h 30m", "45m", "20s", "2d 3h". */
export function formatDuration(minutes: number): string {
  if (!(minutes > 0)) return '0m'
  const totalSeconds = Math.round(minutes * 60)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const totalMinutes = Math.round(totalSeconds / 60)
  const d = Math.floor(totalMinutes / MINUTES_PER_DAY)
  const h = Math.floor((totalMinutes % MINUTES_PER_DAY) / 60)
  const m = totalMinutes % 60
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ') || '0m'
}

/** Round to whole seconds, as the runtimes keep the clock. */
export function wholeSeconds(minutes: number): number {
  return Math.round(minutes * 60) / 60
}

// ---------------------------------------------------------------------------
// How long a node takes

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}

export type TakesSource = 'override' | 'activity' | 'speech'

/**
 * How long entering this node takes, and why: its own "Takes" override, else
 * its activity's duration, else (dialogue) the time to speak the line at the
 * project's speaking rate. Null when it takes no time.
 */
export function nodeTakes(project: Project, node: FlowNode): { minutes: number; source: TakesSource; activity?: string } | null {
  const own = node.data.takes
  if (typeof own === 'number' && own >= 0) return own > 0 ? { minutes: wholeSeconds(own), source: 'override' } : null
  const activityId = dataRef(node, 'activityId')
  const activity = activityId ? project.state.time.activities?.[activityId] : undefined
  if (activity) return activity.minutes > 0 ? { minutes: wholeSeconds(activity.minutes), source: 'activity', activity: activity.name } : null
  const rate = project.state.time.speakingRate ?? 0
  if (node.type === 'dialogue' && rate > 0) {
    const words = wordCount(dataString(node, 'text'))
    if (words) return { minutes: Math.max(1 / 60, wholeSeconds(words / rate)), source: 'speech' }
  }
  return null
}
