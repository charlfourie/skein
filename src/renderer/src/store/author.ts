import { create } from 'zustand'

/**
 * The name comments are signed with. Kept on this machine only (there are no
 * accounts): each person sets it once in their own copy of Skein.
 */
interface AuthorState {
  name: string
  setName(name: string): void
}

const KEY = 'skein.author.v1'

function load(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export const useAuthor = create<AuthorState>((set) => ({
  name: typeof localStorage !== 'undefined' ? load() : '',
  setName: (raw) => {
    const name = raw.trim().slice(0, 60)
    set({ name })
    try {
      localStorage.setItem(KEY, name)
    } catch {
      // Storage unavailable: the name lasts for this session.
    }
  }
}))
