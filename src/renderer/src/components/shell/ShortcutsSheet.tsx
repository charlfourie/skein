import { Keyboard } from 'lucide-react'
import { SHORTCUTS } from '../../lib/shortcuts'
import { useUi } from '../../store/ui'
import { Modal } from '../ui/Modal'

/** Every keyboard shortcut (press ? anywhere outside a text field). */
export function ShortcutsSheet() {
  const open = useUi((s) => s.shortcutsOpen)
  const setOpen = useUi((s) => s.setShortcutsOpen)
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts" icon={Keyboard} width={720}>
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
        {SHORTCUTS.map((group) => (
          <section key={group.title}>
            <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">{group.title}</h3>
            <dl className="flex flex-col gap-1">
              {group.items.map((item) => (
                <div key={item.does} className="flex items-baseline justify-between gap-3 text-xs">
                  <dt className="text-muted">{item.does}</dt>
                  <dd className="flex shrink-0 flex-wrap justify-end gap-1">
                    {item.keys.map((k) => (
                      <kbd key={k} className="rounded bg-bg px-1.5 py-0.5 font-mono text-2xs text-fg ring-1 ring-line">
                        {k}
                      </kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  )
}
