import { CONDITION_NODE_CTX } from '@shared/expr/sites'
import { formatDuration, nodeTakes } from '@shared/time'
import { motion } from 'framer-motion'
import { ArrowRight, ChevronDown, ChevronUp, Crosshair, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { choiceRequiresOf, choiceTextOf, incomingChoices, isOnceChoice } from '@shared/choices'
import { cx } from '../../lib/cx'
import { analyzeFlow } from '@shared/flowAnalysis'
import { outgoingEdges, startNodes } from '@shared/flowOrder'
import { dataRef, dataString, isEndNode, isKnownNodeType, isStartNode, offersStateField } from '@shared/nodes'
import type { Flow, Project } from '@shared/schema'
import { TECHNICAL_NAME_RE, toTechnicalName } from '@shared/technicalName'
import { useIssuesFor } from '../../hooks/useIssues'
import { choiceLineIdOf, lineIdOf } from '@shared/lineIds'
import { speakerOrder } from '@shared/quickEntry'
import { ReadOnly } from '../ui/ReadOnly'
import { Comments } from './Comments'
import { compareOrder } from '../../lib/tree'
import { deleteElements, moveChoice, moveStart, updateChoice, updateNodeData } from '../../store/flowOps'
import { useProjectStore } from '../../store/projectStore'
import { useUi } from '../../store/ui'
import { focusCanvasNode, quickEntryKey } from '../../lib/quickKeys'
import { describeNode } from '../flow/FlowEditor'
import { GENERIC_META, NODE_META } from '../flow/flowMeta'
import { ExpressionField } from '../defs/ExpressionField'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { DurationInput, FieldLabel, IssueList, Select, TextArea, TextInput, Toggle, type SelectOption } from '../ui/fields'

export function NodeInspector({ project, flowId, nodeId }: { project: Project; flowId: string; nodeId: string }) {
  const issues = useIssuesFor(nodeId)
  const focusNode = useProjectStore((s) => s.focusNode)
  const openDoc = useProjectStore((s) => s.openDoc)
  const lineFocus = useUi((s) => s.lineFocus)
  // The line field took the cursor (child effects run first): the request is used up.
  useEffect(() => {
    if (lineFocus?.nodeId === nodeId && lineFocus.where === 'inspector') useUi.setState({ lineFocus: null })
  }, [lineFocus, nodeId])
  const flow = project.flows[flowId]
  const node = flow?.nodes[nodeId]
  if (!flow || !node) return null

  const meta = isKnownNodeType(node.type) ? NODE_META[node.type] : GENERIC_META
  const Icon = meta.icon
  const patch = (p: Record<string, unknown>) => updateNodeData(flowId, nodeId, p)
  const a = analyzeFlow(flow)
  // Fields a type doesn't offer stay visible while they still hold something, so old data is never hidden.
  const showRequires = offersStateField(node.type, 'requires') || dataString(node, 'requires').trim() !== ''
  const showEffects = offersStateField(node.type, 'effects') || dataString(node, 'effects').trim() !== ''

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
          <FieldLabel label="Line" hint="Enter: next line · Shift+Enter: line break">
            <TextArea
              value={dataString(node, 'text')}
              rows={5}
              placeholder="What do they say?"
              onCommit={(text) => patch({ text })}
              focusNonce={lineFocus?.nodeId === nodeId && lineFocus.where === 'inspector' ? lineFocus.nonce : undefined}
              onKeyDown={(e, commit) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  commit()
                  focusCanvasNode(nodeId)
                  return
                }
                quickEntryKey(e, flowId, nodeId, commit)
              }}
            />
          </FieldLabel>
          <ChosenAs project={project} flow={flow} nodeId={nodeId} />
          {dataString(node, 'menuText') && (
            <FieldLabel label="Choice text (older)" hint="used by choices into this line with no text of their own">
              <TextInput value={dataString(node, 'menuText')} placeholder="Set it on each choice instead" onCommit={(menuText) => patch({ menuText })} />
            </FieldLabel>
          )}
          {lineIdOf(node) && (
            <div className="flex flex-col gap-1 rounded-md bg-raised/40 px-2 py-1.5">
              <ReadOnly label="Line ID" value={lineIdOf(node)!} mono copyable />
            </div>
          )}
        </>
      )}

      {node.type === 'condition' && (
        <FieldLabel label="Condition" hint="true → left branch, false → right">
          <ExpressionField
            project={project}
            value={dataString(node, 'expression')}
            mode="condition"
            ctx={CONDITION_NODE_CTX}
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

      {(showRequires || showEffects) && (
        <Section title="State">
          {showRequires && (
            <FieldLabel
              label="Requires"
              hint={offersStateField(node.type, 'requires') ? 'only available while this holds' : 'not used on this node type: move it into the condition, then clear it'}
            >
              <ExpressionField
                project={project}
                value={dataString(node, 'requires')}
                mode="condition"
                placeholder="e.g. Time.Phase is Night"
                onCommit={(requires) => patch({ requires })}
              />
            </FieldLabel>
          )}
          {showEffects && (
            <FieldLabel
              label="Effects"
              hint={
                offersStateField(node.type, 'effects')
                  ? 'applied when the story passes through'
                  : node.type === 'instruction'
                    ? 'not used on this node type: move it into the instruction, then clear it'
                    : 'not used on this node type: move it into an instruction node, then clear it'
              }
            >
              <ExpressionField
                project={project}
                value={dataString(node, 'effects')}
                mode="action"
                rows={2}
                placeholder="e.g. Keeper.Mood = Wary"
                onCommit={(effects) => patch({ effects })}
              />
            </FieldLabel>
          )}
        </Section>
      )}

      {node.type === 'hub' && (
        <FieldLabel label="Label" hint="jumps refer to hubs by this name">
          <TextInput value={dataString(node, 'label')} placeholder="e.g. Back at the door" onCommit={(label) => patch({ label })} />
        </FieldLabel>
      )}

      {node.type === 'call' && (
        <FieldLabel label="Flow to play" hint="from its start, then back here">
          <Select
            value={dataRef(node, 'flowId')}
            placeholder="Pick a flow…"
            options={flowOptions(project, flowId)}
            onChange={(id) => patch({ flowId: id })}
          />
          {dataRef(node, 'flowId') && project.flows[dataRef(node, 'flowId') as string] && (
            <button
              type="button"
              onClick={() => openDoc({ kind: 'flow', id: dataRef(node, 'flowId') as string })}
              className="mt-1.5 flex items-center gap-1 text-xs text-accent hover:underline"
            >
              <Crosshair size={12} /> Open flow
            </button>
          )}
        </FieldLabel>
      )}

      {node.type === 'jump' && dataRef(node, 'targetFlowId') && (
        <FieldLabel label="Jump to" hint="this flow ends and the story continues at the other's start">
          <Select
            value={`flow:${dataRef(node, 'targetFlowId')}`}
            options={jumpOptions(project, flowId, nodeId)}
            onChange={(v) => (v?.startsWith('flow:') ? patch({ targetFlowId: v!.slice(5), targetId: null }) : patch({ targetId: v, targetFlowId: null }))}
          />
          {project.flows[dataRef(node, 'targetFlowId') as string] && (
            <button
              type="button"
              onClick={() => openDoc({ kind: 'flow', id: dataRef(node, 'targetFlowId') as string })}
              className="mt-1.5 flex items-center gap-1 text-xs text-accent hover:underline"
            >
              <Crosshair size={12} /> Open flow
            </button>
          )}
        </FieldLabel>
      )}

      {node.type === 'jump' && !dataRef(node, 'targetFlowId') && (
        <FieldLabel label="Jump to">
          <Select
            value={dataRef(node, 'targetId')}
            placeholder="Pick a node…"
            options={jumpOptions(project, flowId, nodeId)}
            onChange={(v) => (v?.startsWith('flow:') ? patch({ targetFlowId: v!.slice(5), targetId: null }) : patch({ targetId: v }))}
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

      {(node.type === 'dialogue' || node.type === 'hub' || node.type === 'instruction' || node.type === 'call') && (
        <ChoiceOrder project={project} flow={flow} nodeId={nodeId} kind={node.type} />
      )}

      {node.type !== 'jump' && node.type !== 'condition' && <TimeTaken project={project} flowId={flowId} nodeId={nodeId} />}

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

      <Comments project={project} flowId={flowId} nodeId={nodeId} />

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
function ChoiceOrder({ project, flow, nodeId, kind }: { project: Project; flow: Flow; nodeId: string; kind: 'dialogue' | 'hub' | 'instruction' | 'call' }) {
  const focusNode = useProjectStore((s) => s.focusNode)
  const edges = outgoingEdges(flow, nodeId, 'out')
  if (edges.length < 2) return null
  const choices = kind === 'dialogue' || kind === 'hub'
  const hint = choices ? 'the order the player sees them in; unavailable ones are skipped' : 'tried in this order; the first available one is followed'
  return (
    <Section title={choices ? 'Choices, in order' : 'Next, in order'}>
      <p className="-mt-0.5 text-2xs text-faint">{hint}</p>
      <ol className="flex flex-col gap-1.5">
        {edges.map((e, i) => {
          const target = flow.nodes[e.target]
          const order = (
            <>
              <IconButton size="sm" icon={ChevronUp} label="Move earlier" disabled={i === 0} onClick={() => moveChoice(flow.id, e.id, -1)} />
              <IconButton size="sm" icon={ChevronDown} label="Move later" disabled={i === edges.length - 1} onClick={() => moveChoice(flow.id, e.id, 1)} />
            </>
          )
          return (
            <li key={e.id} className="flex items-start gap-1.5">
              <span className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-accent/40 text-[10px] font-semibold tabular-nums text-accent">
                {i + 1}
              </span>
              {choices ? (
                <ChoiceRow project={project} flow={flow} edge={e} target={target} onShow={() => target && focusNode(flow.id, target.id)} order={order} />
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => target && focusNode(flow.id, target.id)}
                    title="Show on canvas"
                    className="min-w-0 flex-1 truncate rounded-md border border-line bg-bg px-2 py-1 text-left text-xs text-fg transition-colors hover:border-accent/50"
                  >
                    {target ? describeNode(project, target) : '(missing)'}
                  </button>
                  {order}
                </>
              )}
            </li>
          )
        })}
      </ol>
    </Section>
  )
}

/** One choice a line or hub offers: its own text, "only once" and requirement (format 8: they live on the connection). */
function ChoiceRow({
  project,
  flow,
  edge,
  target,
  onShow,
  order
}: {
  project: Project
  flow: Flow
  edge: Flow['edges'][string]
  target: Flow['nodes'][string] | undefined
  onShow(): void
  order: ReactNode
}) {
  const text = choiceTextOf(edge)
  const requires = choiceRequiresOf(edge)
  const once = isOnceChoice(edge)
  const [open, setOpen] = useState(requires !== '' || once)
  const fallbackText = target ? (target.type === 'dialogue' ? dataString(target, 'menuText') || dataString(target, 'text') : describeNode(project, target)) : '(missing)'
  return (
    <div className="min-w-0 flex-1 rounded-md border border-line bg-bg/60 p-1.5">
      <div className="flex items-center gap-0.5">
        <div className="min-w-0 flex-1">
          <TextInput value={text} placeholder={fallbackText ? `${fallbackText.slice(0, 60)} (the line's text)` : 'Choice text'} onCommit={(choiceText) => updateChoice(flow.id, edge.id, { choiceText })} />
        </div>
        <IconButton size="sm" icon={SlidersHorizontal} label={open ? 'Hide this choice’s settings' : 'Only once and requirement'} active={open || requires !== '' || once} onClick={() => setOpen(!open)} />
        {order}
      </div>
      <div className="mt-1 flex items-center gap-2 px-0.5 text-2xs text-faint">
        <button type="button" onClick={onShow} className="flex min-w-0 items-center gap-1 truncate hover:text-accent" title="Show where it leads on the canvas">
          <Crosshair size={10} className="shrink-0" /> <span className="truncate">{target ? describeNode(project, target) : '(missing)'}</span>
        </button>
        {once && <span className="shrink-0 text-accent">once</span>}
        {requires && <span className="shrink-0 text-warn">gated</span>}
        {target && dataString(target, 'requires') && <span className="shrink-0 text-warn" title={`The line itself requires: ${dataString(target, 'requires')}`}>line gated</span>}
      </div>
      {open && (
        <div className="mt-2 flex flex-col gap-2 border-t border-line/70 pt-2">
          <ToggleRow label="Only once" hint="not offered again after it's been picked" checked={once} onChange={(v) => updateChoice(flow.id, edge.id, { once: v })} />
          <FieldLabel label="Requires" hint="only offered while this holds">
            <ExpressionField project={project} value={requires} mode="condition" placeholder="e.g. Player.Coins >= 4" onCommit={(r) => updateChoice(flow.id, edge.id, { requires: r })} />
          </FieldLabel>
        </div>
      )}
    </div>
  )
}

/** On a line: the choices that lead to it, and what each one says (edited on the line or hub that offers it). */
function ChosenAs({ project, flow, nodeId }: { project: Project; flow: Flow; nodeId: string }) {
  const focusNode = useProjectStore((s) => s.focusNode)
  const incoming = incomingChoices(flow, nodeId).filter((e) => outgoingEdges(flow, e.source, 'out').length > 1)
  if (incoming.length === 0) return null
  return (
    <FieldLabel label="Chosen as" hint="edit a choice on the line or hub it leaves">
      <div className="flex flex-col gap-1">
        {incoming.map((e) => {
          const from = flow.nodes[e.source]
          const text = choiceTextOf(e)
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => focusNode(flow.id, e.source)}
              className="flex min-w-0 items-center gap-1.5 rounded-md border border-line bg-raised/40 px-2 py-1 text-left text-xs transition-colors hover:border-accent/50"
              title={choiceLineIdOf(e) ? `Choice text ID: ${choiceLineIdOf(e)}` : undefined}
            >
              <span className={cx('min-w-0 flex-1 truncate', text ? 'text-fg' : 'italic text-faint')}>{text ? `“${text}”` : 'the line’s own text'}</span>
              <span className="shrink-0 truncate text-2xs text-faint">from {from ? describeNode(project, from) : '?'}</span>
              {isOnceChoice(e) && <span className="shrink-0 text-2xs text-accent">once</span>}
              {choiceRequiresOf(e) && <span className="shrink-0 text-2xs text-warn">gated</span>}
            </button>
          )
        })}
      </div>
    </FieldLabel>
  )
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

/** How long the story spends here: an activity, an own length, or (lines) the time to say it. */
function TimeTaken({ project, flowId, nodeId }: { project: Project; flowId: string; nodeId: string }) {
  const node = project.flows[flowId]?.nodes[nodeId]
  if (!node) return null
  const patch = (p: Record<string, unknown>) => updateNodeData(flowId, nodeId, p)
  const activities = Object.values(project.state.time.activities ?? {}).sort((a, b) => a.order - b.order)
  const takes = nodeTakes(project, node)
  const own = typeof node.data.takes === 'number' ? node.data.takes : null
  const explain = !takes
    ? node.type === 'dialogue' && !(project.state.time.speakingRate ?? 0)
      ? 'Takes no time (spoken lines are set to take none in Time & rules).'
      : 'Takes no time.'
    : takes.source === 'speech'
      ? `About ${formatDuration(takes.minutes)} to say, at ${project.state.time.speakingRate} words a minute.`
      : takes.source === 'activity'
        ? `${takes.activity}: ${formatDuration(takes.minutes)}.`
        : `Takes ${formatDuration(takes.minutes)}.`
  return (
    <Section title="Time">
      <div className="grid grid-cols-[1fr_96px] gap-2">
        <FieldLabel label="Activity">
          <Select
            value={dataRef(node, 'activityId') ?? 'none'}
            options={[
              { value: 'none', label: activities.length ? 'None' : 'None (add activities in Time & rules)' },
              ...activities.map((a) => ({ value: a.id, label: `${a.name} · ${formatDuration(a.minutes)}` }))
            ]}
            onChange={(v) => patch({ activityId: v === 'none' ? null : v })}
          />
        </FieldLabel>
        <FieldLabel label="Takes">
          <DurationInput
            value={own}
            allowEmpty
            placeholder={takes && takes.source !== 'override' ? formatDuration(takes.minutes) : 'none'}
            onCommit={(m) => patch({ takes: m === null ? null : m })}
          />
        </FieldLabel>
      </div>
      <p className="-mt-1 text-2xs text-faint">{explain} Typing a length overrides the activity; 0 means no time.</p>
    </Section>
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
  return speakerOrder(project).map((id) => {
    const e = project.entities[id]
    return { value: e.id, label: e.name, group: project.templates[e.templateId]?.name ?? 'Other' }
  })
}

function jumpOptions(project: Project, flowId: string, selfId: string): SelectOption[] {
  const flow = project.flows[flowId]
  return [
    ...Object.values(flow.nodes)
      .filter((n) => n.id !== selfId && n.type !== 'jump')
      .sort((a, b) => (a.type === 'hub' ? 0 : 1) - (b.type === 'hub' ? 0 : 1) || a.position.y - b.position.y || a.position.x - b.position.x)
      .map((n) => ({ value: n.id, label: describeNode(project, n), group: n.type === 'hub' ? 'Hubs' : 'Other nodes' })),
    ...flowOptions(project, flowId).map((o) => ({ value: `flow:${o.value}`, label: `Continue in “${o.label}”`, group: 'Hand off to another flow' }))
  ]
}

function flowOptions(project: Project, selfFlowId: string): SelectOption[] {
  return Object.values(project.flows)
    .filter((f) => f.id !== selfFlowId)
    .sort(compareOrder)
    .map((f) => ({ value: f.id, label: f.name }))
}

