import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { parseProject } from '../shared/parse'
import { splitProject } from '../shared/projectFiles'
import type { ExternalChange } from '../shared/ipc'
import { folderHash, readProjectFolder, writeProjectFolder } from './projectStorage'
import { ProjectWatcher } from './watcher'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('watching a project folder', () => {
  it('ignores our own saves and reports a change to any flow file', async () => {
    const r = parseProject(readFileSync('src/renderer/src/demos/coffee-order.skein.json', 'utf8'))
    if (!r.ok) throw new Error(r.error)
    const dir = join(mkdtempSync(join(tmpdir(), 'skein-')), 'Coffee.skein')
    await writeProjectFolder(dir, r.project)
    const seen: ExternalChange[] = []
    const watcher = new ProjectWatcher((c) => seen.push(c))
    const path = join(dir, 'project.json')
    watcher.watch(path, folderHash(await readProjectFolder(dir)), true)

    // Our own save (as the main process does it).
    const next = produce(r.project, (d) => {
      Object.values(d.flows)[0].name = 'Renamed'
    })
    const hash = folderHash(splitProject(next))
    watcher.watch(path, hash, true)
    watcher.pause()
    await writeProjectFolder(dir, next)
    watcher.resume(hash)
    await wait(700)
    expect(seen).toEqual([])

    // Someone else's change (a git pull) to a flow file.
    const files = await readProjectFolder(dir)
    const flow = Object.keys(files).find((k) => k.startsWith('flows/'))!
    writeFileSync(join(dir, flow), files[flow].replace('"Renamed"', '"Pulled"'))
    await wait(900)
    watcher.stop()
    expect(seen).toEqual([{ path, deleted: false }])
  })
})
