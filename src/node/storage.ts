import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { basename, dirname, join } from 'path'

export async function readTextFile(path: string): Promise<string> {
  const buf = await fs.readFile(path)
  return buf.toString('utf8')
}

export function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES'])

/**
 * Crash-safe write: write a sibling temp file, fsync it, then atomically rename
 * it over the target. A crash or power loss mid-save leaves either the old file
 * or the new one, never a truncated half-file.
 *
 * On Windows, renames can fail briefly while antivirus or a sync client (Dropbox,
 * OneDrive) holds the target open, so those errors are retried with backoff.
 */
export async function writeFileAtomic(target: string, contents: string): Promise<void> {
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}.${Date.now().toString(36)}.tmp`)
  const handle = await fs.open(tmp, 'w')
  try {
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await renameWithRetry(tmp, target)
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    throw err
  }
}

async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await fs.rename(from, to)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (i >= attempts - 1 || !code || !RETRYABLE.has(code)) throw err
      await new Promise((r) => setTimeout(r, 50 * 2 ** i))
    }
  }
}
