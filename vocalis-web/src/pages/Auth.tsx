import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import { AlertCircle, ArrowLeft, ArrowRight, BarChart3, CalendarCheck, Check, Eye, EyeOff, Lock, Mail, Mic2, PhoneCall, ShieldCheck, User } from 'lucide-react'
import { ApiError, authApi } from '@/lib/api'
import { BRAND } from '@/config/brand'
import { Button } from '@/components/ui'
import { cn } from '@/lib/utils'

declare global { interface Window { google?: { accounts: { id: { initialize: (o: Record<string, unknown>) => void; renderButton: (el: HTMLElement, o: Record<string, unknown>) => void } } } } }

const FEATURES = [
  [PhoneCall, 'Answer every call', 'Pick up on the first ring, day and night, in the caller\'s language.'],
  [CalendarCheck, 'Book and follow up', 'Appointments land in your calendar, details reach your CRM and WhatsApp.'],
  [BarChart3, 'See what works', 'Every call transcribed, scored and summed up in plain words.'],
  [ShieldCheck, 'Safe to start', 'Practice free on a private copy before anyone real calls.'],
] as const

function Field({ icon: Icon, right, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { icon: LucideIcon; right?: React.ReactNode }) {
  return (
    <label className="group relative block">
      <Icon size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-soft transition group-focus-within:text-accent" />
      <input {...p} className={cn('h-12 w-full rounded-xl border border-line bg-surface pl-10 text-sm shadow-field outline-none transition duration-150 placeholder:text-soft/60 hover:border-soft/40 focus:border-accent focus:ring-4 focus:ring-accent/15', right ? 'pr-11' : 'pr-3')} />
      {right && <span className="absolute right-2 top-1/2 -translate-y-1/2">{right}</span>}
    </label>
  )
}

function GoogleButton({ clientId, onToken }: { clientId: string; onToken: (credential: string) => void }) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const init = () => {
      if (!window.google || !ref.current) return
      window.google.accounts.id.initialize({ client_id: clientId, callback: (r: { credential: string }) => onToken(r.credential) })
      window.google.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', width: ref.current.offsetWidth || 360, text: 'continue_with', shape: 'pill' })
    }
    if (window.google) return init()
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = init
    document.head.appendChild(s)
  }, [clientId]) // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={ref} className="flex min-h-[44px] w-full justify-center" />
}

/** A call in progress, to show what the product does. Purely decorative. */
function LiveCall() {
  const bars = Array.from({ length: 34 })
  return (
    <div className="relative w-full max-w-[420px] rounded-3xl border border-white/15 bg-white/[.07] p-5 shadow-[0_30px_80px_-30px_rgba(0,0,0,.6)] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5"><span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-300" /></span><span className="text-[13px] font-medium text-white/90">Live call · Dental clinic</span></div>
        <span className="num text-xs text-white/60">00:42</span>
      </div>
      <div className="mt-4 flex h-12 items-center gap-[3px]">{bars.map((_, i) => <span key={i} className="w-[3px] origin-center animate-wave rounded-full bg-gradient-to-t from-emerald-200/40 to-white/90" style={{ height: 14 + Math.abs(Math.sin(i * 0.65)) * 30, animationDelay: `${(i % 9) * 0.11}s` }} />)}</div>
      <div className="mt-4 space-y-2.5 text-[13px] leading-snug">
        <div className="max-w-[88%] rounded-2xl rounded-bl-md bg-white/10 px-3.5 py-2 text-white/90"><span className="mb-0.5 block text-[10.5px] font-semibold uppercase tracking-wider text-white/50">Caller</span>Hi, can I book a cleaning for Saturday morning?</div>
        <div className="ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-white px-3.5 py-2 text-emerald-950"><span className="mb-0.5 block text-[10.5px] font-semibold uppercase tracking-wider text-emerald-700/70">{BRAND}</span>Of course. I have 10:30 or 11:15 free. Which works for you?</div>
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-300/15 px-3 py-2 text-xs text-emerald-100"><Check size={14} />Booked for Saturday 10:30 · confirmation sent on WhatsApp</div>
    </div>
  )
}

export default function AuthPage() {
  const qc = useQueryClient()
  const [signup, setSignup] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [f, setF] = React.useState({ name: '', email: '', password: '' })
  const [forgot, setForgot] = React.useState(false)
  const [sent, setSent] = React.useState<string | null>(null)
  const [needCode, setNeedCode] = React.useState(false)
  const [code, setCode] = React.useState('')
  const [show, setShow] = React.useState(false)
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
  async function sendReset(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null)
    try { setSent((await authApi.forgot(f.email)).message) } catch (err) { setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.') } finally { setBusy(false) }
  }
  async function google(credential: string) {
    setBusy(true); setError(null)
    try { await authApi.google(credential); await done() } catch (err) { setError(err instanceof ApiError ? err.message : 'We could not sign you in with Google.') } finally { setBusy(false) }
  }
  const hasGoogle = !!cfg.data?.google_client_id
  const strength = Math.min(4, (f.password.length >= 8 ? 1 : 0) + (/[A-Z]/.test(f.password) ? 1 : 0) + (/\d/.test(f.password) ? 1 : 0) + (/[^A-Za-z0-9]/.test(f.password) ? 1 : 0))
  const err = error && (
    <p role="alert" className="flex items-start gap-2 rounded-xl border border-bad/25 bg-bad/10 px-3.5 py-2.5 text-sm text-bad"><AlertCircle size={16} className="mt-0.5 shrink-0" />{error}</p>
  )
  const eye = (
    <button type="button" onClick={() => setShow(!show)} className="rounded-lg p-2 text-soft transition hover:bg-muted hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
  )

  return (
    <div className="grid min-h-screen bg-bg p-0 lg:grid-cols-[minmax(460px,1fr)_1.12fr] lg:gap-3 lg:p-3">
      <div className="relative flex items-center justify-center overflow-hidden bg-surface px-6 py-12 lg:rounded-3xl lg:border lg:border-line/70 lg:shadow-raised">
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-accent/[.07] blur-3xl" aria-hidden />
        <div className="relative w-full max-w-[400px]">
          <div className="flex items-center gap-3 text-[19px] font-extrabold tracking-tight">
            <span className="brand-gradient flex h-10 w-10 items-center justify-center rounded-xl text-accent-fg shadow-glow"><Mic2 size={19} /></span>{BRAND}
          </div>

          {forgot ? (<>
            <h1 className="mt-12 text-[32px] font-extrabold leading-tight tracking-[-0.03em]">Forgot your password?</h1>
            <p className="mt-2 text-[15px] text-soft">Enter your email and we'll send you a link to choose a new one.</p>
            {sent ? <p className="mt-8 flex items-start gap-2 rounded-xl border border-accent/20 bg-accent-soft px-4 py-3 text-sm"><Check size={16} className="mt-0.5 shrink-0 text-accent" />{sent}</p> : (
              <form onSubmit={sendReset} className="mt-8 space-y-3.5">
                <Field icon={Mail} type="email" placeholder="Email address" value={f.email} onChange={set('email')} required autoComplete="email" />
                {err}
                <Button variant="primary" size="lg" className="h-12 w-full rounded-xl" disabled={busy}>{busy ? 'Please wait…' : 'Send reset link'}</Button>
              </form>)}
            <button type="button" onClick={() => { setForgot(false); setSent(null); setError(null) }} className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline"><ArrowLeft size={14} />Back to sign in</button>
          </>) : (<>
            <div className="mt-12 inline-flex rounded-xl border border-line/80 bg-muted/70 p-1 shadow-field" role="tablist" aria-label="Sign in or create an account">
              {([['Sign in', false], ['Create account', true]] as const).map(([label, isSignup]) => (
                <button key={label} role="tab" aria-selected={signup === isSignup} type="button" onClick={() => { setSignup(isSignup); setError(null) }}
                  className={cn('rounded-lg px-4 py-1.5 text-[13px] font-semibold transition', signup === isSignup ? 'bg-surface text-ink shadow-card ring-1 ring-line' : 'text-soft hover:text-ink')}>{label}</button>
              ))}
            </div>
            <h1 className="mt-6 text-[32px] font-extrabold leading-tight tracking-[-0.03em]">{signup ? 'Create your account' : 'Welcome back'}</h1>
            <p className="mt-2 text-[15px] text-soft">{signup ? 'Start free. Your first agent takes a few minutes.' : 'Sign in to manage your voice agents.'}</p>

            {hasGoogle && (<>
              <div className="mt-8"><GoogleButton clientId={cfg.data!.google_client_id!} onToken={google} /></div>
              <div className="my-6 flex items-center gap-3 text-xs font-medium uppercase tracking-wider text-soft"><span className="h-px flex-1 bg-line" />or with email<span className="h-px flex-1 bg-line" /></div>
            </>)}

            <form onSubmit={submit} className={cn('space-y-3.5', !hasGoogle && 'mt-8')}>
              {signup && <Field icon={User} placeholder="Your name" value={f.name} onChange={set('name')} required autoComplete="name" />}
              <Field icon={Mail} type="email" placeholder="Email address" value={f.email} onChange={set('email')} required autoComplete="email" />
              <Field icon={Lock} type={show ? 'text' : 'password'} placeholder={signup ? 'Password (8+ characters)' : 'Password'} value={f.password} onChange={set('password')} required minLength={signup ? 8 : 1} autoComplete={signup ? 'new-password' : 'current-password'} right={eye} />
              {signup && f.password && (
                <div className="flex items-center gap-2" aria-label="Password strength">
                  <div className="flex flex-1 gap-1">{[0, 1, 2, 3].map((i) => <span key={i} className={cn('h-1 flex-1 rounded-full transition-colors', i < strength ? (strength < 2 ? 'bg-bad' : strength < 3 ? 'bg-warn' : 'bg-ok') : 'bg-line')} />)}</div>
                  <span className="text-xs text-soft">{strength < 2 ? 'Weak' : strength < 3 ? 'Okay' : strength < 4 ? 'Good' : 'Strong'}</span>
                </div>
              )}
              {needCode && !signup && <Field icon={ShieldCheck} inputMode="numeric" placeholder="6-digit code from your authenticator app" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={8} autoComplete="one-time-code" />}
              {!signup && <div className="text-right"><button type="button" onClick={() => { setForgot(true); setError(null) }} className="text-sm font-medium text-accent hover:underline">Forgot password?</button></div>}
              {err}
              <Button variant="primary" size="lg" className="h-12 w-full rounded-xl text-[15px]" disabled={busy}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}{!busy && <ArrowRight size={16} />}</Button>
            </form>
            {signup && <p className="mt-4 text-center text-xs text-soft">By creating an account you agree to our terms and privacy policy.</p>}
            <div className="mt-8 flex items-center justify-center gap-5 text-xs text-soft"><span className="inline-flex items-center gap-1.5"><Lock size={12} />Encrypted</span><span className="inline-flex items-center gap-1.5"><ShieldCheck size={12} />Your data stays yours</span></div>
          </>)}
        </div>
      </div>

      <div className="relative hidden overflow-hidden rounded-3xl bg-[linear-gradient(145deg,#04201c_0%,#08433a_42%,#0f6b58_100%)] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -right-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-emerald-300/20 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-40 -left-24 h-[26rem] w-[26rem] rounded-full bg-teal-400/15 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute inset-0 opacity-[.07]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)', backgroundSize: '26px 26px' }} aria-hidden />
        <div className="relative max-w-lg">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-white/85"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />Voice agents for businesses that can't miss a call</span>
          <h2 className="mt-6 text-[44px] font-extrabold leading-[1.05] tracking-[-0.035em]">Your business, answered. <span className="text-emerald-200">Every call.</span></h2>
          <p className="mt-5 max-w-md text-[16px] leading-relaxed text-white/70">Build a voice agent in minutes, give it a phone number, and let it book, answer and follow up while you work.</p>
        </div>
        <div className="relative my-10 flex justify-center"><LiveCall /></div>
        <ul className="relative grid max-w-xl gap-x-8 gap-y-5 sm:grid-cols-2">{FEATURES.map(([Icon, t, d]) => (
          <li key={t} className="flex gap-3.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10"><Icon size={16} /></span><span><span className="block text-sm font-semibold">{t}</span><span className="mt-0.5 block text-[13px] leading-snug text-white/60">{d}</span></span></li>
        ))}</ul>
      </div>
    </div>
  )
}
