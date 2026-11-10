import { collectFolderSubtree, findEntityReferences, findSpeakerLines, instancesOf } from '@shared/mutations'
import { SECTION_IDS, type Project } from '@shared/schema'
import { deleteItem } from '../store/ops'
import type { TreeKind } from '../store/projectStore'

const NOUNS = {
  flows: ['flow', 'flows'],
  entities: ['entity', 'entities'],
  templates: ['template', 'templates']
} as const

function plural(n: number, word: string): string {
  if (word === 'entity') return `${n} ${n === 1 ? 'entity' : 'entities'}`
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/**
 * Ask before deleting, spelling out what else goes with it. Deletes are
 * undoable (Ctrl+Z), so trivial ones (an empty folder, an unreferenced
 * entity) skip the dialog.
 */
export async function confirmAndDelete(project: Project, kind: TreeKind, id: string): Promise<void> {
  const ask = (message: string, detail?: string) =>
    window.api.confirm({ message, detail: detail ? `${detail}\nYou can undo this with Ctrl+Z.` : undefined, confirmLabel: 'Delete', danger: true })

  if (kind === 'flow') {
    const flow = project.flows[id]
    if (!flow) return
    const nodes = Object.keys(flow.nodes).length
    if (nodes === 0 || (await ask(`Delete the flow “${flow.name}”?`, `It contains ${plural(nodes, 'node')}.`))) deleteItem('flow', id)
    return
  }

  if (kind === 'entity') {
    const entity = project.entities[id]
    if (!entity) return
    const refs = findEntityReferences(project, id).length
    const lines = findSpeakerLines(project, id).length
    const parts = [
      refs && `${plural(refs, 'link')} to it from other entities`,
      lines && `it as the speaker of ${plural(lines, 'dialogue line')}`
    ].filter(Boolean)
    if (parts.length === 0 || (await ask(`Delete “${entity.name}”?`, `This clears ${parts.join(', and ')}.`))) {
      deleteItem('entity', id)
    }
    return
  }

  if (kind === 'template') {
    const template = project.templates[id]
    if (!template) return
    const instances = instancesOf(project, new Set([id])).length
    if (
      instances === 0 ||
      (await ask(`Delete the template “${template.name}”?`, `Its ${plural(instances, 'entity')} will be deleted too.`))
    ) {
      deleteItem('template', id)
    }
    return
  }

  const folder = project.folders[id]
  if (!folder) return
  const subtree = collectFolderSubtree(project, id)
  const parts: string[] = []
  if (subtree.size > 1) parts.push(plural(subtree.size - 1, 'subfolder'))
  for (const section of SECTION_IDS) {
    const items = (Object.values(project[section]) as Array<{ folderId: string | null }>).filter(
      (i) => i.folderId !== null && subtree.has(i.folderId)
    ).length
    const [one, many] = NOUNS[section]
    if (items > 0) parts.push(`${items} ${items === 1 ? one : many}`)
  }
  if (folder.section === 'templates') {
    const templateIds = new Set(
      Object.values(project.templates)
        .filter((t) => t.folderId !== null && subtree.has(t.folderId))
        .map((t) => t.id)
    )
    const instances = instancesOf(project, templateIds).length
    if (instances > 0) parts.push(`${plural(instances, 'entity')} using those templates`)
  }
  if (parts.length === 0 || (await ask(`Delete the folder “${folder.name}”?`, `Everything inside goes too: ${parts.join(', ')}.`))) {
    deleteItem('folder', id)
  }
}
