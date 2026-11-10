import { PanelResizeHandle } from 'react-resizable-panels'

/** A 1px divider with a generous invisible hit area that lights up on hover/drag. */
export function ResizeHandle() {
  return (
    <PanelResizeHandle className="group relative w-px shrink-0 bg-line outline-none">
      <div className="absolute inset-y-0 -left-1.5 -right-1.5 z-10 cursor-col-resize" />
      <div
        className={
          'pointer-events-none absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-accent opacity-0 ' +
          'transition-opacity duration-150 group-hover:opacity-60 ' +
          'group-data-[resize-handle-state=drag]:opacity-100 group-data-[resize-handle-active]:opacity-100'
        }
      />
    </PanelResizeHandle>
  )
}
