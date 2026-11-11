/**
 * Load a project for the command-line tools: a single .skein.json file, a
 * project folder, or a project folder's project.json. Exits with a message
 * when it can't.
 */
import { existsSync, readFileSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { readProjectFolder } from '../src/node/projectStorage'
import { parseProject, type ParseResult } from '../src/shared/parse'
import { PROJECT_FILE, isFolderProjectPath, parseProjectFiles } from '../src/shared/projectFiles'
import type { Project } from '../src/shared/schema'

export async function loadProject(path: string): Promise<Project> {
  let parsed: ParseResult
  if (!existsSync(path)) {
    console.error(`Couldn't find ${path}.`)
    process.exit(1)
  }
  if (statSync(path).isDirectory() || isFolderProjectPath(path)) {
    const dir = statSync(path).isDirectory() ? path : dirname(path)
    if (!existsSync(join(dir, PROJECT_FILE))) {
      console.error(`${dir} isn't a Skein project folder (it has no ${PROJECT_FILE}).`)
      process.exit(1)
    }
    parsed = parseProjectFiles(await readProjectFolder(dir))
  } else parsed = parseProject(readFileSync(path, 'utf8'))
  if (!parsed.ok) {
    console.error(`Couldn't read ${path}:\n${parsed.error}`)
    process.exit(1)
  }
  for (const r of parsed.repairs) console.warn(`repaired: ${r}`)
  return parsed.project
}
