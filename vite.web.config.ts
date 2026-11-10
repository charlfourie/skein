import { resolve } from 'path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Browser build of the editor (for Vercel or any static host).
 *
 * Same renderer code as the desktop app; only the entry point differs: it
 * installs a browser implementation of `window.api` (src/renderer/src/web)
 * in place of the Electron preload. Output is a static site in dist/.
 */

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

/**
 * The page lives in web/ but the entry is in src/. A virtual id lets the same
 * <script> tag work in the dev server (which can't serve files above its root
 * by relative URL) and in the build.
 */
const ENTRY_ID = '/@skein/web-entry'
function webEntry(): Plugin {
  const entry = resolve(__dirname, 'src/renderer/src/web/main.tsx')
  return {
    name: 'skein:web-entry',
    resolveId(id) {
      return id === ENTRY_ID ? entry : undefined
    }
  }
}

function productionCsp(): Plugin {
  return {
    name: 'skein:production-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
    }
  }
}

export default defineConfig({
  root: resolve(__dirname, 'web'),
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  plugins: [webEntry(), react(), productionCsp()],
  server: { fs: { allow: [__dirname] } },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true
  }
})
