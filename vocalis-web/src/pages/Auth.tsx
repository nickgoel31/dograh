import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import { ArrowRight, BarChart3, Lock, Mail, Mic2, PhoneCall, ShieldCheck, User } from 'lucide-react'
import { ApiError, authApi } from '@/lib/api'
import { BRAND } from '@/config/brand'
import { Button } from '@/components/ui'

declare global { interface Window { google?: { accounts: { id: { initialize: (o: Record<string, unknown>) => void; renderButton: (el: HTMLElement, o: Record<string, unknown>) => void } } } } }

const FEATURES = [
  [PhoneCall, 'Answer every call', 'Voice agents that pick up on the first ring, day and night.'],
  [BarChart3, 'See what works', 'Every call transcribed, scored and summed up in plain words.'],
  [ShieldCheck, 'Safe to start', 'Practice for free on a private copy before anyone real calls.'],
] as const

function Field({ icon: Icon, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { icon: LucideIcon }) {
  return (
    <label className="relative block">
      <Icon size={16} className="absolute left-3.5 top-3.5 text-soft" />
      <input {...p} className="h-11 w-full rounded-xl border bg-surface pl-10 pr-3 text-sm outline-none transition placeholder:text-soft/70 focus:border-accent focus:ring-2 focus:ring-accent/15" />
    </label>
  )
}

function GoogleButton({ clientId, onToken }: { clientId: string; onToken: (credential: string) => void }) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const init = () => {
      if (!window.google || !ref.current) return
      window.google.accounts.id.initialize({ client_id: clientId, callback: (r: { credential: string }) => onToken(r.credential) })
      window.google.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', width: ref.current.offsetWidth || 340, text: 'continue_with', shape: 'pill' })
    }
    if (window.google) return init()
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = init
    document.head.appendChild(s)
  }, [clientId]) // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={ref} className="flex min-h-[44px] w-full justify-center" />
}

export default function AuthPage() {
  const qc = useQueryClient()
  const [signup, setSignup] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [f, setF] = React.useState({ name: '', email: '', password: '' })
  const [needCode, setNeedCode] = React.useState(false)
  const [code, setCode] = React.useState('')
  const cfg = useQuery({ queryKey: ['auth-config'], queryFn: authApi.config, retry: false })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })

  async function done() { await qc.invalidateQueries({ queryKey: ['me'] }) }
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      if (signup) await authApi.signup(f)
      else await authApi.login({ email: f.email, password: f.password, code: needCode ? code : undefined })
      await done()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'two_factor_required') { setNeedCode(true); setError(null); return }
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally { setBusy(false) }
  }
  async function google(credential: string) {
    setBusy(true); setError(null)
    try { await authApi.google(credential); await done() } catch (err) { setError(err instanceof ApiError ? err.message : 'We could not sign you in with Google.') } finally { setBusy(false) }
  }
  const hasGoogle = !!cfg.data?.google_client_id

  return (
    <div className="grid min-h-screen bg-bg p-3 lg:grid-cols-[minmax(420px,1fr)_1.1fr] lg:p-4">
      <div className="flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-[380px]">
          <div className="flex items-center gap-2.5 text-lg font-semibold tracking-tight"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-accent-fg"><Mic2 size={18} /></span>{BRAND}</div>
          <h1 className="mt-10 text-3xl font-semibold tracking-tight">{signup ? 'Create your account' : 'Welcome back'}</h1>
          <p className="mt-2 text-soft">{signup ? 'Start free. Your first agent takes a few minutes.' : 'Sign in to manage your voice agents.'}</p>

          {hasGoogle && (<>
            <div className="mt-8"><GoogleButton clientId={cfg.data!.google_client_id!} onToken={google} /></div>
            <div className="my-6 flex items-center gap-3 text-xs text-soft"><span className="h-px flex-1 bg-line" />or with email<span className="h-px flex-1 bg-line" /></div>
          </>)}

          <form onSubmit={submit} className={hasGoogle ? 'space-y-3' : 'mt-8 space-y-3'}>
            {signup && <Field icon={User} placeholder="Your name" value={f.name} onChange={set('name')} required autoComplete="name" />}
            <Field icon={Mail} type="email" placeholder="Email address" value={f.email} onChange={set('email')} required autoComplete="email" />
            <Field icon={Lock} type="password" placeholder={signup ? 'Password (8+ characters)' : 'Password'} value={f.password} onChange={set('password')} required minLength={signup ? 8 : 1} autoComplete={signup ? 'new-password' : 'current-password'} />
            {needCode && !signup && <Field icon={ShieldCheck} inputMode="numeric" placeholder="6-digit code from your authenticator app" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={8} autoComplete="one-time-code" autoFocus />}
            {error && <p role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
            <Button variant="primary" size="lg" className="h-11 w-full rounded-xl" disabled={busy}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}{!busy && <ArrowRight size={16} />}</Button>
          </form>
          <p className="mt-6 text-sm text-soft">{signup ? 'Already have an account?' : 'New here?'}{' '}
            <button type="button" onClick={() => { setSignup(!signup); setError(null) }} className="font-semibold text-accent hover:underline">{signup ? 'Sign in' : 'Create an account'}</button></p>
        </div>
      </div>

      <div className="relative hidden overflow-hidden rounded-[28px] bg-gradient-to-br from-[#0b2f2a] via-[#0b5c4c] to-[#1b7f68] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/5" /><div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-black/10" />
        <div className="relative flex items-end gap-1.5 opacity-70">{Array.from({ length: 28 }).map((_, i) => <span key={i} className="w-1.5 rounded-full bg-white/70" style={{ height: 12 + Math.abs(Math.sin(i * 0.7)) * 56 }} />)}</div>
        <div className="relative max-w-md">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">Your business, answered. Every call.</h2>
          <p className="mt-4 text-white/75">Build a voice agent in minutes, give it a phone number, and let it book, answer and follow up while you work.</p>
          <ul className="mt-10 space-y-5">{FEATURES.map(([Icon, t, d]) => (
            <li key={t} className="flex gap-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10"><Icon size={18} /></span><span><span className="block font-medium">{t}</span><span className="text-sm text-white/65">{d}</span></span></li>))}</ul>
        </div>
        <div className="relative max-w-sm self-end rounded-2xl bg-white/10 p-5 backdrop-blur">
          <div className="text-sm text-white/70">Today</div>
          <div className="mt-1 flex items-baseline gap-2"><span className="text-3xl font-semibold">128</span><span className="text-sm text-white/70">calls answered</span></div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/15"><div className="h-full w-4/5 rounded-full bg-white" /></div>
          <div className="mt-2 text-xs text-white/60">82% ended with a booking or a solved question</div>
        </div>
      </div>
    </div>
  )
}
