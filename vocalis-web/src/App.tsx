import * as React from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { queryClient } from '@/lib/query'
import { ApiError, USE_MOCKS, authApi } from '@/lib/api'
import { BASE } from '@/lib/api/env'
import { useMe } from '@/lib/useMe'
import { useUI } from '@/store/ui'
import AuthPage from '@/pages/Auth'
import SetupPage from '@/pages/Setup'
import { useData } from '@/store/data'
import { agentsApi, toAgent } from '@/lib/api/agents'
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
import { AcceptInvite, DevelopersReal, HelpReal, SettingsReal } from '@/pages/PlatformReal'
import WidgetPage from '@/pages/Widget'
import Onboarding from '@/pages/Onboarding'
import Contacts from '@/pages/Contacts'
import { ResetPage, VerifyPage } from '@/pages/AccountPages'

/** Real mode: show sign-in until a session exists; keep the active workspace valid. */
function Gate({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient()
  // Arriving from the classic UI: swap the one-time code in the address for a session, then carry on.
  const [switching, setSwitching] = React.useState(() => !USE_MOCKS && new URLSearchParams(window.location.search).has('handoff'))
  React.useEffect(() => {
    if (!switching) return
    const code = new URLSearchParams(window.location.search).get('handoff') ?? ''
    window.history.replaceState({}, '', window.location.pathname)
    authApi.handoffRedeem(code).catch(() => {}).finally(() => { qc.invalidateQueries({ queryKey: ['me'] }); setSwitching(false) })
  }, [switching, qc])
  const { data, isPending, signedOut, error } = useMe()
  const workspaceId = useUI((s) => s.workspaceId)
  const set = useUI((s) => s.set)
  React.useEffect(() => {
    if (data && data.workspaces.every((w) => w.id !== workspaceId)) set({ workspaceId: data.current_workspace.id })
  }, [data, workspaceId, set])
  // A saved workspace that no longer belongs to this account must not brick the app.
  React.useEffect(() => {
    if (error instanceof ApiError && error.code === 'workspace_not_found') set({ workspaceId: null })
  }, [error, set])
  const setAgents = useData((s) => s.setAgents)
  const signedIn = !!data
  const mode = useUI((s) => s.mode)
  // Load this workspace's agents whenever the user, workspace or mode changes.
  React.useEffect(() => {
    if (USE_MOCKS || !signedIn) return
    let live = true
    agentsApi.list().then((rows) => { if (live) setAgents(rows.map((a) => toAgent(a))) }).catch(() => { if (live) setAgents([]) })
    return () => { live = false }
  }, [signedIn, workspaceId, mode, setAgents])
  if (USE_MOCKS) return <>{children}</>
  if (switching || isPending) return <div className="flex min-h-screen items-center justify-center text-sm text-soft">Loading…</div>
  if (signedOut) return <AuthPage />
  if (error instanceof ApiError && error.code === 'no_workspace') return <SetupPage />
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
  // The call button inside other people's websites: public, no sign-in.
  if (window.location.pathname.startsWith(`${BASE}/widget/`)) {
    return <BrowserRouter basename={BASE}><Routes><Route path="widget/:agentId" element={<WidgetPage />} /></Routes></BrowserRouter>
  }
  const p = window.location.pathname
  if (p === `${BASE}/reset` || p === `${BASE}/verify`) {
    return <QueryClientProvider client={queryClient}>{p.endsWith('/reset') ? <ResetPage /> : <VerifyPage />}</QueryClientProvider>
  }
  return (
    <QueryClientProvider client={queryClient}>
    <CacheReset />
    <Gate>
    <BrowserRouter basename={BASE}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="welcome" element={USE_MOCKS ? <Onboarding /> : <Navigate to="/" replace />} />
          <Route path="contacts" element={USE_MOCKS ? <Home /> : <Contacts />} />
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
          <Route path="developers" element={USE_MOCKS ? <Developers /> : <DevelopersReal />} />
          <Route path="billing" element={<Billing />} />
          <Route path="settings" element={USE_MOCKS ? <SettingsPage /> : <SettingsReal />} />
          <Route path="invite/:token" element={<AcceptInvite />} />
          <Route path="help" element={USE_MOCKS ? <HelpPage /> : <HelpReal />} />
          <Route path="*" element={<Home />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </Gate>
    </QueryClientProvider>
  )
}
