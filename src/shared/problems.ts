/**
 * Everything wrong in a project, in one list: validation errors and warnings
 * (including flow structure: orphans, dead ends, open branches, broken jumps),
 * problems only the exporter sees, and story tests that fail or can't run.
 * Each problem says where it is, so the editor can take you there.
 */
import { buildExport, type ExportProblem } from './export/build'
import type { TestResult } from './play/storyTests'
import type { Project } from './schema'
import { validateProject, type IssueLevel } from './validate'

export type ProblemPlace =
  | { kind: 'node'; flowId: string; nodeId: string }
  | { kind: 'flow'; flowId: string }
  | { kind: 'rule'; ruleId: string }
  | { kind: 'entity'; entityId: string }
  | { kind: 'template'; templateId: string }
  | { kind: 'state'; doc: 'world' | 'relationships' | 'time' }
  | { kind: 'test'; flowId: string; testId: string }
  | { kind: 'project' }

export interface Problem {
  level: IssueLevel
  message: string
  place: ProblemPlace
  /** Where, for people: a flow's name, "Entities", "State"… (problems are grouped by it). */
  group: string
  /** What, inside the group: a line's text, an entity's name. */
  label: string
  /** Sorting within a group: flows in canvas order, then the rest. */
  order: number
}

export interface ProblemsOptions {
  tests?: Record<string, TestResult>
  /** Reuse an export already built from this project. */
  build?: { problems: ExportProblem[] }
}

const short = (t: string, n = 48) => {
  const s = t.replace(/\s+/g, ' ').trim()
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

export function collectProblems(project: Project, opts: ProblemsOptions = {}): Problem[] {
  const out: Problem[] = []
  const issues = validateProject(project)

  // Who owns an id: a node (and its flow), a flow, a rule, an entity…
  const nodeFlow = new Map<string, string>()
  for (const f of Object.values(project.flows)) for (const id of Object.keys(f.nodes)) nodeFlow.set(id, f.id)
  const phaseIds = new Set(Object.keys(project.state.time.phases))

  const nodeLabel = (flowId: string, nodeId: string) => {
    const n = project.flows[flowId]?.nodes[nodeId]
    if (!n) return 'A node'
    const text = [n.data.menuText, n.data.text, n.data.label, n.data.expression, n.data.script].find((x) => typeof x === 'string' && x.trim()) as string | undefined
    const kind = n.type === 'dialogue' ? 'Line' : n.type === 'call' ? 'Play flow' : n.type[0].toUpperCase() + n.type.slice(1)
    return text ? `${kind}: “${short(text, 40)}”` : `${kind} (empty)`
  }

  for (const [owner, list] of issues) {
    for (const issue of list) {
      if (issue.summary) continue
      const base = { level: issue.level, message: issue.message }
      const flowId = nodeFlow.get(owner)
      if (flowId) {
        const n = project.flows[flowId].nodes[owner]
        out.push({ ...base, place: { kind: 'node', flowId, nodeId: owner }, group: project.flows[flowId].name, label: nodeLabel(flowId, owner), order: n.position.y * 1e5 + n.position.x })
      } else if (project.flows[owner]) {
        out.push({ ...base, place: { kind: 'flow', flowId: owner }, group: project.flows[owner].name, label: 'The flow', order: -1 })
      } else if (project.state.rules[owner]) {
        out.push({ ...base, place: { kind: 'rule', ruleId: owner }, group: 'Time and rules', label: `Rule “${project.state.rules[owner].name}”`, order: project.state.rules[owner].order })
      } else if (project.entities[owner]) {
        out.push({ ...base, place: { kind: 'entity', entityId: owner }, group: 'Entities', label: project.entities[owner].name, order: 0 })
      } else if (project.templates[owner]) {
        out.push({ ...base, place: { kind: 'template', templateId: owner }, group: 'Templates', label: project.templates[owner].name, order: 0 })
      } else if (project.state.variables[owner]) {
        const v = project.state.variables[owner]
        out.push({ ...base, place: { kind: 'state', doc: 'world' }, group: 'World variables', label: `${v.namespace}.${v.technicalName || v.name}`, order: 0 })
      } else if (project.state.relationships[owner]) {
        out.push({ ...base, place: { kind: 'state', doc: 'relationships' }, group: 'Relationships', label: project.state.relationships[owner].name, order: 0 })
      } else if (owner === 'state:time' || phaseIds.has(owner)) {
        out.push({ ...base, place: { kind: 'state', doc: 'time' }, group: 'Time and rules', label: phaseIds.has(owner) ? `Phase “${project.state.time.phases[owner].label}”` : 'Time', order: -1 })
      } else {
        out.push({ ...base, place: { kind: 'project' }, group: 'Project', label: '', order: 0 })
      }
    }
  }

  // The exporter's own findings that validation doesn't report (nodes of an unknown type, a rule
  // limited to a flow that's gone…). Problems tied to a node are already listed above.
  const build = opts.build ?? buildExport(project, { includeSource: false })
  for (const p of build.problems) {
    if (p.at?.kind === 'node') continue
    if (p.at?.kind === 'rule') {
      const r = project.state.rules[p.at.ruleId]
      // Expression errors in rules are already reported by validation, as "Condition: …" / "Effects: …".
      if (issues.get(p.at.ruleId)?.some((i) => i.level === p.level && p.message.includes(i.message.replace(/^[^:]*: /, '')))) continue
      out.push({ level: p.level, message: p.message, place: { kind: 'rule', ruleId: p.at.ruleId }, group: 'Time and rules', label: r ? `Rule “${r.name}”` : 'A rule', order: r?.order ?? 0 })
    } else if (!/has no start node\.$/.test(p.message)) {
      out.push({ level: p.level, message: p.message, place: { kind: 'project' }, group: 'Export', label: '', order: 0 })
    }
  }

  // Story tests.
  for (const r of Object.values(opts.tests ?? {})) {
    if (r.status === 'pass') continue
    const flow = project.flows[r.flowId]
    out.push({
      level: r.status === 'fail' ? 'error' : 'warning',
      message: r.status === 'fail' ? `Test “${r.name}” fails: ${r.failures[0]?.message ?? ''}` : `Test “${r.name}” can't run: ${r.failures[0]?.message ?? ''}`,
      place: flow ? { kind: 'test', flowId: r.flowId, testId: r.testId } : { kind: 'project' },
      group: flow ? flow.name : 'Story tests',
      label: 'Story test',
      order: -2
    })
  }

  // Flows first (in the explorer's order), then everything else; errors before warnings within each.
  const flowRank = new Map(Object.values(project.flows).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)).map((f, i) => [f.name, i]))
  const rank = (g: string) => flowRank.get(g) ?? 1e6
  const lvl = (l: IssueLevel) => (l === 'error' ? 0 : 1)
  return out.sort((a, b) => rank(a.group) - rank(b.group) || a.group.localeCompare(b.group) || lvl(a.level) - lvl(b.level) || a.order - b.order || a.label.localeCompare(b.label))
}
