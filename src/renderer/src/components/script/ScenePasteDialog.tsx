import { ClipboardPaste } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { characterName, matchSpeaker, parseScreenplay, screenplayNames, usualChooser, type SpeakerChoice } from '@shared/screenplay'
import { speakerOrder } from '@shared/quickEntry'
import type { Project } from '@shared/schema'
import { toast } from '../../lib/toast'
import { addScene } from '../../store/flowOps'
import { useProjectStore } from '../../store/projectStore'
import { useUi } from '../../store/ui'
import { Button } from '../ui/Button'
import { inputClass } from '../ui/fields'
import { Modal } from '../ui/Modal'

const EXAMPLE = `PIP: Morning! What can I get you?
(wiping the counter)

> A flat white, please.
> Just water, thanks.

PIP: Coming right up.`

/**
 * Preview a scene pasted as text before it becomes lines: who each name is
 * (an existing entity, a new character, or narration) and what will be added.
 */
export function ScenePasteDialog() {
  const paste = useUi((s) => s.scenePaste)
  const close = () => useUi.getState().setScenePaste(null)
  const project = useProjectStore((s) => s.project)
  const [text, setText] = useState('')
  const [choices, setChoices] = useState<Record<string, SpeakerChoice>>({})
  /** Who speaks choices written without a name (undefined: the usual chooser). */
  const [chooserPick, setChooser] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    setText(paste?.text ?? '')
    setChoices({})
    setChooser(undefined)
  }, [paste])

  const lines = useMemo(() => parseScreenplay(text), [text])
  const names = useMemo(() => (lines ? screenplayNames(lines) : []), [lines])
  if (!project) return null
  const choiceFor = (name: string): SpeakerChoice => (name in choices ? choices[name] : (matchSpeaker(project, name) ?? 'new'))
  const newCount = names.filter((n) => choiceFor(n) === 'new').length
  const unnamedChoices = lines?.some((l) => l.choice && !l.name) ?? false
  const chooser = chooserPick === undefined ? (paste ? usualChooser(project, paste.flowId) : null) : chooserPick

  const add = () => {
    if (!paste || !lines) return
    const speakers = Object.fromEntries(names.map((n) => [n, choiceFor(n)]))
    const result = addScene(paste.flowId, lines, speakers, paste.at, paste.after, chooser)
    close()
    if (!result.nodeIds.length) return
    useProjectStore.getState().select({ kind: 'node', flowId: paste.flowId, id: result.nodeIds[0] })
    useUi.getState().revealNode(result.nodeIds[0])
    const made = `${result.nodeIds.length} line${result.nodeIds.length === 1 ? '' : 's'}${result.newEntityIds.length ? `, ${result.newEntityIds.length} new character${result.newEntityIds.length === 1 ? '' : 's'}` : ''}`
    toast.success(`Added ${made}`, result.notes.join('\n') || undefined)
  }

  return (
    <Modal
      open={paste !== null}
      onClose={close}
      title="Paste a scene"
      icon={ClipboardPaste}
      width={720}
      subtitle={
        <>
          One line each: <code className="font-mono">NAME: text</code>, a name on its own line above its text, <code className="font-mono">&gt; text</code> for a
          choice, <code className="font-mono">(…)</code> for a stage direction. Text with no name is narration.
        </>
      }
      footer={
        <>
          <p className="flex-1 text-2xs text-faint">{lines ? 'You can undo this in one step.' : ''}</p>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!lines} onClick={add}>
            {lines ? `Add ${lines.length} line${lines.length === 1 ? '' : 's'}${newCount ? ` and ${newCount} character${newCount === 1 ? '' : 's'}` : ''}` : 'Add lines'}
          </Button>
        </>
      }
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={text ? 6 : 9}
        placeholder={EXAMPLE}
        aria-label="Scene text"
        autoFocus={!paste?.text}
        className={`${inputClass} resize-y font-mono text-xs leading-relaxed`}
      />
      {text.trim() && !lines && <p className="mt-2 text-xs text-warn">No line has a speaker yet. Write NAME: text, or a name on its own line above its text.</p>}

      {lines && (names.length > 0 || unnamedChoices) && (
        <section className="mt-4">
          <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">Speakers</h3>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-x-3 gap-y-1.5">
            {names.map((name) => (
              <SpeakerRow key={name} project={project} name={name} value={choiceFor(name)} onChange={(v) => setChoices((c) => ({ ...c, [name]: v }))} />
            ))}
            {unnamedChoices && (
              <>
                <span className="truncate text-xs italic text-muted">Choices with no name</span>
                <select
                  value={chooser ?? ''}
                  onChange={(e) => setChooser(e.target.value || null)}
                  aria-label="Who speaks choices with no name"
                  className={`${inputClass} cursor-pointer py-1 text-xs`}
                >
                  <option value="">Narration (no speaker)</option>
                  {speakerOrder(project).map((id) => (
                    <option key={id} value={id}>
                      {project.entities[id].name}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        </section>
      )}

      {lines && (
        <section className="mt-4">
          <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">Lines</h3>
          <ol className="flex flex-col gap-1 rounded-lg border border-line bg-bg/60 p-2 text-xs">
            {lines.map((l, i) => (
              <li key={i} className={l.choice ? 'pl-5' : ''}>
                {l.choice && <span className="mr-1 font-mono text-accent">›</span>}
                <span className="font-semibold uppercase tracking-wide text-muted">
                  {l.name ? speakerLabel(project, choiceFor(l.name), l.name) : l.choice && chooser ? (project.entities[chooser]?.name ?? 'Narration') : 'Narration'}
                </span>{' '}
                <span className="text-fg">{l.text}</span>
                {l.direction && <span className="ml-1 italic text-faint">({l.direction})</span>}
              </li>
            ))}
          </ol>
          {lines.some((l) => l.choice) && <p className="mt-1.5 text-2xs text-faint">Each choice leads on to the line after its menu.</p>}
        </section>
      )}
    </Modal>
  )
}

function speakerLabel(project: Project, choice: SpeakerChoice, name: string): string {
  if (choice === 'new') return characterName(name)
  if (choice === null) return 'Narration'
  return project.entities[choice]?.name ?? name
}

function SpeakerRow({ project, name, value, onChange }: { project: Project; name: string; value: SpeakerChoice; onChange(v: SpeakerChoice): void }) {
  return (
    <>
      <span className="truncate font-mono text-xs text-fg">{name}</span>
      <select
        value={value === null ? '' : value}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        aria-label={`Who is ${name}`}
        className={`${inputClass} cursor-pointer py-1 text-xs`}
      >
        <option value="new">New character “{characterName(name)}”</option>
        <option value="">Narration (no speaker)</option>
        <optgroup label="In this project">
          {speakerOrder(project).map((id) => (
            <option key={id} value={id}>
              {project.entities[id].name}
            </option>
          ))}
        </optgroup>
      </select>
    </>
  )
}
