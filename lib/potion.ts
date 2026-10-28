export type Link = { id: string; url: string; label?: string }
export type Track = {
  id: string
  albumId: string
  title: string
  position: number
  completed: boolean
  notes: string
  links: Link[]
  createdAt: number
  updatedAt: number
}
export type Album = {
  id: string
  title: string
  status: 'upcoming' | 'in-progress' | 'completed' | 'archived'
  releaseDate?: string
  image?: string
  notes: string
  links: Link[]
  createdAt: number
  updatedAt: number
}

const KEY = 'potion:v1'
export type Store = { albums: Album[]; tracks: Track[] }

export function loadStore(): Store {
  if (typeof window === 'undefined') return { albums: [], tracks: [] }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { albums: [], tracks: [] }
    const parsed = JSON.parse(raw)
    return { albums: parsed.albums || [], tracks: parsed.tracks || [] }
  } catch {
    return { albums: [], tracks: [] }
  }
}

export function saveStore(store: Store) {
  if (typeof window === 'undefined') return
  localStorage.setItem(KEY, JSON.stringify(store))
}

export function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}
