import { create } from 'zustand'
import type { Agent } from '@/mock/types'
import { agents as seed } from '@/mock/agents'

interface Data {
  agents: Agent[]
  favorites: string[]
  addAgent: (a: Agent) => void
  updateAgent: (id: string, p: Partial<Agent>) => void
  duplicate: (id: string) => void
  toggleFav: (id: string) => void
}
export const useData = create<Data>((set) => ({
  agents: seed,
  favorites: ['v3', 'v8'],
  addAgent: (a) => set((s) => ({ agents: [a, ...s.agents] })),
  updateAgent: (id, p) => set((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, ...p } : a)) })),
  duplicate: (id) => set((s) => {
    const a = s.agents.find((x) => x.id === id)
    if (!a) return s
    return { agents: [{ ...a, id: 'a' + Date.now(), name: a.name + ' (copy)', status: 'draft', callsToday: 0 }, ...s.agents] }
  }),
  toggleFav: (id) => set((s) => ({ favorites: s.favorites.includes(id) ? s.favorites.filter((x) => x !== id) : [...s.favorites, id] })),
}))
