import { create } from 'zustand'
import { toast } from 'sonner'
import type { Agent } from '@/mock/types'
import { agents as seed } from '@/mock/agents'
import { USE_MOCKS } from '@/lib/api/env'
import { agentsApi, toAgent } from '@/lib/api/agents'
import { voicesApi } from '@/lib/api/voices'

interface Data {
  agents: Agent[]
  agentsLoaded: boolean
  favorites: string[]
  setAgents: (a: Agent[]) => void
  upsertAgent: (a: Agent) => void
  addAgent: (a: Agent) => void
  updateAgent: (id: string, p: Partial<Agent>) => void
  duplicate: (id: string) => void
  toggleFav: (id: string) => void
  setFavorites: (ids: string[]) => void
}

const oops = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.')

export const useData = create<Data>((set, get) => {
  const reload = async () => {
    try { get().setAgents((await agentsApi.list()).map((a) => toAgent(a))) } catch { /* the page keeps what it has */ }
  }
  return {
    // Real mode starts empty; sample agents are for demo mode only.
    agents: USE_MOCKS ? seed : [],
    agentsLoaded: USE_MOCKS,
    favorites: USE_MOCKS ? ['v3', 'v8'] : [],
    setAgents: (agents) => set({ agents, agentsLoaded: true }),
    upsertAgent: (a) => set((s) => ({ agents: s.agents.some((x) => x.id === a.id) ? s.agents.map((x) => (x.id === a.id ? a : x)) : [a, ...s.agents] })),
    addAgent: (a) => set((s) => ({ agents: [a, ...s.agents] })),
    updateAgent: (id, p) => {
      const prev = get().agents.find((a) => a.id === id)
      set((s) => ({ agents: s.agents.map((a) => (a.id === id ? { ...a, ...p } : a)) })) // optimistic
      if (USE_MOCKS || !prev) return
      // Status changes are actions on the server, not field edits.
      const call = p.status === 'paused' ? agentsApi.pause(id)
        : p.status === 'live' ? (prev.status === 'paused' ? agentsApi.resume(id) : agentsApi.publish(id))
        : agentsApi.patch(id, p, prev.version)
      call.then((a) => get().upsertAgent(toAgent(a, prev))).catch((e) => { oops(e); void reload() })
    },
    duplicate: (id) => {
      if (USE_MOCKS) {
        const a = get().agents.find((x) => x.id === id)
        if (a) set((s) => ({ agents: [{ ...a, id: 'a' + Date.now(), name: a.name + ' (copy)', status: 'draft', callsToday: 0 }, ...s.agents] }))
        return
      }
      agentsApi.duplicate(id).then((a) => get().upsertAgent(toAgent(a))).catch(oops)
    },
    setFavorites: (favorites) => set({ favorites }),
    toggleFav: (id) => {
      const on = get().favorites.includes(id)
      set((s) => ({ favorites: on ? s.favorites.filter((x) => x !== id) : [...s.favorites, id] }))
      if (!USE_MOCKS) (on ? voicesApi.unfavorite(id) : voicesApi.favorite(id)).catch((e) => { oops(e); set((s) => ({ favorites: on ? [...s.favorites, id] : s.favorites.filter((x) => x !== id) })) })
    },
  }
})
