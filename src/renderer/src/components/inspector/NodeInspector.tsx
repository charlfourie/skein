import { motion } from 'framer-motion'
import { ArrowRight, ChevronDown, ChevronUp, Crosshair, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { analyzeFlow } from '@shared/flowAnalysis'
import { outgoingEdges, startNodes } from '@shared/flowOrder'
import { dataRef, dataString, isEndNode, isKnownNodeType, isStartNode } from '@shared/nodes'
import type { Flow, Project } from '@shared/schema'
import { TECHNICAL_NAME_RE, toTechnicalName } from '@shared/technicalName'
import { useIssuesFor } from '../../hooks/useIssues'
import { compareOrder } from '../../lib/tree'
import { deleteElements, moveChoice, moveStart, updateNodeData } from '../../store/flowOps'
import { useProjectStore } from '../../store/projectStore'
import { describeNode } from '../flow/FlowEditor'
import { GENERIC_META, NODE_META } from '../flow/flowMeta'
import { ExpressionField } from '../defs/ExpressionField'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
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

      {(node.type === 'dialogue' || node.type === 'hub' || node.type === 'instruction') && (
        <ChoiceOrder project={project} flow={flow} nodeId={nodeId} kind={node.type} />
      )}

      <Section title="Flow">
        <ToggleRow label="Start node" hint="the flow can begin here" checked={isStartNode(node)} onChange={(isStart) => patch({ isStart })} />
        {isStartNode(node) && <StartPriority flow={flow} nodeId={nodeId} />}
        <ToggleRow label="End node" hint="the flow is allowed to stop here" checked={isEndNode(node)} onChange={(isEnd) => patch({ isEnd })} />
        <ToggleRow
          label="Only once"
          hint="not available again after the story has been here"
          checked={node.data.once === true}
          onChange={(once) => patch({ once })}
        />
        <FieldLabel label="Tag" hint="lets any expression ask Seen.Tag or Visits.Tag">
          <TextInput
            value={dataString(node, 'tag')}
            mono
            placeholder="e.g. TalkedVernon"
            onCommit={(tag) => patch({ tag: tag ? (TECHNICAL_NAME_RE.test(tag) ? tag : toTechnicalName(tag)) : '' })}
          />
        </FieldLabel>
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

/**
 * The order of the connections leaving a node's output. For dialogue lines and
 * hubs it's the order the player sees the choices in; for instructions, the
 * order they're tried in (the first available one is followed). Stored in the
 * file, so moving nodes on the canvas never changes it.
 */
function ChoiceOrder({ project, flow, nodeId, kind }: { project: Project; flow: Flow; nodeId: string; kind: 'dialogue' | 'hub' | 'instruction' }) {
  const focusNode = useProjectStore((s) => s.focusNode)
  const edges = outgoingEdges(flow, nodeId, 'out')
  if (edges.length < 2) return null
  const hint =
    kind === 'instruction'
      ? 'tried in this order; the first available one is followed'
      : 'the order the player sees them in; unavailable ones are skipped'
  return (
    <Section title={kind === 'instruction' ? 'Next, in order' : 'Choices, in order'}>
      <p className="-mt-0.5 text-2xs text-faint">{hint}</p>
      <ol className="flex flex-col gap-1">
        {edges.map((e, i) => {
          const target = flow.nodes[e.target]
          const label = target ? choiceLabel(project, target) : '(missing)'
          const gated = target && dataString(target, 'requires')
          return (
            <li key={e.id} className="flex items-center gap-1.5">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-accent/40 text-[10px] font-semibold tabular-nums text-accent">
                {i + 1}
              </span>
              <button
                type="button"
                onClick={() => target && focusNode(flow.id, target.id)}
                title={gated ? `Only offered while: ${dataString(target, 'requires')}` : 'Show on canvas'}
                className="min-w-0 flex-1 truncate rounded-md border border-line bg-bg px-2 py-1 text-left text-xs text-fg transition-colors hover:border-accent/50"
              >
                {label}
                {gated && <span className="ml-1.5 text-2xs text-warn">gated</span>}
              </button>
              <IconButton size="sm" icon={ChevronUp} label="Move earlier" disabled={i === 0} onClick={() => moveChoice(flow.id, e.id, -1)} />
              <IconButton size="sm" icon={ChevronDown} label="Move later" disabled={i === edges.length - 1} onClick={() => moveChoice(flow.id, e.id, 1)} />
            </li>
          )
        })}
      </ol>
    </Section>
  )
}

function choiceLabel(project: Project, node: Flow['nodes'][string]): string {
  const menu = dataString(node, 'menuText')
  return menu ? `“${menu}”` : describeNode(project, node)
}

/** Where this start node sits among the flow's start nodes (the first available one is used). */
function StartPriority({ flow, nodeId }: { flow: Flow; nodeId: string }) {
  const starts = startNodes(flow)
  if (starts.length < 2) return null
  const i = starts.findIndex((n) => n.id === nodeId)
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-xs text-fg">
          Start priority <span className="tabular-nums text-muted">{i + 1} of {starts.length}</span>
        </p>
        <p className="text-2xs text-faint">the first start whose requirement holds is used</p>
      </div>
      <div className="flex">
        <IconButton size="sm" icon={ChevronUp} label="Higher priority" disabled={i === 0} onClick={() => moveStart(flow.id, nodeId, -1)} />
        <IconButton size="sm" icon={ChevronDown} label="Lower priority" disabled={i === starts.length - 1} onClick={() => moveStart(flow.id, nodeId, 1)} />
      </div>
    </div>
  )
}

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

