# Web build

Skein also runs as a static website (for example on Vercel). It is the same
editor as the desktop app. Only the bridge to the operating system differs:

- **Desktop** — `src/preload/index.ts` exposes `window.api` over Electron IPC.
- **Web** — `src/renderer/src/web/browserApi.ts` implements the same `SkeinApi`
  in the browser. `src/renderer/src/web/main.tsx` installs it, then loads the
  normal renderer entry.

Projects are still local files. Nothing is uploaded anywhere.

| | Chrome, Edge, Brave, Arc | Firefox, Safari |
|---|---|---|
| Open | Native file picker; reads the real file | File picker (upload into the tab) |
| Save | Writes the real file in place | Downloads the file |
| Recent projects | Remembered across visits | Not available |
| Changed-on-disk banner | Yes (checks every 2 s) | No |

Shortcuts: Ctrl/⌘ + S, Shift+S, O, E, Z, Y work as on desktop. Browsers
reserve Ctrl+N for a new window, so **Alt+N** creates a new project.
"Show in folder" does nothing in the browser.

## Commands

```bash
npx vite --config vite.web.config.ts          # dev server
npx vite build --config vite.web.config.ts    # static build → dist/
npx vite preview --config vite.web.config.ts  # serve the build locally
```

## Vercel

`vercel.json` holds the build settings (no framework preset, output `dist/`,
Electron's binary download skipped during install) and security headers.
Connect the GitHub repo in Vercel and every push to `main` redeploys.
