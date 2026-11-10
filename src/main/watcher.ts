import { watch, type FSWatcher } from 'fs'
import { basename, dirname } from 'path'
import type { ExternalChange } from '../shared/ipc'
import { hashText, readTextFile } from './storage'

/**
 * Watches the open project file for changes made outside Skein — a `git pull`,
 * a teammate's copy dropped into a shared folder, a hand edit.
 *
 * The parent directory is watched rather than the file itself, because atomic
 * saves (ours and git's) replace the file, which breaks a file-level watch on
 * most platforms. Our own writes are ignored by comparing content hashes.
 */
export class ProjectWatcher {
  private fsWatcher: FSWatcher | null = null
  private path: string | null = null
  private knownHash: string | null = null
  private missing = false
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly notify: (change: ExternalChange) => void) {}

  /** Start (or keep) watching `path`, treating `hash` as the content we know about. */
  watch(path: string, hash: string): void {
    if (this.path !== path || !this.fsWatcher) {
      this.stop()
      this.path = path
      try {
        const name = basename(path)
        this.fsWatcher = watch(dirname(path), { persistent: false }, (_event, filename) => {
          if (filename && filename.toString() !== name) return
          this.schedule()
        })
        this.fsWatcher.on('error', () => this.closeWatcher())
      } catch {
        this.fsWatcher = null
      }
    }
    this.knownHash = hash
    this.missing = false
  }

  stop(): void {
    this.closeWatcher()
    this.path = null
    this.knownHash = null
    this.missing = false
  }

  private closeWatcher(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.fsWatcher?.close()
    this.fsWatcher = null
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.check(), 300)
  }

  private async check(): Promise<void> {
    const path = this.path
    if (!path) return
    try {
      const hash = hashText(await readTextFile(path))
      this.missing = false
      if (hash === this.knownHash) return
      this.knownHash = hash // notify once per distinct external version
      this.notify({ path, deleted: false })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' && !this.missing) {
        this.missing = true
        this.notify({ path, deleted: true })
      }
    }
  }
}
