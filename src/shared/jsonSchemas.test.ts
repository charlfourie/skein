import Ajv from 'ajv'
import { readdirSync, readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { buildExport } from './export/build'
import { ExportFileSchema } from './export/exportSchema'
import { jsonSchemas } from './jsonSchemas'
import { parseProject } from './parse'
import { splitProject } from './projectFiles'

const projects = ['src/renderer/src/demos/coffee-order.skein.json', 'src/renderer/src/demos/museum-heist.skein.json', 'examples/lighthouse-v2.skein.json'].map((path) => {
  const r = parseProject(readFileSync(path, 'utf8'))
  if (!r.ok) throw new Error(r.error)
  return r.project
})
const fixtures = readdirSync('runtimes/conformance/fixtures')
  .filter((f) => f.endsWith('.game.json'))
  .map((f) => JSON.parse(readFileSync(`runtimes/conformance/fixtures/${f}`, 'utf8')))

describe('published JSON Schemas', () => {
  it('are up to date (run npm run make:schemas)', () => {
    const files = jsonSchemas()
    for (const [file, text] of Object.entries(files)) expect(readFileSync(`schemas/${file}`, 'utf8'), file).toBe(text)
    expect(readdirSync('schemas').filter((f) => f.endsWith('.json')).sort()).toEqual(Object.keys(files).sort())
  })

  it('accept every export the editor writes, and the conformance fixtures', () => {
    const ajv = new Ajv({ strict: false, allErrors: true })
    const schema = JSON.parse(Object.entries(jsonSchemas()).find(([f]) => f.startsWith('skein.export'))![1])
    const check = ajv.compile(schema)
    for (const file of [...projects.map((p) => buildExport(p).file), ...fixtures]) {
      expect(ExportFileSchema.safeParse(file).success).toBe(true)
      expect(check(file), JSON.stringify(check.errors?.slice(0, 2))).toBe(true)
    }
    expect(check({ ...buildExport(projects[0]).file, surprise: 1 })).toBe(false)
  })

  it('accept projects, both as one file and as a folder', () => {
    const ajv = new Ajv({ strict: false, allErrors: true })
    const all = jsonSchemas()
    const projectSchema = ajv.compile(JSON.parse(Object.entries(all).find(([f]) => f.startsWith('skein.project'))![1]))
    const flowSchema = ajv.compile(JSON.parse(Object.entries(all).find(([f]) => f.startsWith('skein.flow'))![1]))
    for (const p of projects) {
      expect(projectSchema(JSON.parse(JSON.stringify(p))), JSON.stringify(projectSchema.errors?.slice(0, 2))).toBe(true)
      for (const [path, text] of Object.entries(splitProject(p))) {
        const ok = path === 'project.json' ? projectSchema(JSON.parse(text)) : flowSchema(JSON.parse(text))
        expect(ok, `${path}: ${JSON.stringify((path === 'project.json' ? projectSchema : flowSchema).errors?.slice(0, 2))}`).toBe(true)
      }
    }
  })
})
