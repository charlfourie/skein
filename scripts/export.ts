/**
 * Export a project for game engines from the command line (for build pipelines).
 *
 *   npm run export -- project.skein.json out/game.json [--compact] [--no-source]
 *
 * Exits with status 1 if the project has errors, unless --allow-errors is given.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { buildExport, serializeExport } from '../src/shared/export/build'
import { parseProject } from '../src/shared/parse'

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const [input, output] = args.filter((a) => !a.startsWith('--'))
if (!input || !output) {
  console.error('Usage: npm run export -- <project.skein.json> <out.json> [--compact] [--no-source] [--allow-errors]')
  process.exit(2)
}

const parsed = parseProject(readFileSync(input, 'utf8'))
if (!parsed.ok) {
  console.error(`Couldn't read ${input}:\n${parsed.error}`)
  process.exit(1)
}
for (const r of parsed.repairs) console.warn(`repaired: ${r}`)

const { file, problems } = buildExport(parsed.project, { includeSource: !flags.has('--no-source') })
for (const p of problems) console[p.level === 'error' ? 'error' : 'warn'](`${p.level}: ${p.message}`)
const errors = problems.filter((p) => p.level === 'error').length
if (errors && !flags.has('--allow-errors')) {
  console.error(`${errors} error(s); not exported. Fix them, or pass --allow-errors.`)
  process.exit(1)
}

const text = serializeExport(file, flags.has('--compact'))
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, text)
console.log(`Exported ${Object.keys(file.flows).length} flows, ${Object.keys(file.entities).length} entities → ${output} (${(text.length / 1024).toFixed(1)} KB)`)
