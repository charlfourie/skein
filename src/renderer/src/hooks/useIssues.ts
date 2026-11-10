import { validateProject, type Issue, type IssueMap } from '@shared/validate'
import { useProjectStore } from '../store/projectStore'

const EMPTY: IssueMap = new Map()
const NONE: Issue[] = []

/** Live validation results for the open project (memoised per project snapshot). */
export function useIssues(): IssueMap {
  const project = useProjectStore((s) => s.project)
  return project ? validateProject(project) : EMPTY
}

export function useIssuesFor(id: string | null | undefined): Issue[] {
  const issues = useIssues()
  return (id && issues.get(id)) || NONE
}
