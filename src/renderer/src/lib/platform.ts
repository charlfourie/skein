export const isMac = window.api?.platform === 'darwin'

/** Display label for a shortcut, e.g. shortcut('S') → "⌘S" on macOS, "Ctrl+S" elsewhere. */
export function shortcut(key: string, shift = false): string {
  if (isMac) return `${shift ? '⇧' : ''}⌘${key}`
  return `Ctrl+${shift ? 'Shift+' : ''}${key}`
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i > 0 ? path.slice(0, i) : path
}

/** Turn a project name into a safe default name for its folder or file (no extension). */
export function suggestedProjectName(projectName: string): string {
  const slug = projectName
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 80)
  return slug || 'Untitled'
}

/** Turn a project name into a safe default file name. */
export function suggestedFileName(projectName: string): string {
  return `${suggestedProjectName(projectName)}.skein.json`
}
