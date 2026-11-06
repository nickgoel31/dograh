import * as React from 'react'
import { toast } from 'sonner'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Mail, Moon, Phone, ShieldCheck, Sun, User } from '@/components/icons'
import { Badge, Button, Card, Field, Input, Select, Switch } from '@/components/ui'
import { MeshBadge } from '@/layout/Shell'
import { TableSkeleton } from '@/components/shared'
import { http } from '@/lib/api/http'
import { useMe } from '@/lib/useMe'
import { useUI } from '@/store/ui'
import { cn } from '@/lib/utils'

/** The person's own account: name, email, WhatsApp number, password and how the app looks for them. */
interface Account {
  name: string | null; email: string; email_verified: boolean; sign_in: 'google' | 'password'; has_password: boolean
  phone: string | null; phone_verified: boolean; phone_pending: string | null; whatsapp_ready: boolean
  timezone: string | null; two_step: boolean; member_since: string | null
}
const say = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—')
const ZONES = (() => { try { return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone') } catch { return ['Asia/Kolkata', 'UTC', 'Asia/Dubai', 'Europe/London', 'America/New_York'] } })()

const Section = ({ icon, title, desc, children, right }: { icon: React.ReactNode; title: string; desc?: string; children: React.ReactNode; right?: React.ReactNode }) => (
  <Card className="p-5 sm:p-6">
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-start gap-3"><span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-soft">{icon}</span>
        <div><h3 className="font-semibold">{title}</h3>{desc && <p className="mt-0.5 text-[13px] text-soft">{desc}</p>}</div></div>
      {right}
    </div>
    <div className="mt-5">{children}</div>
  </Card>
)

export function AccountSettings() {
  const qc = useQueryClient()
  const me = useMe().data
  const q = useQuery({ queryKey: ['account'], queryFn: () => http<Account>('/account') })
  const a = q.data
  const put = (acc: Account) => { qc.setQueryData(['account'], acc); qc.invalidateQueries({ queryKey: ['me'] }) }

  const [name, setName] = React.useState('')
  const [zone, setZone] = React.useState('')
  React.useEffect(() => { if (a) { setName(a.name ?? ''); setZone(a.timezone ?? '') } }, [a?.name, a?.timezone]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({ mutationFn: () => http<Account>('/account/profile', { method: 'PATCH', json: { name, timezone: zone } }), onSuccess: (r) => { put(r); toast.success('Profile saved') }, onError: say })

  const sendMail = useMutation({ mutationFn: () => http('/auth/verify/send', { method: 'POST' }), onSuccess: () => toast.success('We sent you a link. Open it to confirm your email.'), onError: say })

  const [phone, setPhone] = React.useState('+91 ')
  const [code, setCode] = React.useState('')
  const [editing, setEditing] = React.useState(false)
  const start = useMutation({ mutationFn: () => http<Account>('/account/phone/start', { method: 'POST', json: { phone } }), onSuccess: (r) => { put(r); setCode(''); toast.success('Code sent on WhatsApp') }, onError: say })
  const check = useMutation({ mutationFn: () => http<Account>('/account/phone/check', { method: 'POST', json: { code } }), onSuccess: (r) => { put(r); setEditing(false); setCode(''); toast.success('Number verified') }, onError: say })
  const remove = useMutation({ mutationFn: () => http<Account>('/account/phone', { method: 'DELETE' }), onSuccess: (r) => { put(r); toast.success('Number removed') }, onError: say })

  const [pw, setPw] = React.useState({ current: '', next: '', again: '' })
  const changePw = useMutation({
    mutationFn: () => http<Account>('/account/password', { method: 'POST', json: { current: pw.current || undefined, new: pw.next } }),
    onSuccess: (r) => { put(r); setPw({ current: '', next: '', again: '' }); toast.success('Password saved') }, onError: say,
  })
  const theme = useUI((s) => s.theme)
  const view = useUI((s) => s.view)
  const set = useUI((s) => s.set)

  if (q.isPending || !a) return <TableSkeleton rows={5} />
  const dirty = (name.trim() !== (a.name ?? '')) || zone !== (a.timezone ?? '')
  const pwOk = pw.next.length >= 8 && pw.next === pw.again && (!a.has_password || pw.current.length > 0)
  const awaiting = !!a.phone_pending && editing
  return (
    <div className="space-y-4">
      {/* who you are */}
      <Card className="relative overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full bg-[#8b5cf6]/10 blur-3xl" aria-hidden />
        <div className="relative flex flex-wrap items-center gap-4">
          <MeshBadge className="h-16 w-16 rounded-full text-xl">{(a.name || a.email)[0]?.toUpperCase()}</MeshBadge>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[20px] font-semibold tracking-tight">{a.name || a.email}</div>
            <div className="mt-0.5 truncate text-sm text-soft">{a.email}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {me?.current_workspace && <Badge>{me.current_workspace.role[0].toUpperCase() + me.current_workspace.role.slice(1)} of {me.current_workspace.name}</Badge>}
              <Badge tone={a.email_verified ? 'green' : undefined}>{a.email_verified ? 'Email verified' : 'Email not verified'}</Badge>
              {a.phone_verified && <Badge tone="green">WhatsApp verified</Badge>}
            </div>
          </div>
          <div className="text-xs text-soft">Member since {day(a.member_since)}</div>
        </div>
      </Card>

      <Section icon={<User size={17} />} title="Profile" desc="How your name shows to your team and on invoices.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name"><Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Timezone" hint={<span className="text-xs text-soft">Used for times in emails and reports.</span>}>
            <Select value={zone} onChange={(e) => setZone(e.target.value)}><option value="">Use my browser's timezone</option>{ZONES.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}</Select></Field>
        </div>
        <Button variant="primary" className="mt-4" disabled={!dirty || !name.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save changes'}</Button>
      </Section>

      <Section icon={<Mail size={17} />} title="Email" desc="Where we send receipts, alerts and password links." right={<Badge tone={a.email_verified ? 'green' : undefined}>{a.email_verified ? 'Verified' : 'Not verified'}</Badge>}>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-surface px-4 py-3">
          <div className="min-w-0"><div className="truncate text-sm font-medium">{a.email}</div>
            <div className="text-xs text-soft">{a.sign_in === 'google' ? 'You sign in with Google, which has already checked this address.' : a.email_verified ? 'You confirmed this address.' : 'Confirm it so we can reach you if something needs attention.'}</div></div>
          {!a.email_verified && <Button size="sm" disabled={sendMail.isPending} onClick={() => sendMail.mutate()}>{sendMail.isPending ? 'Sending…' : 'Send verification email'}</Button>}
        </div>
        <p className="mt-2 text-xs text-soft">To use a different email, ask support. Your sign-in is tied to it.</p>
      </Section>

      <Section icon={<Phone size={17} />} title="WhatsApp number" desc="We confirm it with a code sent on WhatsApp. It also lets us reach you about your account." right={a.phone_verified ? <Badge tone="green">Verified</Badge> : <Badge>Not added</Badge>}>
        {a.phone_verified && !editing ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-surface px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-ok/15 text-ok"><Check size={13} /></span>{a.phone}</div>
            <div className="flex gap-2"><Button size="sm" onClick={() => { setEditing(true); setPhone('+91 ') }}>Change</Button><Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove</Button></div>
          </div>
        ) : !a.whatsapp_ready ? (
          <p className="rounded-xl bg-muted px-4 py-3 text-sm text-soft">WhatsApp verification isn't switched on yet, so a number can't be added right now.</p>
        ) : !awaiting ? (
          <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); setEditing(true); start.mutate() }}>
            <Field label={a.phone_verified ? 'New WhatsApp number' : 'Your WhatsApp number'} className="sm:max-w-xs sm:flex-1"><Input type="tel" inputMode="tel" autoComplete="tel" placeholder="+91 98111 12222" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
            <div className="flex gap-2"><Button variant="primary" disabled={phone.replace(/\D/g, '').length < 10 || start.isPending}>{start.isPending ? 'Sending…' : 'Send code'}</Button>{a.phone_verified && <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}</div>
          </form>
        ) : (
          <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); check.mutate() }}>
            <Field label={`6-digit code sent to ${a.phone_pending}`} className="sm:max-w-xs sm:flex-1"><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" className="text-center tracking-[0.35em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>
            <div className="flex gap-2"><Button variant="primary" disabled={code.length < 6 || check.isPending}>{check.isPending ? 'Checking…' : 'Verify'}</Button><Button type="button" variant="ghost" onClick={() => start.mutate()} disabled={start.isPending}>Send again</Button></div>
          </form>
        )}
      </Section>

      <Section icon={<ShieldCheck size={17} />} title={a.has_password ? 'Password' : 'Sign-in'} desc={a.sign_in === 'google' ? 'You sign in with Google. You can also set a password, if you want to sign in with your email too.' : 'Change the password you use with your email.'}>
        <div className="grid gap-3 sm:grid-cols-3">
          {a.has_password && <Field label="Current password"><Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>}
          <Field label={a.has_password ? 'New password' : 'Choose a password'} hint={<span className="text-xs text-soft">At least 8 characters.</span>}><Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          <Field label="Repeat it"><Input type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} /></Field>
        </div>
        {pw.again && pw.next !== pw.again && <p className="mt-2 text-xs text-bad">The two passwords don't match.</p>}
        <div className="mt-4 flex flex-wrap items-center gap-3"><Button variant="primary" disabled={!pwOk || changePw.isPending} onClick={() => changePw.mutate()}>{changePw.isPending ? 'Saving…' : a.has_password ? 'Change password' : 'Set password'}</Button>
          <span className="text-xs text-soft">Two-step sign-in is {a.two_step ? 'on' : 'off'}. Manage it under Security.</span></div>
      </Section>

      <Section icon={theme === 'dark' ? <Moon size={17} /> : <Sun size={17} />} title="Appearance" desc="How the app looks on this device.">
        <div className="flex flex-wrap gap-2">{([['light', 'Light', Sun], ['dark', 'Dark', Moon]] as const).map(([k, l, Icon]) => (
          <button key={k} onClick={() => set({ theme: k })} aria-pressed={theme === k} className={cn('flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition', theme === k ? 'border-ink bg-ink text-surface' : 'bg-surface text-soft hover:border-soft/50 hover:text-ink')}><Icon size={15} />{l}</button>))}</div>
        <div className="mt-5 flex items-center justify-between gap-6 rounded-xl border bg-surface px-4 py-3">
          <div><div className="text-sm font-medium">Advanced view</div><div className="text-xs text-soft">Show every technical option, like Developers and the Testing Lab.</div></div>
          <Switch label="Advanced view" checked={view === 'advanced'} onChange={(v) => set({ view: v ? 'advanced' : 'simple' })} />
        </div>
      </Section>
    </div>
  )
}
