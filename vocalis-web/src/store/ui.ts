import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UI {
  mode: 'test' | 'live'
  view: 'simple' | 'advanced'
  theme: 'light' | 'dark'
  collapsed: boolean
  platform: 'voice' | 'chat' | 'api'
  mobileNav: boolean
  palette: boolean
  playground: string | null // agent id when voice modal open
  workspace: number
  workspaceId: string | null
  dirty: boolean
  set: (p: Partial<UI>) => void
}
export const useUI = create<UI>()(
  persist(
    (set) => ({
      mode: 'live', view: 'simple', theme: 'light', collapsed: false, platform: 'voice', mobileNav: false,
      palette: false, playground: null, workspace: 0, workspaceId: null, dirty: false,
      set: (p) => set(p),
    }),
    { name: 'vocalis-ui', partialize: (s) => ({ mode: s.mode, view: s.view, theme: s.theme, collapsed: s.collapsed, platform: s.platform, workspace: s.workspace, workspaceId: s.workspaceId }) },
  ),
)
