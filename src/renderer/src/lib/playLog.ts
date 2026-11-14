import { formatDuration } from '@shared/time'
import { formatValue, type PlayEntry, type PlaySession } from './playSession'

/**
 * A play-through as plain text, for a `.log.txt` file: who said what, every pick,
 * state change, roll and time passing, then what changed overall. Readable by
 * anyone (a writer, a tester, a bug report), with no Skein needed.
 */
export function playLog(session: PlaySession, info: { project: string; flow: string; when: Date; startLabel?: string | null }): string {
  const out: string[] = []
  out.push('SKEIN PLAY LOG')
  out.push(`Project: ${info.project}`)
  out.push(`Flow:    ${info.flow}`)
  out.push(`Played:  ${stamp(info.when)}`)
  const start = session.start
  const setup = [
    start.day !== undefined ? `day ${start.day}` : null,
    start.phase ? `phase ${start.phase}` : null,
    start.seed !== undefined ? `seed ${start.seed}` : null,
    info.startLabel ? `starting at ${info.startLabel}` : null
  ].filter(Boolean)
  if (setup.length) out.push(`Start:   ${setup.join(', ')}`)
  const values = Object.entries({ ...(start.values ?? {}), ...session.extra })
  for (const [key, v] of values) out.push(`         ${key.replace(/^[a-z]+:/, '')} = ${formatValue(v)}`)
  const picks = session.route.filter((s) => 'choose' in s).length
  const rolls = session.route.filter((s) => 'dice' in s).length
  out.push(`Steps:   ${picks} choice${picks === 1 ? '' : 's'}, ${rolls} dice`)
  out.push('')
  out.push('TRANSCRIPT')
  for (const e of session.entries) out.push(entryLine(e))
  if (!session.ended) out.push('… (still playing)')
  out.push('')
  out.push('CHANGED SINCE THE START')
  const changed = session.changed().filter((c) => !c.key.startsWith('visit:'))
  if (changed.length === 0) out.push('Nothing.')
  for (const c of changed) out.push(`${c.label}: ${formatValue(c.from)} → ${formatValue(c.to)}`)
  return `${out.join('\n')}\n`
}

function entryLine(e: PlayEntry): string {
  switch (e.kind) {
    case 'line':
      return `${e.speaker ?? 'Narration'}: ${e.text}`
    case 'pick':
      return `  > ${e.text}`
    case 'change':
      return `    ${e.label}: ${formatValue(e.from)} → ${formatValue(e.to)}`
    case 'dice':
      return `    [dice] ${e.text}`
    case 'time':
      return `    [time] ${e.text}`
    case 'rule':
      return `    [rule] ${e.text}`
    case 'pass':
      return `    [${formatDuration(e.minutes)}${e.activity ? ` ${e.activity}` : ''}] ${e.clock}`
    case 'warn':
      return `  ! ${e.text}`
    case 'note':
      return `  (${e.text})`
    case 'end':
      return e.marked ? '— THE END —' : '— ENDS HERE (not marked as an end) —'
  }
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** A file name for a log: `the-order-2026-11-14-0715.log.txt`. */
export function playLogName(flow: string, when: Date): string {
  const slug = flow.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'play'
  return `${slug}-${stamp(when).replace(/[^0-9]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2').replace(/^(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}.log.txt`
}

/** Save text as a download (the browser's own save, no picker needed). */
export function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
