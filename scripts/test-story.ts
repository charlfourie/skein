/**
 * Run a project's story tests from the command line (for build pipelines).
 *
 *   npm run test:story -- <project.skein.json | Project.skein folder> [--json]
 *
 * Exits with status 1 if any test fails or can't run, so a game's CI can
 * check its story on every push without opening the editor.
 */
import { runStoryTests } from '../src/shared/play/storyTests'
import { loadProject } from './loadProject'

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const [input] = args.filter((a) => !a.startsWith('--'))
if (!input) {
  console.error('Usage: npm run test:story -- <project.skein.json | Project.skein> [--json]')
  process.exit(2)
}

async function main(): Promise<void> {
  const project = await loadProject(input)
  const results = runStoryTests(project)
  const bad = results.filter((r) => r.status !== 'pass')

  if (flags.has('--json')) {
    console.log(JSON.stringify({ passed: results.length - bad.length, failed: bad.length, results }, null, 2))
  } else {
    const mark = { pass: '✓', fail: '✗', broken: '!' } as const
    for (const r of results) {
      const flow = project.flows[r.flowId]?.name ?? '(deleted flow)'
      const paths = r.paths !== undefined ? ` · ${r.paths.toLocaleString('en')} paths` : ''
      console.log(`${mark[r.status]} ${r.name || '(unnamed test)'}  [${flow}${paths}]`)
      for (const f of r.failures) {
        console.log(`    ${f.message}`)
        if (f.example?.choices.length) console.log(`    path: ${f.example.choices.join(' → ')}`)
      }
    }
    if (!results.length) console.log('No story tests in this project yet.')
    else console.log(`\n${results.length - bad.length} passed, ${bad.length} ${bad.length === 1 ? 'needs' : 'need'} attention.`)
  }
  process.exit(bad.length ? 1 : 0)
}

void main()
