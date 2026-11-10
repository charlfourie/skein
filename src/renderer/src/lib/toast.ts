import { create } from 'zustand'

export type ToastTone = 'success' | 'info' | 'warn' | 'error'

export interface Toast {
  id: number
  tone: ToastTone
  title: string
  detail?: string
  duration: number
}

interface ToastState {
  toasts: Toast[]
  push(tone: ToastTone, title: string, detail?: string, duration?: number): number
  dismiss(id: number): void
}

const DEFAULT_DURATION: Record<ToastTone, number> = {
  success: 2400,
  info: 3500,
  warn: 8000,
  error: 12000
}

let seq = 0

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (tone, title, detail, duration) => {
    const id = ++seq
    set((s) => ({
      toasts: [...s.toasts.slice(-4), { id, tone, title, detail, duration: duration ?? DEFAULT_DURATION[tone] }]
    }))
    return id
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

export const toast = {
  success: (title: string, detail?: string) => useToasts.getState().push('success', title, detail),
  info: (title: string, detail?: string) => useToasts.getState().push('info', title, detail),
  warn: (title: string, detail?: string) => useToasts.getState().push('warn', title, detail),
  error: (title: string, detail?: string) => useToasts.getState().push('error', title, detail)
}
