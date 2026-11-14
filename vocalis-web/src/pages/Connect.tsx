import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plug, ShieldCheck } from '@/components/icons'
import { Button, Chip } from '@/components/ui'
import { http } from '@/lib/api/http'
import { useMe } from '@/lib/useMe'
import { BRAND } from '@/config/brand'

type Info = { name: string; host: string }
const asks = ['code_challenge', 'state'] as const

/** The page an AI assistant sends people to when they press Connect: who is asking, which workspace, what it can do, then Allow or Don't allow. */
export default function ConnectPage() {
  const q = React.useMemo(() => new URLSearchParams(window.location.search), [])
  const clientId = q.get('client_id') ?? ''
  const redirect = q.get('redirect_uri') ?? ''
  const { data: me } = useMe()
  const [access, setAccess] = React.useState<'full' | 'read'>(q.get('scope')?.split(/[ ,]/).includes('read') && !q.get('scope')?.includes('full') ? 'read' : 'full')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const info = useQuery({ queryKey: ['oauth-client', clientId, redirect], retry: false, enabled: !!clientId && !!redirect,
    queryFn: () => http<Info>(`/oauth/client?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirect)}`) })
  const finish = async (approve: boolean) => {
    setBusy(true); setError('')
    try {
      const body: Record<string, unknown> = { client_id: clientId, redirect_uri: redirect, access, approve, code_challenge_method: q.get('code_challenge_method') ?? 'S256' }
      for (const k of asks) { const v = q.get(k); if (v) body[k] = v }
      const r = await http<{ redirect_url: string }>('/oauth/approve', { method: 'POST', json: body })
      window.location.href = r.redirect_url
    } catch (e) {
      setBusy(false); setError(e instanceof Error ? e.message : 'Something went wrong. Go back to the app and try again.')
    }
  }
  const app = info.data?.name ?? 'An AI assistant'
  const bad = !clientId || !redirect || info.isError
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-7 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}swarvo-logo.webp`} alt="" className="h-9 w-9 rounded-xl object-contain dark:invert" />
          <span className="text-lg font-semibold">{BRAND}</span>
        </div>
        {bad ? (
          <div>
            <h1 className="text-xl font-semibold">We can't connect this app</h1>
            <p className="mt-2 text-sm text-soft">{info.error instanceof Error ? info.error.message : 'The link is incomplete. Go back to the app and press Connect again.'}</p>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><Plug size={19} /></span>
              <div>
                <h1 className="text-xl font-semibold leading-tight">{app} wants to connect to your {BRAND} account</h1>
                <p className="mt-1 text-[13px] text-soft">Signed in as <b>{me?.user.email ?? '…'}</b>{me ? <> · workspace <b>{me.current_workspace.name}</b></> : null}</p>
              </div>
            </div>
            <div className="mt-5">
              <div className="mb-2 text-[13px] font-medium">What can it do?</div>
              <div className="flex flex-wrap gap-2"><Chip active={access === 'full'} onClick={() => setAccess('full')}>Full access</Chip><Chip active={access === 'read'} onClick={() => setAccess('read')}>Read-only</Chip></div>
              <p className="mt-2 text-[13px] text-soft">{access === 'full'
                ? 'It can build and publish agents, change voices, read conversations, manage numbers, knowledge, campaigns and API keys, with your role and limits. It can spend your balance if you ask it to.'
                : 'It can look at your agents, calls, numbers and settings, but change nothing.'}</p>
            </div>
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-xs text-soft"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-accent" />You will be sent back to {info.data?.host ?? 'the app'}. You can end this any time under Developers, Connected apps.</div>
            {error && <p className="mt-3 text-sm text-bad">{error}</p>}
            <div className="mt-5 flex gap-3">
              <Button className="flex-1" disabled={busy} onClick={() => finish(false)}>Don't allow</Button>
              <Button className="flex-1" variant="primary" disabled={busy || info.isPending} onClick={() => finish(true)}>{busy ? 'Connecting…' : 'Allow'}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
