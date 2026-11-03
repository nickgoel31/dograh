import * as React from 'react'
import { CheckCircle2, Lock } from '@/components/icons'
import { Button, Card, Input } from '@/components/ui'
import { authApi } from '@/lib/api'
import { BASE } from '@/lib/api/env'
import { BRAND } from '@/config/brand'

const token = () => new URLSearchParams(window.location.search).get('token') ?? ''
const Shell = ({ children }: { children: React.ReactNode }) => (
  <div className="flex min-h-screen items-center justify-center bg-bg p-4"><Card className="w-full max-w-sm p-8"><div className="mb-6 text-lg font-semibold">{BRAND}</div>{children}</Card></div>
)

export function ResetPage() {
  const [pw, setPw] = React.useState('')
  const [state, setState] = React.useState<'form' | 'busy' | 'done' | string>('form')
  const go = async (e: React.FormEvent) => {
    e.preventDefault(); setState('busy')
    try { await authApi.reset(token(), pw); setState('done') } catch (err) { setState(err instanceof Error ? err.message : 'Something went wrong.') }
  }
  if (state === 'done') return <Shell><CheckCircle2 className="text-ok" /><h1 className="mt-3 text-xl font-semibold">Password changed</h1><p className="mt-1 text-soft">You can sign in with your new password.</p><Button variant="primary" className="mt-5 w-full" onClick={() => window.location.assign(`${BASE}/`)}>Go to sign in</Button></Shell>
  return (
    <Shell><h1 className="text-xl font-semibold">Choose a new password</h1>
      <form onSubmit={go} className="mt-4 space-y-3"><div className="relative"><Lock size={16} className="absolute left-3.5 top-3.5 text-soft" /><Input className="h-11 pl-10" type="password" minLength={8} required placeholder="New password (8+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></div>
        {state !== 'form' && state !== 'busy' && <p role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{state}</p>}
        <Button variant="primary" className="h-11 w-full" disabled={state === 'busy'}>Change password</Button></form></Shell>
  )
}

export function VerifyPage() {
  const [state, setState] = React.useState<'busy' | 'ok' | string>('busy')
  React.useEffect(() => { authApi.verify(token()).then(() => setState('ok')).catch((e) => setState(e instanceof Error ? e.message : 'Something went wrong.')) }, [])
  return (
    <Shell>{state === 'busy' ? <p className="text-soft">Confirming your email…</p> : state === 'ok'
      ? <><CheckCircle2 className="text-ok" /><h1 className="mt-3 text-xl font-semibold">Email confirmed</h1><Button variant="primary" className="mt-5 w-full" onClick={() => window.location.assign(`${BASE}/`)}>Continue</Button></>
      : <p role="alert" className="text-bad">{state}</p>}</Shell>
  )
}
