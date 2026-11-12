# Skein in the browser

Skein is a web app. The hosted copy is at [skein.charl.space](https://skein.charl.space),
and you can run your own (below). Either way, your projects are files on your own
computer: Skein reads and writes them through the browser, and nothing you write is
uploaded anywhere.

## What each browser can do

| | Chrome, Edge, Brave, Arc | Firefox, Safari |
|---|---|---|
| Projects | Folders (one file per flow), or single `.skein.json` files | Single `.skein.json` files |
| Open | The browser's folder or file picker; reads the real files | File picker (uploads a copy into the tab) |
| Save | Writes the real files in place (the browser asks once per visit) | Downloads the file |
| Recent projects | Remembered across visits | Not available |
| Changed on disk (a `git pull`) | Noticed within a couple of seconds | No |

Chromium browsers use the [File System Access API](https://developer.mozilla.org/docs/Web/API/File_System_API).
Firefox and Safari don't offer it, so Skein falls back to uploads and downloads there.

## Shortcuts

| Keys | Does |
| --- | --- |
| Ctrl/⌘ + O | Open a project (a folder where the browser supports it) |
| Ctrl/⌘ + Shift + O | Open a single `.skein.json` file |
| Ctrl/⌘ + S, Ctrl/⌘ + Shift + S | Save, Save As |
| Ctrl/⌘ + E | Export for a game engine |
| Ctrl/⌘ + Z, Ctrl + Y (⌘ + Shift + Z) | Undo, redo |
| Alt + N | New project (browsers keep Ctrl+N for a new window) |
| Ctrl/⌘ + Shift + W | Close the project |

The page warns before the tab closes while there are unsaved changes.

## Run your own copy

Skein is a static site. Run it locally, on a laptop with no internet once installed, or
on any web server:

```bash
npm install
npm run dev        # http://localhost:5173, with hot reload
npm run build      # the static site, in dist/
npm run preview    # serve the build locally
```

`src/renderer/src/web/browserApi.ts` is the bridge between the editor and the browser
(files, Recent, shortcuts); `src/renderer/src/web/main.tsx` installs it and starts the editor.

## Vercel

`vercel.json` holds the build settings (no framework preset, output `dist/`) and
security headers. Pushes to `main` deploy to production; pushes to `next` deploy a
preview (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

## Analytics

The hosted copy uses [Vercel Web Analytics](https://vercel.com/docs/analytics) to count
visits. It sets no cookies and collects no personal data, and it never sees your
projects. A copy you run yourself sends nothing (on Vercel, only once you enable Web
Analytics for your own project). Remove the `inject()` call in `web/main.tsx` to drop it.
