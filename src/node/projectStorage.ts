import { promises as fs } from 'fs'
import { join } from 'path'
import { FLOWS_DIR, PROJECT_FILE, planWrite, splitProject, type ProjectFiles } from '../shared/projectFiles'
import type { Project } from '../shared/schema'
import { hashText, readTextFile, writeFileAtomic } from './storage'

/** Read a project folder's files: project.json and flows/*.json (temp files and hidden files are skipped). */
export async function readProjectFolder(dir: string): Promise<ProjectFiles> {
  const files: ProjectFiles = { [PROJECT_FILE]: await readTextFile(join(dir, PROJECT_FILE)) }
  let names: string[] = []
  try {
    names = await fs.readdir(join(dir, FLOWS_DIR))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  for (const name of names.sort()) {
    if (name.startsWith('.') || !name.toLowerCase().endsWith('.json')) continue
    files[`${FLOWS_DIR}/${name}`] = await readTextFile(join(dir, FLOWS_DIR, name))
  }
  return files
}

/** One hash for the whole folder, to tell our own saves from someone else's changes. */
export function folderHash(files: ProjectFiles): string {
  return hashText(
    Object.keys(files)
      .sort()
      .map((k) => `${k}\u0000${files[k]}`)
      .join('\u0001')
  )
}

/**
 * Save a project as a folder. Only files whose contents changed are written
 * (each atomically), and flow files that no longer belong (a renamed or
 * deleted flow) are removed. project.json is written last, so a save that
 * fails part-way never leaves a project.json pointing at flows it doesn't have.
 */
export async function writeProjectFolder(dir: string, project: Project): Promise<{ files: ProjectFiles; bytes: number }> {
  const next = splitProject(project)
  await fs.mkdir(join(dir, FLOWS_DIR), { recursive: true })
  let existing: ProjectFiles = {}
  try {
    existing = await readProjectFolder(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  const { write, remove } = planWrite(next, existing)
  const order = Object.keys(write).sort((a, b) => (a === PROJECT_FILE ? 1 : b === PROJECT_FILE ? -1 : a < b ? -1 : 1))
  for (const path of order) await writeFileAtomic(join(dir, ...path.split('/')), write[path])
  for (const path of remove) await fs.rm(join(dir, ...path.split('/')), { force: true })
  const bytes = Object.values(next).reduce((n, t) => n + Buffer.byteLength(t, 'utf8'), 0)
  return { files: next, bytes }
}

/** What's in a folder chosen to save a new project into: only an existing Skein project (or nothing) may be overwritten. */
export async function folderIsUsable(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir)
    return entries.filter((e) => !e.startsWith('.')).every((e) => e === PROJECT_FILE || e === FLOWS_DIR)
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT'
  }
}
