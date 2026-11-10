import { Plus } from 'lucide-react'
import type { Project } from '@shared/schema'
import { templateIcon } from '../../lib/meta'
import { compareOrder } from '../../lib/tree'
import { createEntity, createTemplate } from '../../store/ops'
import { MenuItem, Popover } from '../ui/Popover'

/** "New entity" menu: pick which template the entity is an instance of. */
export function TemplatePicker({
  project,
  anchor,
  onClose,
  folderId,
  onCreated
}: {
  project: Project
  anchor: DOMRect | null
  onClose(): void
  folderId: string | null
  onCreated?(): void
}) {
  const templates = Object.values(project.templates).sort(compareOrder)

  return (
    <Popover anchor={anchor} onClose={onClose} width={250}>
      {templates.length === 0 ? (
        <div className="p-2">
          <p className="text-xs text-muted">Entities are made from templates. Create one first, for example “Character”.</p>
          <button
            type="button"
            onClick={() => {
              onClose()
              createTemplate(null)
            }}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-bg transition-colors hover:bg-accent/90"
          >
            <Plus size={13} /> New template
          </button>
        </div>
      ) : (
        <>
          <p className="px-2 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">New entity from…</p>
          <div className="max-h-72 overflow-y-auto">
            {templates.map((t) => {
              const Icon = templateIcon(t.icon)
              const count = Object.keys(t.properties).length
              return (
                <MenuItem
                  key={t.id}
                  icon={<Icon size={14} />}
                  color={t.color}
                  label={t.name}
                  hint={`${count} propert${count === 1 ? 'y' : 'ies'}`}
                  onClick={() => {
                    onClose()
                    createEntity(t.id, folderId)
                    onCreated?.()
                  }}
                />
              )
            })}
          </div>
        </>
      )}
    </Popover>
  )
}
