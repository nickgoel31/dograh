import * as React from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Copy, Mic, Pause, Play, Plus, Search, Trash2 } from '@/components/icons'
import { AgentAvatar } from '@/components/AgentAvatar'
import { toast } from 'sonner'
import { Button, Card, Chip } from '@/components/ui'
import { CardSkeletons, ConfirmDialog, EmptyState, PageHeader, Sparkline, StatusBadge, useAsync } from '@/components/shared'
import { useData } from '@/store/data'
import { useUI } from '@/store/ui'
import { sleep } from '@/lib/utils'
import type { Agent } from '@/mock/types'

export default function AgentsPage() {
  const { agents, duplicate, updateAgent, remove } = useData()
  const [del, setDel] = React.useState<Agent | null>(null)
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
        <div className="flex h-10 w-full max-w-xs items-center gap-2 rounded-full border bg-surface px-3.5 text-sm text-soft transition focus-within:border-soft/50"><Search size={15} /><input className="w-full bg-transparent text-ink outline-none placeholder:text-soft/70" placeholder="Search agents" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search agents" /></div>
        <div className="flex gap-2">{(['all', 'live', 'draft', 'paused'] as const).map((s) => <Chip key={s} active={f === s} onClick={() => setF(s)}>{s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}</Chip>)}</div>
      </div>
      {loading ? <CardSkeletons /> : shown.length === 0 ? (
        <EmptyState emoji="🤖" title="No agents here yet" text="Make your first agent in about a minute. Just tell it what to do." action={<Link to="/agents/new"><Button variant="primary" size="lg"><Plus size={18} />Create an agent</Button></Link>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((a) => (
            <motion.div key={a.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <Card className="group rounded-2xl p-5 shadow-none transition hover:bg-muted/40">
                <div className="flex items-start justify-between">
                  <Link to={'/agents/' + a.id} className="flex items-center gap-3">
                    <AgentAvatar id={a.id} emoji={a.emoji} className="h-11 w-11" size={20} />
                    <div><div className="font-semibold">{a.name}</div><div className="text-[13px] text-soft">{a.role}</div></div>
                  </Link>
                  <StatusBadge status={a.status} />
                </div>
                <div className="mt-5 grid grid-cols-2 gap-4">
                  <div><div className="text-xs text-soft">Calls today</div><div className="num text-xl font-semibold">{a.callsToday}</div></div>
                  <div><div className="text-xs text-soft">Success rate</div><div className="num text-xl font-semibold">{a.successRate ? a.successRate + '%' : '—'}</div></div>
                </div>
                {a.spark.some((v) => v > 0) && <div className="mt-3"><Sparkline data={a.spark} color="#6366f1" /></div>}
                <div className="mt-4 flex items-center gap-2 border-t pt-3">
                  <Button size="sm" onClick={() => set({ playground: a.id })}><Mic size={14} />Talk</Button>
                  <Button size="sm" variant="ghost" onClick={() => { duplicate(a.id); toast.success('Copied! Find it at the top.') }}><Copy size={14} />Duplicate</Button>
                  <Button size="sm" variant="ghost" disabled={a.status === 'draft'} onClick={() => { const p = a.status === 'paused'; updateAgent(a.id, { status: p ? 'live' : 'paused' }); toast(p ? `${a.name} is live again` : `${a.name} is paused`) }}>
                    {a.status === 'paused' ? <><Play size={14} />Resume</> : <><Pause size={14} />Pause</>}
                  </Button>
                  <Button size="sm" variant="ghost" className="ml-auto hover:text-bad" aria-label={`Delete ${a.name}`} onClick={() => setDel(a)}><Trash2 size={14} /></Button>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} danger confirm="Delete agent" title={`Delete ${del?.name ?? 'this agent'}?`}
        text="This removes the agent and its settings for good. Phone numbers that use it will stop answering until you point them at another agent. Past calls stay in Conversations."
        onConfirm={() => { const a = del; if (a) remove(a.id).then(() => toast.success(`${a.name} was deleted`)).catch((e) => toast.error(e instanceof Error ? e.message : 'We could not delete that agent.')) }} />
    </>
  )
}

export { NewAgentPage, TemplatesPage } from './AgentCreate'
