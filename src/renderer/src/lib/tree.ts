import { compareOrder } from '@shared/order'
import type { Folder, Project, SectionId, TreeItem } from '@shared/schema'

export type ItemKind = 'flow' | 'entity' | 'template'
export type TreeNodeKind = 'folder' | ItemKind

export interface TreeNode {
  kind: TreeNodeKind
  id: string
  name: string
  children: TreeNode[]
}

export const ITEM_KIND: Record<SectionId, ItemKind> = {
  flows: 'flow',
  entities: 'entity',
  templates: 'template'
}

type ProjectLike = Pick<Project, 'folders' | SectionId>

export { compareOrder }

export function nextOrder(siblings: Array<{ order: number }>): number {
  return siblings.reduce((max, s) => Math.max(max, s.order), -1) + 1
}

export function sectionItems(project: ProjectLike, section: SectionId): TreeItem[] {
  return Object.values(project[section]) as unknown as TreeItem[]
}

function groupBy<T>(items: T[], key: (item: T) => string | null): Map<string | null, T[]> {
  const map = new Map<string | null, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = map.get(k)
    if (list) list.push(item)
    else map.set(k, [item])
  }
  return map
}

export function buildSectionTree(project: ProjectLike, section: SectionId): TreeNode[] {
  const folders = Object.values(project.folders).filter((f) => f.section === section)
  const foldersByParent = groupBy<Folder>(folders, (f) => f.parentId ?? null)
  const itemsByFolder = groupBy(sectionItems(project, section), (i) => i.folderId ?? null)
  const itemKind = ITEM_KIND[section]

  const build = (parentId: string | null, ancestors: Set<string>): TreeNode[] => [
    ...(foldersByParent.get(parentId) ?? [])
      .filter((f) => !ancestors.has(f.id))
      .sort(compareOrder)
      .map((f) => ({
        kind: 'folder' as const,
        id: f.id,
        name: f.name,
        children: build(f.id, new Set(ancestors).add(f.id))
      })),
    ...(itemsByFolder.get(parentId) ?? [])
      .slice()
      .sort(compareOrder)
      .map((i) => ({ kind: itemKind, id: i.id, name: i.name, children: [] }))
  ]

  return build(null, new Set())
}

export { collectFolderSubtree } from '@shared/mutations'

/** Number of items (in any section) that live inside the given folders. */
export function countItemsIn(project: ProjectLike, folderIds: Set<string>, section: SectionId): number {
  return sectionItems(project, section).filter((i) => i.folderId !== null && folderIds.has(i.folderId)).length
}

/** Folder names from the section root down to (and including) `folderId`. */
export function folderPath(project: Pick<Project, 'folders'>, folderId: string | null): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  let cur = folderId
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const folder = project.folders[cur]
    if (!folder) break
    names.unshift(folder.name)
    cur = folder.parentId
  }
  return names
}
