import type { Project } from '../schema'
import { compile } from './check'
import { forEachSite, type SiteOwner } from './sites'

/** How often each piece of state is referenced, by definition id (variable, property or relationship id). */
export interface UsageIndex {
  count: Map<string, number>
  sites: Map<string, SiteOwner[]>
}

const cache = new WeakMap<Project, UsageIndex>()

export function stateUsage(project: Project): UsageIndex {
  const hit = cache.get(project)
  if (hit) return hit
  const count = new Map<string, number>()
  const sites = new Map<string, SiteOwner[]>()
  forEachSite(project, (site) => {
    const seen = new Set<string>()
    for (const ref of compile(project, site.source, site.mode, site.ctx).refs) {
      const id = ref.kind === 'world' ? ref.varId : ref.kind === 'prop' ? ref.propId : ref.kind === 'rel' ? ref.relId : ref.kind === 'visit' ? `visit:${ref.nodeId}` : `time:${ref.field}`
      if (seen.has(id)) continue
      seen.add(id)
      count.set(id, (count.get(id) ?? 0) + 1)
      sites.set(id, [...(sites.get(id) ?? []), site.owner])
    }
  })
  const index = { count, sites }
  cache.set(project, index)
  return index
}
