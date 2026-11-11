import { watch, type FSWatcher } from 'fs'
import { basename, dirname } from 'path'
import type { ExternalChange } from '../shared/ipc'
import { folderHash, readProjectFolder } from './projectStorage'
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
  /** Watching a project folder (path is its project.json): every file in it counts. */
  private folder = false
  /** Saving right now: changes are ours, so they're not reported. */
  private paused = false

  constructor(private readonly notify: (change: ExternalChange) => void) {}

  /** Start (or keep) watching `path`, treating `hash` as the content we know about. */
  watch(path: string, hash: string, folder = false): void {
    if (this.path !== path || this.folder !== folder || !this.fsWatcher) {
      this.stop()
      this.path = path
      this.folder = folder
      try {
        const name = basename(path)
        this.fsWatcher = folder
          ? // A folder project: anything in it, except our own temp files (they start with a dot).
            watch(dirname(path), { persistent: false, recursive: true }, (_event, filename) => {
              const f = filename?.toString() ?? ''
              if (basename(f).startsWith('.')) return
              this.schedule()
            })
          : watch(dirname(path), { persistent: false }, (_event, filename) => {
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

  /** Our own save is about to touch several files: ignore events until `resume`. */
  pause(): void {
    this.paused = true
  }

  resume(hash: string): void {
    this.knownHash = hash
    this.paused = false
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
    if (this.paused) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.check(), 300)
  }

  private async check(): Promise<void> {
    const path = this.path
    if (!path || this.paused) return
    try {
      const hash = this.folder ? folderHash(await readProjectFolder(dirname(path))) : hashText(await readTextFile(path))
      if (this.paused) return
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
