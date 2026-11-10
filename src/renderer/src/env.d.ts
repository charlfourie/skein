/// <reference types="vite/client" />
import type { SkeinApi } from '@shared/ipc'

declare global {
  interface Window {
    api: SkeinApi
  }
}

export {}
