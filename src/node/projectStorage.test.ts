import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { parseProject } from '../shared/parse'
import { parseProjectFiles } from '../shared/projectFiles'
import { serializeProject } from '../shared/serialize'
import { folderHash, folderIsUsable, readProjectFolder, writeProjectFolder } from './projectStorage'

const coffee = () => {
  const r = parseProject(readFileSync('src/renderer/src/demos/coffee-order.skein.json', 'utf8'))
  if (!r.ok) throw new Error(r.error)
  return r.project
}

describe('project folders on disk', () => {
  it('writes a folder, reads it back, and only rewrites what changed', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'skein-')), 'Coffee.skein')
    expect(await folderIsUsable(dir)).toBe(true)
    const p = coffee()
    await writeProjectFolder(dir, p)
    expect(readdirSync(dir).sort()).toEqual(['flows', 'project.json'])
    const files = await readProjectFolder(dir)
    const back = parseProjectFiles(files)
    if (!back.ok) throw new Error(back.error)
    expect(serializeProject(back.project)).toBe(serializeProject(p))

    // Rename the flow: the old file goes, the new one appears, project.json is untouched.
    const before = folderHash(files)
    const q = produce(p, (d) => {
      Object.values(d.flows)[0].name = 'Second Order'
    })
    const mtime = readFileSync(join(dir, 'project.json'), 'utf8')
    await writeProjectFolder(dir, q)
    expect(readdirSync(join(dir, 'flows'))).toEqual([expect.stringMatching(/^second-order\.[0-9a-f]{6}\.json$/)])
    expect(readFileSync(join(dir, 'project.json'), 'utf8')).toBe(mtime)
    expect(folderHash(await readProjectFolder(dir))).not.toBe(before)
    expect(await folderIsUsable(dir)).toBe(true)
  })

  it('refuses to save into a folder that holds something else', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'skein-'))
    writeFileSync(join(dir, 'notes.txt'), 'mine')
    expect(await folderIsUsable(dir)).toBe(false)
  })
})
