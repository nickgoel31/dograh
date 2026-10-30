import * as React from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { queryClient } from '@/lib/query'
import { USE_MOCKS } from '@/lib/api'
import { useMe } from '@/lib/useMe'
import { useUI } from '@/store/ui'
import AuthPage from '@/pages/Auth'
import Shell from '@/layout/Shell'
import Home from '@/pages/Home'
import Agents, { NewAgentPage, TemplatesPage } from '@/pages/Agents'
import AgentDetail from '@/pages/AgentDetail'
import Conversations, { CallDetail } from '@/pages/Conversations'
import Numbers from '@/pages/Numbers'
import Campaigns, { CampaignDetail, NewCampaign } from '@/pages/Campaigns'
import Knowledge from '@/pages/Knowledge'
import Tools from '@/pages/Tools'
import Voices from '@/pages/Voices'
import Testing from '@/pages/Testing'
import Analytics from '@/pages/Analytics'
import Developers from '@/pages/Developers'
import Billing from '@/pages/Billing'
import { HelpPage, SettingsPage } from '@/pages/SettingsHelp'

/** Real mode: show sign-in until a session exists; keep the active workspace valid. */
function Gate({ children }: { children: React.ReactNode }) {
  const { data, isPending, signedOut, error } = useMe()
  const workspaceId = useUI((s) => s.workspaceId)
  const set = useUI((s) => s.set)
  React.useEffect(() => {
    if (data && data.workspaces.every((w) => w.id !== workspaceId)) set({ workspaceId: data.current_workspace.id })
  }, [data, workspaceId, set])
  if (USE_MOCKS) return <>{children}</>
  if (isPending) return <div className="flex min-h-screen items-center justify-center text-sm text-soft">Loading…</div>
  if (signedOut) return <AuthPage />
  if (error) return <div className="flex min-h-screen items-center justify-center p-6 text-center text-sm">We can't reach the server right now. Please refresh in a moment.</div>
  return <>{children}</>
}

/** Switching workspace or Test/Live must never show the previous one's data. */
function CacheReset() {
  const qc = useQueryClient()
  const mode = useUI((s) => s.mode)
  const workspaceId = useUI((s) => s.workspaceId)
  const first = React.useRef(true)
  React.useEffect(() => {
    if (first.current) { first.current = false; return }
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
  }, [mode, workspaceId, qc])
  return null
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
    <CacheReset />
    <Gate>
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="agents" element={<Agents />} />
          <Route path="agents/new" element={<NewAgentPage />} />
          <Route path="agents/templates" element={<TemplatesPage />} />
          <Route path="agents/:id" element={<AgentDetail />} />
          <Route path="conversations" element={<Conversations />} />
          <Route path="conversations/:id" element={<CallDetail />} />
          <Route path="numbers" element={<Numbers />} />
          <Route path="campaigns" element={<Campaigns />} />
          <Route path="campaigns/new" element={<NewCampaign />} />
          <Route path="campaigns/:id" element={<CampaignDetail />} />
          <Route path="knowledge" element={<Knowledge />} />
          <Route path="tools" element={<Tools />} />
          <Route path="voices" element={<Voices />} />
          <Route path="testing" element={<Testing />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="developers" element={<Developers />} />
          <Route path="billing" element={<Billing />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="help" element={<HelpPage />} />
          <Route path="*" element={<Home />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </Gate>
    </QueryClientProvider>
  )
}
