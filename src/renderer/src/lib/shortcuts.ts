import { isMac } from './platform'

/** Every keyboard shortcut, for the ? sheet. Keep docs/WEB.md in step. */
export interface ShortcutGroup {
  title: string
  items: { keys: string[]; does: string }[]
}

const mod = isMac ? '⌘' : 'Ctrl'
const alt = isMac ? '⌥' : 'Alt'
const shift = isMac ? '⇧' : 'Shift'

export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Project',
    items: [
      { keys: [`${mod}+O`], does: 'Open a project' },
      { keys: [`${mod}+${shift}+O`], does: 'Open a single .skein.json file' },
      { keys: [`${mod}+S`], does: 'Save' },
      { keys: [`${mod}+${shift}+S`], does: 'Save as' },
      { keys: [`${mod}+E`], does: 'Export for a game engine' },
      { keys: [`${alt}+N`], does: 'New project' },
      { keys: [`${mod}+${shift}+W`], does: 'Close the project' },
      { keys: [`${mod}+Z`, isMac ? `${mod}+${shift}+Z` : `${mod}+Y`], does: 'Undo, redo' },
      { keys: [`${mod}+F`], does: 'Search and replace' },
      { keys: ['?'], does: 'These shortcuts' }
    ]
  },
  {
    title: 'Canvas',
    items: [
      { keys: ['Double-click'], does: 'Add a node there' },
      { keys: [`${mod}+C`, `${mod}+X`, `${mod}+V`], does: 'Copy, cut, paste nodes (paste a scene written as text, too)' },
      { keys: [`${mod}+D`], does: 'Duplicate the selected nodes' },
      { keys: [`${mod}+G`], does: 'Frame the selected nodes' },
      { keys: ['Delete'], does: 'Delete the selection' },
      { keys: [`${mod}+click`], does: 'Select several' },
      { keys: [`${shift}+drag`], does: 'Select with a box' }
    ]
  },
  {
    title: 'Writing lines',
    items: [
      { keys: ['Enter'], does: 'The next line, below, spoken by whoever spoke before' },
      { keys: [`${mod}+Enter`], does: 'Another choice beside this one' },
      { keys: [`${alt}+↑`, `${alt}+↓`], does: 'Change the speaker' },
      { keys: [`${shift}+Enter`], does: 'A line break, in a line’s text' },
      { keys: ['Esc'], does: 'From a line’s text back to the canvas' }
    ]
  },
  {
    title: 'Explorer',
    items: [
      { keys: ['F2'], does: 'Rename' },
      { keys: [`${mod}+D`], does: 'Duplicate an entity' },
      { keys: ['Delete'], does: 'Delete' }
    ]
  }
]
