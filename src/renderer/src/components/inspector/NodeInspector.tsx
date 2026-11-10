import { motion } from 'framer-motion'
import { ArrowRight, Crosshair, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { analyzeFlow } from '@shared/flowAnalysis'
import { dataRef, dataString, isEndNode, isKnownNodeType, isStartNode } from '@shared/nodes'
import type { Project } from '@shared/schema'
import { useIssuesFor } from '../../hooks/useIssues'
import { compareOrder } from '../../lib/tree'
import { deleteElements, updateNodeData } from '../../store/flowOps'
import { useProjectStore } from '../../store/projectStore'
import { describeNode } from '../flow/FlowEditor'
import { GENERIC_META, NODE_META } from '../flow/flowMeta'
import { ExpressionField } from '../defs/ExpressionField'
import { Button } from '../ui/Button'
import { FieldLabel, IssueList, Select, TextArea, TextInput, Toggle, type SelectOption } from '../ui/fields'

export function NodeInspector({ project, flowId, nodeId }: { project: Project; flowId: string; nodeId: string }) {
  const issues = useIssuesFor(nodeId)
  const focusNode = useProjectStore((s) => s.focusNode)
  const flow = project.flows[flowId]
  const node = flow?.nodes[nodeId]
  if (!flow || !node) return null

  const meta = isKnownNodeType(node.type) ? NODE_META[node.type] : GENERIC_META
  const Icon = meta.icon
  const patch = (p: Record<string, unknown>) => updateNodeData(flowId, nodeId, p)
  const a = analyzeFlow(flow)

  return (
    <div className="flex flex-col gap-4 pt-1">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: `${meta.color}22`, color: meta.color }}>
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <p className="font-medium text-fg">{meta.label}</p>
          <p className="text-2xs text-faint">{meta.hint}</p>
        </div>
      </div>
      <IssueList issues={issues} />

      {node.type === 'dialogue' && (
        <>
          <FieldLabel label="Speaker">
            <Select
              value={dataRef(node, 'speakerId')}
              placeholder="No speaker"
              options={speakerOptions(project)}
              onChange={(speakerId) => patch({ speakerId })}
            />
          </FieldLabel>
          <FieldLabel label="Line">
            <TextArea value={dataString(node, 'text')} rows={5} placeholder="What do they say?" onCommit={(text) => patch({ text })} />
          </FieldLabel>
          <FieldLabel label="Choice text" hint="shown in the player’s choice menu">
            <TextInput
              value={dataString(node, 'menuText')}
              placeholder="Short version for menus (optional)"
              onCommit={(menuText) => patch({ menuText })}
            />
          </FieldLabel>
        </>
      )}

      {node.type === 'condition' && (
        <FieldLabel label="Condition" hint="true → left branch, false → right">
          <ExpressionField
            project={project}
            value={dataString(node, 'expression')}
            mode="condition"
            rows={3}
            placeholder="Keeper->Stranger.Trust >= 2 or Player.Reputation > 3"
            onCommit={(expression) => patch({ expression })}
          />
        </FieldLabel>
      )}

      {node.type === 'instruction' && (
        <FieldLabel label="Instruction" hint="changes state, one change per line">
          <ExpressionField
            project={project}
            value={dataString(node, 'script')}
            mode="action"
            rows={4}
            placeholder={'World.LighthouseLit = true\nadvance to Night'}
            onCommit={(script) => patch({ script })}
          />
        </FieldLabel>
      )}

      <Section title="State">
        <FieldLabel label="Requires" hint="only available while this holds">
          <ExpressionField
            project={project}
            value={dataString(node, 'requires')}
            mode="condition"
            placeholder="e.g. Time.Phase is Night"
            onCommit={(requires) => patch({ requires })}
          />
        </FieldLabel>
        <FieldLabel label="Effects" hint="applied when the story passes through">
          <ExpressionField
            project={project}
            value={dataString(node, 'effects')}
            mode="action"
            rows={2}
            placeholder="e.g. Keeper.Mood = Wary"
            onCommit={(effects) => patch({ effects })}
          />
        </FieldLabel>
      </Section>

      {node.type === 'hub' && (
        <FieldLabel label="Label" hint="jumps refer to hubs by this name">
          <TextInput value={dataString(node, 'label')} placeholder="e.g. Back at the door" onCommit={(label) => patch({ label })} />
        </FieldLabel>
      )}

      {node.type === 'jump' && (
        <FieldLabel label="Jump to">
          <Select
            value={dataRef(node, 'targetId')}
            placeholder="Pick a node…"
            options={jumpOptions(project, flowId, nodeId)}
            onChange={(targetId) => patch({ targetId })}
          />
          {dataRef(node, 'targetId') && flow.nodes[dataRef(node, 'targetId') as string] && (
            <button
              type="button"
              onClick={() => focusNode(flowId, dataRef(node, 'targetId') as string)}
              className="mt-1.5 flex items-center gap-1 text-xs text-accent hover:underline"
            >
              <Crosshair size={12} /> Show target
            </button>
          )}
        </FieldLabel>
      )}

      <Section title="Flow">
        <ToggleRow label="Start node" hint="the flow can begin here" checked={isStartNode(node)} onChange={(isStart) => patch({ isStart })} />
        <ToggleRow label="End node" hint="the flow is allowed to stop here" checked={isEndNode(node)} onChange={(isEnd) => patch({ isEnd })} />
        <div className="flex justify-between text-xs">
          <span className="text-faint">Connections</span>
          <span className="tabular-nums text-muted">
            {a.incoming.get(nodeId) ?? 0} in · {a.outgoing.get(nodeId) ?? 0} out
          </span>
        </div>
      </Section>

      <FieldLabel label="Designer note" hint="never exported">
        <TextArea value={dataString(node, 'note')} rows={2} placeholder="Notes for the team" onCommit={(note) => patch({ note })} />
      </FieldLabel>

      <div className="flex items-center justify-between">
        <code className="truncate font-mono text-2xs text-faint" title={node.id}>
          {node.id}
        </code>
        <Button variant="ghost" icon={Trash2} onClick={() => deleteElements(flowId, [nodeId], [])}>
          Delete
        </Button>
      </div>
    </div>
  )
}

export function EdgeInspector({ project, flowId, edgeId }: { project: Project; flowId: string; edgeId: string }) {
  const focusNode = useProjectStore((s) => s.focusNode)
  const flow = project.flows[flowId]
  const edge = flow?.edges[edgeId]
  if (!flow || !edge) return null
  const source = flow.nodes[edge.source]
  const target = flow.nodes[edge.target]
  const loop = analyzeFlow(flow).loopEdges.has(edgeId)
  const branch = edge.sourceHandle === 'true' || edge.sourceHandle === 'false' ? edge.sourceHandle : null

  return (
    <div className="flex flex-col gap-4 pt-1">
      <div className="flex flex-col gap-1.5">
        <NodeLink label={source ? describeNode(project, source) : '(missing)'} onClick={() => source && focusNode(flowId, source.id)} />
        <div className="flex items-center gap-2 pl-3 text-2xs text-faint">
          <ArrowRight size={12} />
          {branch ? `when ${branch}` : 'then'}
        </div>
        <NodeLink label={target ? describeNode(project, target) : '(missing)'} onClick={() => target && focusNode(flowId, target.id)} />
      </div>
      {loop && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-md border border-loop/40 bg-loop/10 px-2.5 py-2 text-xs leading-relaxed text-loop"
        >
          This connection loops back to an earlier point, so the conversation can repeat. That&apos;s fine for hub menus; check that
          the player can eventually leave.
        </motion.p>
      )}
      <div className="flex items-center justify-between">
        <code className="truncate font-mono text-2xs text-faint">{edge.id}</code>
        <Button variant="ghost" icon={Trash2} onClick={() => deleteElements(flowId, [], [edgeId])}>
          Delete
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function NodeLink({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="truncate rounded-md border border-line bg-bg px-2.5 py-1.5 text-left text-xs text-fg transition-colors hover:border-accent/50"
    >
      {label}
    </button>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">{title}</h3>
      <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-bg/40 p-2.5">{children}</div>
    </section>
  )
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-xs text-fg">{label}</p>
        <p className="text-2xs text-faint">{hint}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  )
}

function speakerOptions(project: Project): SelectOption[] {
  return Object.values(project.entities)
    .sort((a, b) => {
      const ta = project.templates[a.templateId]?.name ?? ''
      const tb = project.templates[b.templateId]?.name ?? ''
      return ta.localeCompare(tb) || compareOrder(a, b)
    })
    .map((e) => ({ value: e.id, label: e.name, group: project.templates[e.templateId]?.name ?? 'Other' }))
}

function jumpOptions(project: Project, flowId: string, selfId: string): SelectOption[] {
  const flow = project.flows[flowId]
  return Object.values(flow.nodes)
    .filter((n) => n.id !== selfId && n.type !== 'jump')
    .sort((a, b) => (a.type === 'hub' ? 0 : 1) - (b.type === 'hub' ? 0 : 1) || a.position.y - b.position.y || a.position.x - b.position.x)
    .map((n) => ({ value: n.id, label: describeNode(project, n), group: n.type === 'hub' ? 'Hubs' : 'Other nodes' }))
}

