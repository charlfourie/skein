import { useRef, useState, type RefObject } from 'react'
import { Panel, PanelGroup, type ImperativePanelHandle } from 'react-resizable-panels'
import { Inspector } from '../inspector/Inspector'
import { NavTree } from '../nav/NavTree'
import { ResizeHandle } from '../ui/ResizeHandle'
import { Workspace } from '../workspace/Workspace'
import { ExternalChangeBanner } from './ExternalChangeBanner'
import { StatusBar } from './StatusBar'
import { TopBar } from './TopBar'

export function Shell() {
  const leftRef = useRef<ImperativePanelHandle>(null)
  const rightRef = useRef<ImperativePanelHandle>(null)
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)

  const toggle = (ref: RefObject<ImperativePanelHandle>) => {
    const panel = ref.current
    if (!panel) return
    if (panel.isCollapsed()) panel.expand()
    else panel.collapse()
  }

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <TopBar
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onToggleLeft={() => toggle(leftRef)}
        onToggleRight={() => toggle(rightRef)}
      />
      <ExternalChangeBanner />

      {/* Pane sizes persist per machine (localStorage), never in the project file. */}
      <PanelGroup direction="horizontal" autoSaveId="skein.layout.v1" className="min-h-0 flex-1">
        <Panel
          ref={leftRef}
          id="explorer"
          order={1}
          defaultSize={18}
          minSize={12}
          maxSize={40}
          collapsible
          collapsedSize={0}
          onCollapse={() => setLeftOpen(false)}
          onExpand={() => setLeftOpen(true)}
        >
          <NavTree />
        </Panel>
        <ResizeHandle />
        <Panel id="workspace" order={2} minSize={30}>
          <Workspace />
        </Panel>
        <ResizeHandle />
        <Panel
          ref={rightRef}
          id="inspector"
          order={3}
          defaultSize={22}
          minSize={15}
          maxSize={40}
          collapsible
          collapsedSize={0}
          onCollapse={() => setRightOpen(false)}
          onExpand={() => setRightOpen(true)}
        >
          <Inspector />
        </Panel>
      </PanelGroup>

      <StatusBar />
    </div>
  )
}
