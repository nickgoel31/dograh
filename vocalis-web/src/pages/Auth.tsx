import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LucideIcon } from '@/components/icons'
import { AlertCircle, ArrowLeft, ArrowRight, Check, Eye, EyeOff, Lock, Mail, ShieldCheck, User } from '@/components/icons'
import { ApiError, authApi } from '@/lib/api'
import { BRAND } from '@/config/brand'
import { CLASSIC_URL } from '@/lib/api/env'
import { Button } from '@/components/ui'
import { cn } from '@/lib/utils'

declare global { interface Window { google?: { accounts: { id: { initialize: (o: Record<string, unknown>) => void; renderButton: (el: HTMLElement, o: Record<string, unknown>) => void } } } } }

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
  const [notEnabled, setNotEnabled] = React.useState(false)
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
      setNotEnabled(err instanceof ApiError && err.code === 'not_enabled')
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
    <p role="alert" className="flex items-start gap-2 rounded-xl border border-bad/25 bg-bad/10 px-3.5 py-2.5 text-sm text-bad"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{error}{notEnabled && CLASSIC_URL && <a href={CLASSIC_URL} className="mt-1.5 block font-semibold underline">Open the classic app</a>}</span></p>
  )
  const eye = (
    <button type="button" onClick={() => setShow(!show)} className="rounded-lg p-2 text-soft transition hover:bg-muted hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
  )

  return (
    <div className="grid min-h-screen bg-bg p-0 lg:h-screen lg:grid-cols-[minmax(460px,1fr)_auto] lg:gap-3 lg:p-3">
      <div className="relative flex items-center justify-center overflow-hidden bg-surface px-6 py-12 lg:rounded-3xl lg:border lg:border-line/70 lg:shadow-raised">
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-accent/[.07] blur-3xl" aria-hidden />
        <div className="relative w-full max-w-[400px]">
          <div className="flex items-center gap-3 text-[19px] font-extrabold tracking-tight">
            <img src={`${import.meta.env.BASE_URL}swarvo-logo.webp`} alt="" className="h-10 w-10 rounded-xl object-contain dark:invert" />{BRAND}
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
                  className={cn('rounded-lg px-4 py-1.5 text-[13px] font-semibold transition', signup === isSignup ? 'bg-surface text-ink ring-1 ring-line' : 'text-soft hover:text-ink')}>{label}</button>
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

      <div className="relative hidden overflow-hidden rounded-3xl bg-[#04201c] lg:block lg:aspect-[8/9] lg:h-full lg:max-w-[52vw]">
        <img src="/auth-image.png" alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-[#0b1020]/90 via-[#0b1020]/55 to-transparent" aria-hidden />
        <div className="absolute inset-x-0 bottom-0 p-8 text-white"><h2 className="text-[30px] font-extrabold leading-[1.1] tracking-[-0.03em] [text-shadow:0_2px_16px_rgba(0,0,0,.45)]">Your business, answered. Every call.</h2><p className="mt-2 text-[14px] leading-snug text-white/85 [text-shadow:0_1px_10px_rgba(0,0,0,.5)]">Build a voice agent in minutes, give it a phone number, and let it book and follow up while you work.</p></div>
      </div>
    </div>
  )
}
