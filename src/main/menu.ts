import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../shared/ipc'

export function buildMenu(send: (command: MenuCommand) => void, isDev: boolean): Menu {
  const isMac = process.platform === 'darwin'

  const viewSubmenu: MenuItemConstructorOptions[] = [
    // Reload is dev-only: in a shipped build Ctrl+R would silently discard unsaved work.
    ...(isDev
      ? ([{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }] as MenuItemConstructorOptions[])
      : []),
    { role: 'toggleDevTools' },
    { type: 'separator' },
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' }
  ]

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('save-as') },
        { type: 'separator' },
        { label: 'Export for Game Engine…', accelerator: 'CmdOrCtrl+E', click: () => send('export') },
        { type: 'separator' },
        { label: 'Close Project', accelerator: 'CmdOrCtrl+Shift+W', click: () => send('close-project') },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      // Undo/Redo go to the renderer, which applies them to the focused text
      // field if there is one, and to the project history otherwise.
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
        { label: 'Redo', accelerator: isMac ? 'Shift+Cmd+Z' : 'Ctrl+Y', click: () => send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    { label: 'View', submenu: viewSubmenu },
    { role: 'windowMenu' }
  ]

  return Menu.buildFromTemplate(template)
}
