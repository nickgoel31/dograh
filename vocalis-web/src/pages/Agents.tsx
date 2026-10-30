import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Copy, Mic, Pause, Play, Plus, Search, Sparkles, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, Chip, Input, Menu, MenuContent, MenuItem, MenuTrigger, Textarea } from '@/components/ui'
import { CardSkeletons, EmptyState, PageHeader, Sparkline, StatusBadge, useAsync } from '@/components/shared'
import { useData } from '@/store/data'
import { useUI } from '@/store/ui'
import { templates } from '@/mock/agents'
import { sleep, cn } from '@/lib/utils'
import type { Agent } from '@/mock/types'

export default function AgentsPage() {
  const { agents, duplicate, updateAgent } = useData()
  const set = useUI((s) => s.set)
  const { loading } = useAsync(() => sleep(500), [])
  const [q, setQ] = React.useState('')
  const [f, setF] = React.useState<'all' | Agent['status']>('all')
  const shown = agents.filter((a) => (f === 'all' || a.status === f) && a.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <PageHeader title="Agents" subtitle="Your AI team members. Each one answers calls in its own way."
        actions={<><Link to="/agents/templates"><Button>Browse templates</Button></Link><Link to="/agents/new"><Button variant="primary"><Plus size={16} />New agent</Button></Link></>} />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs"><Search size={15} className="absolute left-3 top-2.5 text-soft" /><Input className="pl-9" placeholder="Search agents…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search agents" /></div>
        <div className="flex gap-2">{(['all', 'live', 'draft', 'paused'] as const).map((s) => <Chip key={s} active={f === s} onClick={() => setF(s)}>{s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}</Chip>)}</div>
      </div>
      {loading ? <CardSkeletons /> : shown.length === 0 ? (
        <EmptyState emoji="🤖" title="No agents here yet" text="Make your first agent in about a minute. Just tell it what to do." action={<Link to="/agents/new"><Button variant="primary" size="lg"><Plus size={18} />Create an agent</Button></Link>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((a) => (
            <motion.div key={a.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <Card className="group p-5 transition hover:shadow-pop">
                <div className="flex items-start justify-between">
                  <Link to={'/agents/' + a.id} className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl text-2xl" style={{ background: a.color + '22' }}>{a.emoji}</div>
                    <div><div className="font-semibold group-hover:text-accent">{a.name}</div><div className="text-[13px] text-soft">{a.role}</div></div>
                  </Link>
                  <StatusBadge status={a.status} />
                </div>
                <div className="mt-5 grid grid-cols-2 gap-4">
                  <div><div className="text-xs text-soft">Calls today</div><div className="num text-xl font-semibold">{a.callsToday}</div></div>
                  <div><div className="text-xs text-soft">Success rate</div><div className="num text-xl font-semibold">{a.successRate ? a.successRate + '%' : '—'}</div></div>
                </div>
                <div className="mt-3"><Sparkline data={a.spark} color={a.color} /></div>
                <div className="mt-3 flex items-center gap-2 border-t pt-3">
                  <Button size="sm" onClick={() => set({ playground: a.id })}><Mic size={14} />Talk</Button>
                  <Button size="sm" variant="ghost" onClick={() => { duplicate(a.id); toast.success('Copied! Find it at the top.') }}><Copy size={14} />Duplicate</Button>
                  <Button size="sm" variant="ghost" disabled={a.status === 'draft'} onClick={() => { const p = a.status === 'paused'; updateAgent(a.id, { status: p ? 'live' : 'paused' }); toast(p ? `${a.name} is live again` : `${a.name} is paused`) }}>
                    {a.status === 'paused' ? <><Play size={14} />Resume</> : <><Pause size={14} />Pause</>}
                  </Button>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </>
  )
}

export function TemplatesPage() {
  const nav = useNavigate()
  return (
    <>
      <PageHeader title="Template gallery" subtitle="Start from something that already works. You can change everything later." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {templates.map((t) => (
          <Card key={t.id} className="flex flex-col p-5 transition hover:shadow-pop">
            <div className="text-4xl">{t.emoji}</div><h3 className="mt-3 font-semibold">{t.name}</h3><p className="mt-1 flex-1 text-soft">{t.blurb}</p>
            <Button className="mt-4" onClick={() => nav('/agents/new?template=' + t.id)}>Use this template</Button>
          </Card>
        ))}
      </div>
    </>
  )
}

const goals = [
  { id: 'answer', emoji: '📞', t: 'Answer calls', d: 'Greet callers and answer questions', name: 'Receptionist' },
  { id: 'book', emoji: '📅', t: 'Book appointments', d: 'Fill your calendar automatically', name: 'Booker' },
  { id: 'leads', emoji: '🎯', t: 'Qualify leads', d: 'Find out who is ready to buy', name: 'Qualifier' },
  { id: 'support', emoji: '🛟', t: 'Customer support', d: 'Solve problems, 24 hours a day', name: 'Support Hero' },
  { id: 'orders', emoji: '🛍️', t: 'Take orders', d: 'Collect orders over the phone', name: 'Order Taker' },
  { id: 'survey', emoji: '📋', t: 'Run surveys', d: 'Collect feedback quickly', name: 'Surveyor' },
]

export function NewAgentPage() {
  const nav = useNavigate()
  const { addAgent } = useData()
  const set = useUI((s) => s.set)
  const [step, setStep] = React.useState(1)
  const [goal, setGoal] = React.useState<(typeof goals)[number] | null>(null)
  const [desc, setDesc] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [agent, setAgent] = React.useState<Agent | null>(null)

  const generate = async () => {
    setBusy(true)
    await sleep(2000)
    const g = goal ?? goals[0]
    const a: Agent = {
      id: 'a' + Date.now(), name: `${['Asha', 'Neel', 'Tara', 'Kai'][Math.floor(Math.random() * 4)]} — ${g.name}`, emoji: g.emoji, color: '#6356f1', role: g.t, status: 'draft', callsToday: 0, successRate: 0,
      spark: [0, 0, 0, 0, 0, 0, 0, 0], voiceId: 'v3', brain: 'balanced', tone: 'Friendly', business: desc.split('.')[0].slice(0, 40) || 'My business', whatYouDo: desc || 'Answer questions politely.',
      prompt: `You are a warm, helpful phone assistant for {{business_name}}.\nYour job: ${g.t.toLowerCase()}.\nBackground: ${desc || 'a friendly local business'}\nGreet {{caller_name}}, keep answers short, and ask one question at a time.`, numbers: [],
    }
    addAgent(a); setAgent(a); setBusy(false); setStep(3)
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Create a new agent" subtitle="Three quick steps. No technical knowledge needed." />
      <div className="mb-8 flex items-center gap-3" aria-label={`Step ${step} of 3`}>
        {[1, 2, 3].map((n) => <div key={n} className="flex flex-1 items-center gap-3"><div className={cn('flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold', step >= n ? 'bg-accent text-accent-fg' : 'bg-muted text-soft')}>{n}</div><div className={cn('h-1 flex-1 rounded-full', step > n ? 'bg-accent' : 'bg-line', n === 3 && 'hidden')} /></div>)}
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18 }}>
          {step === 1 && (
            <>
              <h2 className="mb-4 text-lg font-semibold">What should your agent do?</h2>
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                {goals.map((g) => (
                  <button key={g.id} onClick={() => { setGoal(g); setStep(2) }} className={cn('rounded-xl border bg-surface p-5 text-left shadow-card transition hover:-translate-y-0.5 hover:border-accent hover:shadow-pop', goal?.id === g.id && 'border-accent')}>
                    <div className="text-4xl">{g.emoji}</div><div className="mt-3 font-semibold">{g.t}</div><div className="mt-0.5 text-[13px] text-soft">{g.d}</div>
                  </button>
                ))}
              </div>
            </>
          )}
          {step === 2 && (
            <Card className="p-6">
              <h2 className="text-lg font-semibold">Describe your business and what the agent should do</h2>
              <p className="mt-1 text-soft">Write it like you’d explain it to a new employee.</p>
              <Textarea className="mt-4 min-h-[140px]" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Example: We run a dental clinic in Pune. Answer questions about prices and book check-ups on weekdays." aria-label="Describe your business" />
              <button className="mt-2 text-[13px] text-accent hover:underline" onClick={() => setDesc('We run a dental clinic in Pune. Answer questions about prices and opening hours, and book check-ups on weekdays between 10 AM and 6 PM.')}>Use an example</button>
              <div className="mt-6 flex items-center justify-between">
                <Button onClick={() => setStep(1)} disabled={busy}>Back</Button>
                <Button variant="primary" size="lg" onClick={generate} disabled={busy}>{busy ? <><Wand2 size={18} className="animate-spin" />Building your agent…</> : <><Sparkles size={18} />Generate my agent</>}</Button>
              </div>
              {busy && <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-muted"><motion.div className="h-full bg-accent" initial={{ width: 0 }} animate={{ width: '100%' }} transition={{ duration: 2, ease: 'easeInOut' }} /></div>}
            </Card>
          )}
          {step === 3 && agent && (
            <Card className="p-8 text-center">
              <motion.div initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: 'spring' }} className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-accent-soft text-5xl">{agent.emoji}</motion.div>
              <h2 className="mt-4 text-xl font-semibold">Meet {agent.name.split(' — ')[0]}!</h2>
              <p className="mx-auto mt-1 max-w-md text-soft">{agent.role}. Friendly voice, balanced brain. Ready to try.</p>
              <div className="mt-3 flex justify-center gap-2"><Badge tone="accent">Friendly tone</Badge><Badge>Draft</Badge></div>
              <Button variant="primary" size="lg" className="mt-6 h-14 px-8 text-base" onClick={() => set({ playground: agent.id })}><Mic size={20} />Talk to it now</Button>
              <div className="mt-4"><Button variant="ghost" onClick={() => nav('/agents/' + agent.id + '?tab=publish')}>Continue to Go Live checklist →</Button></div>
            </Card>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
