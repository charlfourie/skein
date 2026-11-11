/// <reference types="vite/client" />
import type { SkeinApi } from '@shared/bridge'

declare global {
  interface Window {
    api: SkeinApi
  }
}

export {}
