import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BRAND, TAGLINE } from '@/config/brand'
import { authApi, ApiError } from '@/lib/api'
import { Button, Card, Input } from '@/components/ui'
import { Logo } from '@/layout/Shell'

export default function AuthPage() {
  const qc = useQueryClient()
  const [signup, setSignup] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [f, setF] = React.useState({ name: '', email: '', password: '' })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      if (signup) await authApi.signup(f)
      else await authApi.login({ email: f.email, password: f.password })
      // The session cookie is set; refetch /me so the app gate lets us in.
      await qc.invalidateQueries({ queryKey: ['me'] })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally { setBusy(false) }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <Card className="w-full max-w-sm p-6">
        <Logo />
        <p className="mt-1 text-sm text-soft">{TAGLINE}</p>
        <h1 className="mt-6 text-lg font-semibold">{signup ? `Create your ${BRAND} account` : 'Welcome back'}</h1>
        <form onSubmit={submit} className="mt-4 space-y-3">
          {signup && <Input placeholder="Your name" value={f.name} onChange={set('name')} required autoComplete="name" />}
          <Input type="email" placeholder="Email" value={f.email} onChange={set('email')} required autoComplete="email" />
          <Input type="password" placeholder={signup ? 'Password (8+ characters)' : 'Password'} value={f.password} onChange={set('password')} required minLength={signup ? 8 : 1} autoComplete={signup ? 'new-password' : 'current-password'} />
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <Button variant="primary" className="w-full" disabled={busy}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}</Button>
        </form>
        <button type="button" onClick={() => { setSignup(!signup); setError(null) }} className="mt-4 text-sm text-accent hover:underline">
          {signup ? 'I already have an account' : "New here? Create an account"}
        </button>
      </Card>
    </div>
  )
}
