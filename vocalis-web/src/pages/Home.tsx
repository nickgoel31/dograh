import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { AlertTriangle, ArrowRight, Check, Mic } from 'lucide-react'
import { Button, Card, Switch } from '@/components/ui'
import { PageHeader, StatCard, useAsync } from '@/components/shared'
import { Skeleton } from '@/components/ui'
import { api } from '@/lib/api'
import { USE_MOCKS } from '@/lib/api/env'
import { HomeReal } from './GrowthReal'
import { useUI } from '@/store/ui'
import { useData } from '@/store/data'
import { money, cn } from '@/lib/utils'
import { calls } from '@/mock/calls'
import { BRAND } from '@/config/brand'

const steps = [
  { t: 'Create your agent', d: 'Tell us what it should do. We do the rest.', to: '/agents/new', cta: 'Create agent', emoji: '🤖' },
  { t: 'Give it a voice', d: 'Pick a voice that sounds like your brand.', to: '/voices', cta: 'Pick a voice', emoji: '🎙️' },
  { t: 'Talk to it in your browser', d: 'A free practice call. No phone needed.', to: 'talk', cta: 'Start talking', emoji: '💬' },
  { t: 'Connect a phone number', d: 'So real people can call it.', to: '/numbers', cta: 'Get a number', emoji: '📞' },
]

function Onboarding() {
  const nav = useNavigate()
  const set = useUI((s) => s.set)
  const first = useData((s) => s.agents[0])
  const [done, setDone] = React.useState([true, false, false, false])
  const pct = (done.filter(Boolean).length / 4) * 100
  return (
    <>
      <Card className="mb-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 bg-gradient-to-r from-accent-soft to-surface p-6">
          <div><div className="text-sm font-medium text-accent">{done.filter(Boolean).length} of 4 done</div><h2 className="mt-1 text-xl font-semibold">Let’s get you talking in 4 easy steps</h2></div>
          <div className="w-full max-w-xs"><div className="h-2.5 overflow-hidden rounded-full bg-surface"><div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: pct + '%' }} /></div></div>
        </div>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2">
        {steps.map((s, i) => (
          <Card key={s.t} className={cn('flex items-start gap-4 p-6', done[i] && 'opacity-70')}>
            <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl', done[i] ? 'bg-ok/10' : 'bg-accent-soft')}>{done[i] ? <Check className="text-ok" /> : s.emoji}</div>
            <div className="flex-1"><h3 className="font-semibold">{i + 1}. {s.t}</h3><p className="mt-1 text-soft">{s.d}</p>
              <Button variant={done[i] ? 'secondary' : 'primary'} size="lg" className="mt-4 h-11" onClick={() => { setDone((d) => d.map((x, k) => (k === i ? true : x))); s.to === 'talk' ? set({ playground: first.id }) : nav(s.to) }}>{done[i] ? 'Do it again' : s.cta}<ArrowRight size={16} /></Button></div>
          </Card>
        ))}
      </div>
    </>
  )
}

function Existing() {
  const mode = useUI((s) => s.mode)
  const set = useUI((s) => s.set)
  const agents = useData((s) => s.agents)
  const k = useAsync(() => api.kpis(mode), [mode])
  const d = useAsync(() => api.days(mode), [mode])
  const failed = calls.filter((c) => c.outcome === 'failed').slice(0, 3)
  const x = k.data
  return (
    <>
      <Card className="mb-6 flex flex-wrap items-center justify-between gap-4 bg-gradient-to-br from-accent to-[#2f9e83] p-8 text-white">
        <div><h2 className="text-2xl font-semibold">Talk to your agent now</h2><p className="mt-1 text-white/80">Have a free practice call, right here in your browser.</p></div>
        <Button size="lg" className="h-14 bg-white px-8 text-base text-accent hover:bg-white/90" onClick={() => set({ playground: agents[0].id })}><Mic size={20} />Start talking</Button>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Calls today" loading={k.loading} value={x?.calls} delta="+12%" />
        <StatCard label="Success rate" loading={k.loading} value={x && x.success + '%'} delta="+2%" hint="How many calls ended with the caller getting what they wanted." />
        <StatCard label="Minutes used" loading={k.loading} value={x?.minutes.toLocaleString('en-IN')} delta="+8%" />
        <StatCard label="Spend" loading={k.loading} value={x && money(x.spend)} delta={mode === 'test' ? undefined : '+5%'} hint={mode === 'test' ? 'Test calls are always free.' : undefined} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card className="p-6">
          <h3 className="font-semibold">Calls over the last 2 weeks</h3>
          <div className="mt-4 h-60">
            {d.loading ? <Skeleton className="h-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={d.data!}><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.25} /><stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid vertical={false} stroke="hsl(var(--line))" /><XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={12} stroke="hsl(var(--soft))" interval={2} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--line))', background: 'hsl(var(--surface))' }} />
                  <Area type="monotone" dataKey="calls" stroke="hsl(var(--accent))" strokeWidth={2.5} fill="url(#g)" /></AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
        <Card className="p-6">
          <h3 className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} className="text-warn" />Needs attention</h3>
          <ul className="mt-4 space-y-2">
            <li><Link to="/conversations?failed=1" className="block rounded-lg bg-warn/10 p-3 text-sm font-medium text-warn hover:brightness-95">3 calls failed. Tap to see why →</Link></li>
            {failed.slice(0, 2).map((c) => <li key={c.id}><Link to={'/conversations/' + c.id} className="block rounded-lg border p-3 text-sm hover:bg-muted"><div className="font-medium">{c.caller}</div><div className="text-soft">{c.failReason}</div></Link></li>)}
            <li><Link to="/tools" className="block rounded-lg border p-3 text-sm hover:bg-muted"><div className="font-medium">Your calendar got disconnected</div><div className="text-soft">Click to reconnect.</div></Link></li>
          </ul>
        </Card>
      </div>
    </>
  )
}

function DemoHomePage() {
  const [newUser, setNewUser] = React.useState(false)
  return (
    <>
      <PageHeader title={newUser ? `Welcome to ${BRAND} 👋` : 'Good morning, Aarav'} subtitle={newUser ? 'You’re a few clicks away from your first talking agent.' : 'Here’s how your agents are doing today.'}
        actions={<label className="flex items-center gap-2 rounded-lg border bg-surface px-3 py-1.5 text-xs text-soft"><span>Demo: new user</span><Switch checked={newUser} onChange={setNewUser} label="Show new user view" /></label>} />
      {newUser ? <Onboarding /> : <Existing />}
    </>
  )
}

export default function HomePage() {
  return USE_MOCKS ? <DemoHomePage /> : <HomeReal />
}
