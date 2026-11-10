import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  BookOpen,
  Boxes,
  Braces,
  ChevronRight,
  Copy,
  Folder,
  FolderOpen,
  FolderPlus,
  Plus,
  Shapes,
  Trash2,
  Workflow,
  XCircle,
  type LucideIcon
} from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import type { Project, SectionId } from '@shared/schema'
import { worstLevel } from '@shared/validate'
import { useIssues } from '../../hooks/useIssues'
import { confirmAndDelete } from '../../lib/confirmDelete'
import { cx } from '../../lib/cx'
import { templateIcon } from '../../lib/meta'
import { buildSectionTree, type TreeNode } from '../../lib/tree'
import { createFlow, createFolder, createTemplate, duplicateEntity, renameItem } from '../../store/ops'
import { isTreeSelection, useProjectStore, type StateDocId, type TreeKind } from '../../store/projectStore'
import { STATE_DOCS } from '../state/StateDocs'
import { TemplatePicker } from '../entities/TemplatePicker'
import { IconButton } from '../ui/IconButton'
import { usePopover } from '../ui/Popover'

interface SectionDef {
  id: SectionId
  label: string
  icon: LucideIcon
  /** What the + button creates in this section (omitted when it arrives in a later phase). */
  itemLabel?: string
  comingIn?: string
  emptyHint?: string
}

const SECTIONS: SectionDef[] = [
  { id: 'flows', label: 'Flows', icon: Workflow, itemLabel: 'Flow' },
  {
    id: 'entities',
    label: 'Entities',
    icon: Boxes,
    itemLabel: 'Entity',
    emptyHint: 'Characters, items, places… each one made from a template.'
  },
  {
    id: 'templates',
    label: 'Templates',
    icon: Shapes,
    itemLabel: 'Template',
    emptyHint: 'Define a data structure, such as Character with Age and Faction.'
  },
]

interface TreeCtx {
  project: Project
  expanded: Set<string>
  toggle(key: string): void
  expand(key: string): void
  /** Open the "new X here" action for a section (entities need a template picker). */
  create(section: SectionId, folderId: string | null, trigger: Element): void
}
const TreeContext = createContext<TreeCtx | null>(null)
const useTree = () => useContext(TreeContext) as TreeCtx

const sectionKey = (id: SectionId) => `section:${id}`

function editableKind(kind: TreeNode['kind']): TreeKind | null {
  return kind === 'folder' || kind === 'flow' || kind === 'template' || kind === 'entity' ? kind : null
}

// ---------------------------------------------------------------------------

export function NavTree() {
  const project = useProjectStore((s) => s.project) as Project
  const selection = useProjectStore((s) => s.selection)
  const select = useProjectStore((s) => s.select)
  const setRenaming = useProjectStore((s) => s.setRenaming)

  // Expansion is per-machine UI state, never part of the project file.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([...SECTIONS.map((s) => sectionKey(s.id)), 'section:state']))
  const toggle = useCallback(
    (key: string) =>
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      }),
    []
  )
  const expand = useCallback((key: string) => setExpanded((prev) => (prev.has(key) ? prev : new Set(prev).add(key))), [])

  // Reveal the selection: when something is selected (e.g. created, or opened
  // from a link), expand its section and the folders above it.
  useEffect(() => {
    if (!isTreeSelection(selection)) return
    const col = { folder: 'folders', flow: 'flows', template: 'templates', entity: 'entities' } as const
    const item = project[col[selection.kind]][selection.id] as { folderId?: string | null; parentId?: string | null; section?: SectionId } | undefined
    if (!item) return
    const section: SectionId | undefined =
      selection.kind === 'folder' ? item.section : ({ flow: 'flows', template: 'templates', entity: 'entities' } as const)[selection.kind]
    const keys: string[] = section ? [sectionKey(section)] : []
    let cur = (selection.kind === 'folder' ? item.parentId : item.folderId) ?? null
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      keys.push(cur)
      cur = project.folders[cur]?.parentId ?? null
    }
    setExpanded((prev) => (keys.every((k) => prev.has(k)) ? prev : new Set([...prev, ...keys])))
  }, [selection, project])

  const picker = usePopover()
  const [pickerFolder, setPickerFolder] = useState<string | null>(null)

  const create = useCallback(
    (section: SectionId, folderId: string | null, trigger: Element) => {
      expand(sectionKey(section))
      if (folderId) expand(folderId)
      if (section === 'flows') createFlow(folderId)
      else if (section === 'templates') createTemplate(folderId)
      else if (section === 'entities') {
        setPickerFolder(folderId)
        picker.open(trigger)
      }
    },
    [expand, picker]
  )

  const ctx = useMemo(() => ({ project, expanded, toggle, expand, create }), [project, expanded, toggle, expand, create])

  const trees = useMemo(
    () => Object.fromEntries(SECTIONS.map((s) => [s.id, buildSectionTree(project, s.id)])) as Record<SectionId, TreeNode[]>,
    [project]
  )

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    if (!isTreeSelection(selection)) return
    if (e.key === 'F2') {
      e.preventDefault()
      setRenaming(selection.id)
    } else if (e.key === 'Delete' || (e.key === 'Backspace' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault()
      void confirmAndDelete(project, selection.kind, selection.id)
    } else if (e.key === 'd' && (e.ctrlKey || e.metaKey) && selection.kind === 'entity') {
      e.preventDefault()
      duplicateEntity(selection.id)
    }
  }

  return (
    <TreeContext.Provider value={ctx}>
      {/* tabIndex -1: clicking a row focuses the tree so F2 / Delete reach it. */}
      <div className="flex h-full flex-col bg-panel outline-none" tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="flex h-9 shrink-0 items-center px-3 text-2xs font-semibold uppercase tracking-wider text-faint">
          Explorer
        </div>
        <button
          type="button"
          onClick={() => select({ kind: 'project' })}
          className={cx(
            'mx-1.5 mb-1 flex h-7 items-center gap-2 rounded-md px-2 text-left transition-colors',
            selection?.kind === 'project' ? 'bg-accent/15 text-fg' : 'text-muted hover:bg-raised hover:text-fg'
          )}
        >
          <BookOpen size={14} className="shrink-0 text-accent" />
          <span className="truncate font-medium">{project.meta.name}</span>
        </button>

        <div className="flex-1 overflow-y-auto overflow-x-hidden px-1.5 pb-4" role="tree" aria-label="Project">
          {SECTIONS.map((section) => (
            <Section key={section.id} def={section} nodes={trees[section.id]} />
          ))}
          <StateSection />
        </div>
      </div>
      <TemplatePicker project={project} anchor={picker.anchor} onClose={picker.close} folderId={pickerFolder} />
    </TreeContext.Provider>
  )
}

// ---------------------------------------------------------------------------

function Section({ def, nodes }: { def: SectionDef; nodes: TreeNode[] }) {
  const { expanded, toggle, expand, create } = useTree()
  const key = sectionKey(def.id)
  const open = expanded.has(key)
  const Icon = def.icon

  return (
    <div className="mt-1" role="treeitem" aria-expanded={open}>
      <div className="group flex h-7 items-center gap-1 rounded-md pl-1 pr-1 hover:bg-raised/60">
        <button
          type="button"
          onClick={() => toggle(key)}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-semibold text-muted"
        >
          <Chevron open={open} />
          <Icon size={14} strokeWidth={1.8} className="shrink-0" />
          <span className="truncate">{def.label}</span>
          {nodes.length > 0 && <span className="ml-1 text-2xs font-normal text-faint">{countLeaves(nodes)}</span>}
        </button>
        <div className="flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <IconButton
            size="sm"
            icon={FolderPlus}
            label={`New folder in ${def.label}`}
            onClick={() => {
              expand(key)
              createFolder(def.id, null)
            }}
          />
          {def.itemLabel && (
            <IconButton size="sm" icon={Plus} label={`New ${def.itemLabel}`} onClick={(e) => create(def.id, null, e.currentTarget)} />
          )}
        </div>
      </div>

      <Collapse open={open}>
        {nodes.length === 0 ? (
          <p className="py-1.5 pl-8 pr-2 text-2xs leading-snug text-faint">
            {def.comingIn ? `Empty — creating ${def.label.toLowerCase()} arrives in ${def.comingIn}.` : (def.emptyHint ?? 'Empty')}
          </p>
        ) : (
          nodes.map((node) => <Row key={node.id} node={node} depth={1} section={def} />)
        )}
      </Collapse>
    </div>
  )
}

function Row({ node, depth, section }: { node: TreeNode; depth: number; section: SectionDef }) {
  const { project, expanded, toggle, expand, create } = useTree()
  const isSelected = useProjectStore((s) => s.selection !== null && s.selection.kind !== 'project' && s.selection.id === node.id)
  const isActive = useProjectStore((s) => s.activeDoc?.id === node.id)
  const isRenaming = useProjectStore((s) => s.renamingId === node.id)
  const select = useProjectStore((s) => s.select)
  const setRenaming = useProjectStore((s) => s.setRenaming)
  const issueLevel = worstLevel(useIssues().get(node.id))

  const isFolder = node.kind === 'folder'
  const kind = editableKind(node.kind)
  const open = isFolder && expanded.has(node.id)

  // Templates and entities show their template's icon and colour.
  const template =
    node.kind === 'template'
      ? project.templates[node.id]
      : node.kind === 'entity'
        ? project.templates[project.entities[node.id]?.templateId ?? '']
        : undefined
  const Icon = isFolder ? (open ? FolderOpen : Folder) : template ? templateIcon(template.icon) : NODE_ICON[node.kind]
  const iconColor = template?.color ?? (isActive ? 'rgb(var(--c-accent))' : undefined)

  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (isSelected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [isSelected])

  return (
    <div role="treeitem" aria-selected={isSelected} aria-expanded={isFolder ? open : undefined}>
      <motion.div
        ref={ref}
        layout="position"
        onClick={() => {
          if (kind) select({ kind, id: node.id })
          if (isFolder) toggle(node.id)
        }}
        onDoubleClick={() => kind && setRenaming(node.id)}
        className={cx(
          'group relative flex h-7 cursor-default items-center gap-1.5 rounded-md pr-1 transition-colors',
          isSelected ? 'bg-accent/15 text-fg' : 'text-muted hover:bg-raised hover:text-fg'
        )}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        {isSelected && (
          <motion.span
            layoutId="tree-selection"
            className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent"
            transition={{ type: 'spring', stiffness: 600, damping: 40 }}
          />
        )}
        {isFolder ? <Chevron open={open} /> : <span className="w-3.5 shrink-0" />}
        <Icon
          size={14}
          strokeWidth={1.8}
          className={cx('shrink-0', !iconColor && 'text-faint', template && !isSelected && 'opacity-90')}
          style={iconColor ? { color: iconColor } : undefined}
        />
        {isRenaming && kind ? (
          <InlineRename
            initial={node.name}
            onDone={(value) => {
              if (value !== null) renameItem(kind, node.id, value)
              setRenaming(null)
            }}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
        )}

        {!isRenaming && issueLevel && (
          <span className="shrink-0 group-hover:hidden" title={issueLevel === 'error' ? 'Has errors' : 'Has warnings'}>
            {issueLevel === 'error' ? <XCircle size={12} className="text-danger" /> : <AlertTriangle size={12} className="text-warn" />}
          </span>
        )}

        {!isRenaming && kind && (
          <div
            className="hidden group-focus-within:flex group-hover:flex"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {isFolder && (
              <IconButton
                size="sm"
                icon={FolderPlus}
                label="New subfolder"
                onClick={() => {
                  expand(node.id)
                  createFolder(section.id, node.id)
                }}
              />
            )}
            {isFolder && section.itemLabel && (
              <IconButton
                size="sm"
                icon={Plus}
                label={`New ${section.itemLabel} here`}
                onClick={(e) => create(section.id, node.id, e.currentTarget)}
              />
            )}
            {node.kind === 'entity' && (
              <IconButton size="sm" icon={Copy} label="Duplicate" onClick={() => duplicateEntity(node.id)} />
            )}
            <IconButton
              size="sm"
              tone="danger"
              icon={Trash2}
              label={`Delete ${node.name}`}
              onClick={() => void confirmAndDelete(project, kind, node.id)}
            />
          </div>
        )}
      </motion.div>

      {isFolder && (
        <Collapse open={open}>
          {node.children.length === 0 ? (
            <p className="py-1 text-2xs text-faint" style={{ paddingLeft: (depth + 1) * 12 + 22 }}>
              Empty folder
            </p>
          ) : (
            node.children.map((child) => <Row key={child.id} node={child} depth={depth + 1} section={section} />)
          )}
        </Collapse>
      )}
    </div>
  )
}

const NODE_ICON: Record<TreeNode['kind'], LucideIcon> = {
  folder: Folder,
  flow: Workflow,
  entity: Boxes,
  template: Shapes
}

// ---------------------------------------------------------------------------

/** The State section: three fixed documents rather than user-created items. */
function StateSection() {
  const { expanded, toggle } = useTree()
  const issues = useIssues()
  const project = useProjectStore((s) => s.project) as Project
  const selection = useProjectStore((s) => s.selection)
  const select = useProjectStore((s) => s.select)
  const open = expanded.has('section:state')
  const counts: Record<StateDocId, number> = {
    world: Object.keys(project.state.variables).length,
    relationships: Object.keys(project.state.relationships).length,
    time: Object.keys(project.state.rules).length
  }
  const level = (doc: StateDocId) => {
    const ids =
      doc === 'world'
        ? Object.keys(project.state.variables)
        : doc === 'relationships'
          ? Object.keys(project.state.relationships)
          : ['state:time', ...Object.keys(project.state.rules), ...Object.keys(project.state.time.phases)]
    return worstLevel(ids.flatMap((id) => issues.get(id) ?? []))
  }

  return (
    <div className="mt-1" role="treeitem" aria-expanded={open}>
      <div className="group flex h-7 items-center gap-1 rounded-md pl-1 pr-1 hover:bg-raised/60">
        <button
          type="button"
          onClick={() => toggle('section:state')}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-semibold text-muted"
        >
          <Chevron open={open} />
          <Braces size={14} strokeWidth={1.8} className="shrink-0" />
          <span className="truncate">State</span>
        </button>
      </div>
      <Collapse open={open}>
        {(Object.keys(STATE_DOCS) as StateDocId[]).map((doc) => {
          const meta = STATE_DOCS[doc]
          const Icon = meta.icon
          const isSelected = selection?.kind === 'state' && selection.id === doc
          const lv = level(doc)
          return (
            <div
              key={doc}
              onClick={() => select({ kind: 'state', id: doc })}
              className={cx(
                'relative flex h-7 cursor-default items-center gap-1.5 rounded-md pr-1.5 transition-colors',
                isSelected ? 'bg-accent/15 text-fg' : 'text-muted hover:bg-raised hover:text-fg'
              )}
              style={{ paddingLeft: 16 + 4 }}
              role="treeitem"
              aria-selected={isSelected}
            >
              {isSelected && (
                <motion.span
                  layoutId="tree-selection"
                  className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent"
                  transition={{ type: 'spring', stiffness: 600, damping: 40 }}
                />
              )}
              <span className="w-3.5 shrink-0" />
              <Icon size={14} strokeWidth={1.8} style={{ color: meta.color }} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{meta.title}</span>
              {lv && (lv === 'error' ? <XCircle size={12} className="text-danger" /> : <AlertTriangle size={12} className="text-warn" />)}
              {counts[doc] > 0 && <span className="text-2xs text-faint">{counts[doc]}</span>}
            </div>
          )
        })}
      </Collapse>
    </div>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <motion.span
      animate={{ rotate: open ? 90 : 0 }}
      transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      className="flex w-3.5 shrink-0 items-center justify-center text-faint"
    >
      <ChevronRight size={12} strokeWidth={2.2} />
    </motion.span>
  )
}

function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
          className="overflow-hidden"
          role="group"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function InlineRename({ initial, onDone }: { initial: string; onDone: (value: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initial)
  const done = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const finish = (result: string | null) => {
    if (done.current) return
    done.current = true
    onDone(result !== null && result.trim() ? result.trim() : null)
  }

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(value)
        else if (e.key === 'Escape') finish(null)
      }}
      onBlur={() => finish(value)}
      spellCheck={false}
      className="h-5 min-w-0 flex-1 rounded bg-bg px-1 text-fg outline-none ring-1 ring-accent"
    />
  )
}

function countLeaves(nodes: TreeNode[]): number {
  return nodes.reduce((n, node) => n + (node.kind === 'folder' ? countLeaves(node.children) : 1), 0)
}
