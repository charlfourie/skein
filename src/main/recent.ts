import { promises as fs } from 'fs'
import { dirname } from 'path'
import type { RecentProject } from '../shared/ipc'
import { writeFileAtomic } from './storage'

const MAX_RECENT = 12

type Stored = Omit<RecentProject, 'exists'>

function isStored(v: unknown): v is Stored {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return typeof r.path === 'string' && typeof r.name === 'string' && typeof r.openedAt === 'string'
}

/** Recently opened projects, kept in the app's user-data folder (never in the project file). */
export class RecentProjects {
  private items: Stored[] | null = null

  constructor(private readonly file: () => string) {}

  async list(): Promise<Stored[]> {
    if (this.items) return this.items
    try {
      const raw = JSON.parse(await fs.readFile(this.file(), 'utf8')) as unknown
      this.items = Array.isArray(raw) ? raw.filter(isStored).slice(0, MAX_RECENT) : []
    } catch {
      this.items = []
    }
    return this.items
  }

  async listWithExistence(): Promise<RecentProject[]> {
    const items = await this.list()
    return Promise.all(
      items.map(async (item) => ({
        ...item,
        exists: await fs.access(item.path).then(
          () => true,
          () => false
        )
      }))
    )
  }

  async touch(path: string, name: string): Promise<void> {
    const rest = (await this.list()).filter((i) => i.path !== path)
    this.items = [{ path, name, openedAt: new Date().toISOString() }, ...rest].slice(0, MAX_RECENT)
    await this.persist()
  }

  async remove(path: string): Promise<void> {
    this.items = (await this.list()).filter((i) => i.path !== path)
    await this.persist()
  }

  private async persist(): Promise<void> {
    try {
      await fs.mkdir(dirname(this.file()), { recursive: true })
      await writeFileAtomic(this.file(), JSON.stringify(this.items, null, 2) + '\n')
    } catch {
      // The recent list is a convenience; failing to save it must never block the user.
    }
  }
}
