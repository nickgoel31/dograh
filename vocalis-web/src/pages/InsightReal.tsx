/** Real Analytics and Testing Lab. Demo versions stay in their own files for mock mode. */
import { Glyph } from '@/components/Glyph'
import * as React from 'react'
import { AlertCircle, CheckCircle2, Circle, Lightbulb, Play, Plus, Trash2 } from '@/components/icons'
import { AgentAvatar } from '@/components/AgentAvatar'
import { toast } from 'sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import { Badge, Button, Card, Field, Input, Select, Tab, TabPanel, Tabs, TabsList, Textarea } from '@/components/ui'
import { PageHeader, TableSkeleton } from '@/components/shared'
import { VoicePlayground } from '@/components/Playground'
import { http } from '@/lib/api/http'
import { useData } from '@/store/data'
import { useUI } from '@/store/ui'
import type { components } from '@/lib/api/schema'

type S = components['schemas']
const say = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
const fmt = (n: number, cur: string) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(n)

/* ---------------- Analytics ---------------- */
type Period = { calls: number; minutes: number; bookings: number; qualified: number; resolution_rate: number | null; money_saved: number; hours_replaced: number; total_cost: number; per_call: number; per_minute: number; days: Record<string, number | string>[] }

function Delta({ now, before }: { now: number; before?: number }) {
  if (before === undefined) return null
  const d = before ? Math.round(((now - before) / before) * 100) : null
  return <span className={`ml-2 text-xs ${d === null ? 'text-soft' : d >= 0 ? 'text-ok' : 'text-bad'}`}>{d === null ? 'new' : `${d >= 0 ? '+' : ''}${d}%`}</span>
}

export function AnalyticsReal() {
  const mode = useUI((s) => s.mode)
  const qc = useQueryClient()
  const agents = useData((s) => s.agents)
  const [days, setDays] = React.useState(30)
  const [agent, setAgent] = React.useState('')
  const [compare, setCompare] = React.useState(false)
  const q = useQuery({ queryKey: ['analytics', mode, days, agent, compare], queryFn: () => http<S['AnalyticsOut']>(`/analytics?days=${days}&compare=${compare}${agent ? `&agent=${agent}` : ''}`) })
  const ins = useQuery({ queryKey: ['insights', mode], queryFn: () => http<S['InsightOut'][]>('/analytics/insights') })
  const [cost, setCost] = React.useState('')
  const a = q.data
  const cur = a?.current as Period | undefined
  const prev = a?.previous as Period | null | undefined
  const stat = (label: string, v: React.ReactNode, now?: number, before?: number, hint?: string) => (
    <Card className="p-5" key={label}><div className="text-sm text-soft" title={hint}>{label}</div><div className="num mt-1 flex items-baseline text-2xl font-semibold">{v}{now !== undefined && <Delta now={now} before={before} />}</div></Card>)
  return (
    <>
      <PageHeader title="Analytics" subtitle="How your agents are doing, in plain numbers." actions={
        <div className="flex flex-wrap items-center gap-2">
          <Select className="w-auto" value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Agent"><option value="">All agents</option>{agents.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
          <Select className="w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">{[7, 30, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}</Select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />Compare</label>
        </div>} />
      {a?.free_mode && <Card className="mb-4 border-warn/40 bg-warn/10 p-4 text-sm text-warn">You're looking at Test mode, so costs are zero. Switch to Live for real numbers.</Card>}
      {(ins.data?.length ?? 0) > 0 && (
        <Card className="mb-4 p-5"><div className="mb-2 flex items-center gap-2 font-semibold"><Lightbulb size={16} className="text-accent" />This week's insights</div>
          <ul className="space-y-1.5 text-sm">{ins.data!.map((i) => <li key={i.id}>• {i.text}</li>)}</ul></Card>)}
      <Tabs defaultValue="business"><TabsList><Tab value="business">Business</Tab><Tab value="quality">Quality</Tab><Tab value="cost">Cost</Tab></TabsList>
        {q.isPending || !a || !cur ? <div className="mt-4"><TableSkeleton rows={3} /></div> : <>
          <TabPanel value="business">
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {stat('Calls', cur.calls, cur.calls, prev?.calls)}{stat('Bookings', cur.bookings, cur.bookings, prev?.bookings)}
              {stat('Leads qualified', cur.qualified, cur.qualified, prev?.qualified)}{stat('Hours of work replaced', cur.hours_replaced, cur.hours_replaced, prev?.hours_replaced, 'Total call minutes divided by 60')}
              {stat('Estimated money saved', fmt(cur.money_saved, a.currency), cur.money_saved, prev?.money_saved, `Call minutes x ${fmt(a.human_cost_per_min, a.currency)} per minute`)}
            </div>
            <Card className="mt-4 p-5 text-sm"><div className="font-medium">How “money saved” is worked out</div>
              <p className="mt-1 text-soft">Call minutes x what a person would cost per minute ({fmt(a.human_cost_per_min, a.currency)}{a.human_cost_is_default ? ', our starting guess' : ''}). Change it to match your own costs.</p>
              <div className="mt-2 flex gap-2"><Input className="max-w-[140px]" type="number" min={0} placeholder={String(a.human_cost_per_min)} value={cost} onChange={(e) => setCost(e.target.value)} aria-label="Cost of a person per minute" />
                <Button onClick={() => http('/analytics/settings', { method: 'PATCH', json: { human_cost_per_min: Number(cost) } }).then(() => { toast.success('Saved!'); setCost(''); qc.invalidateQueries({ queryKey: ['analytics'] }) }).catch(say)} disabled={!cost}>Save</Button></div></Card>
            <Chart title="Calls and bookings per day" data={cur.days} keys={[['calls', 'Calls'], ['bookings', 'Bookings']]} />
          </TabPanel>
          <TabPanel value="quality">
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {stat('Calls that went well', cur.resolution_rate === null ? '—' : `${cur.resolution_rate}%`, cur.resolution_rate ?? undefined, prev?.resolution_rate ?? undefined, 'Booked, resolved, qualified or handed to a person')}
              {stat('Average reply speed', a.avg_reply_seconds === null ? '—' : `${a.avg_reply_seconds}s`)}
              {stat('Interruptions', 'Not tracked yet')}{stat('Caller mood', 'Not tracked yet')}
            </div>
            <Card className="mt-4 p-5"><div className="font-semibold">Where calls get to</div><p className="text-[13px] text-soft">How many calls reached each step of your call flow.</p>
              {a.funnel.length === 0 ? <p className="mt-3 text-sm text-soft">Not enough calls yet.</p> : (
                <div className="mt-3 space-y-2">{a.funnel.map((f) => { const top = Number(a.funnel[0].count) || 1; return (
                  <div key={String(f.step)}><div className="flex justify-between text-sm"><span>{String(f.step)}</span><span className="num text-soft">{String(f.count)}</span></div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-accent" style={{ width: `${Math.round((100 * Number(f.count)) / top)}%` }} /></div></div>) })}</div>)}</Card>
          </TabPanel>
          <TabPanel value="cost">
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {stat('Total', fmt(cur.total_cost, a.currency), cur.total_cost, prev?.total_cost)}{stat('Per call', fmt(cur.per_call, a.currency))}{stat('Per minute', fmt(cur.per_minute, a.currency))}
            </div>
            <Chart title="Where the money goes, per day" data={cur.days} stacked keys={[['stt', 'Listening'], ['brain', 'Thinking'], ['voice', 'Speaking']]} />
            <p className="mt-2 text-xs text-soft">Phone line costs are added when numbers are billed.</p>
          </TabPanel></>}
      </Tabs>
    </>
  )
}

function Chart({ title, data, keys, stacked }: { title: string; data: Record<string, number | string>[]; keys: [string, string][]; stacked?: boolean }) {
  const colors = ['hsl(var(--accent))', '#0ea5e9', '#10b981']
  return (
    <Card className="mt-4 p-5"><div className="font-semibold">{title}</div>
      {data.length === 0 ? <p className="mt-3 text-sm text-soft">No calls in this period.</p> : (
        <div className="mt-3 h-56"><ResponsiveContainer><BarChart data={data}><CartesianGrid vertical={false} strokeOpacity={0.15} /><XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} fontSize={11} /><YAxis fontSize={11} width={36} /><RTooltip />
          {keys.map(([k, name], i) => <Bar key={k} dataKey={k} name={name} fill={colors[i]} stackId={stacked ? 's' : undefined} radius={stacked ? 0 : [4, 4, 0, 0]} />)}</BarChart></ResponsiveContainer></div>)}</Card>
  )
}

/* ---------------- Testing Lab ---------------- */
export function TestingReal() {
  const agents = useData((s) => s.agents)
  const [aid, setAid] = React.useState('')
  const agent = aid || agents[0]?.id || ''
  if (!agents.length) return <><PageHeader title="Testing Lab" subtitle="Try your agent before real callers do." /><Card className="p-6 text-sm text-soft">Create an agent first, then test it here.</Card></>
  return (
    <>
      <PageHeader title="Testing Lab" subtitle="Try your agent before real callers do. Practice is always free." actions={
        <div className="relative"><AgentAvatar id={agent} className="pointer-events-none absolute left-1.5 top-1.5 h-7 w-7" />
          <Select className="h-10 w-auto min-w-[12rem] rounded-full pl-11 pr-9" value={agent} onChange={(e) => setAid(e.target.value)} aria-label="Agent">{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></div>} />
      <Tabs defaultValue="play"><TabsList><Tab value="play">Talk to it</Tab><Tab value="callers">Practice callers</Tab><Tab value="cases">Test cases</Tab><Tab value="ab">A/B test</Tab></TabsList>
        <TabPanel value="play"><VoicePlayground key={agent} agentId={agent} /></TabPanel>
        <TabPanel value="callers"><Callers agent={agent} key={agent} /></TabPanel>
        <TabPanel value="cases"><Cases agent={agent} key={agent} /></TabPanel>
        <TabPanel value="ab"><AbTests agent={agent} key={agent} /></TabPanel>
      </Tabs>
    </>
  )
}

function Callers({ agent }: { agent: string }) {
  const qc = useQueryClient()
  const personas = useQuery({ queryKey: ['lab', 'personas'], queryFn: () => http<S['PersonaOut'][]>('/lab/personas') })
  const sims = useQuery({ queryKey: ['lab', 'sims', agent], queryFn: () => http<S['SimOut'][]>(`/lab/sim?agent_id=${agent}`), refetchInterval: (q) => (q.state.data?.some((s) => s.status === 'running') ? 2000 : false) })
  const [open, setOpen] = React.useState<string | null>(null)
  const run = (persona: string) => http('/lab/sim', { method: 'POST', json: { agent_id: agent, persona } }).then(() => { toast('Practice call started'); qc.invalidateQueries({ queryKey: ['lab', 'sims'] }) }).catch(say)
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
      <div>
        <h3 className="text-[15px] font-semibold">Pick a caller</h3>
        <p className="mb-4 mt-1 text-[13px] text-soft">An AI plays a tricky caller and scores how your agent handled them.</p>
        <div className="grid gap-3 sm:grid-cols-2">{personas.data?.map((p) => (
          <Card key={p.id} className="flex flex-col items-start gap-3 p-4">
            <AgentAvatar id={p.id} className="h-10 w-10" />
            <div className="text-sm font-medium">{p.name}</div>
            <Button size="sm" className="mt-auto rounded-full" onClick={() => run(p.id)}><Play size={13} />Run</Button>
          </Card>))}</div>
      </div>
      <Card className="p-5">
        <h3 className="text-[15px] font-semibold">Results</h3>
        {!sims.data?.length ? <p className="mt-3 text-sm text-soft">Nothing yet. Run a caller to see how it goes.</p> : (
          <div className="mt-3 space-y-2">{sims.data.map((s) => (
            <div key={s.id} className="rounded-xl border p-3"><button className="flex w-full items-center gap-3 text-left" onClick={() => setOpen(open === s.id ? null : s.id)}>
              <span className="flex-1 text-sm font-medium">{s.persona_name}</span>
              {s.status === 'running' ? <Badge>Running…</Badge> : s.status === 'failed' ? <Badge tone="red">Didn't finish</Badge> : <Badge tone={s.passed ? 'green' : 'orange'}>{s.score}/100</Badge>}</button>
              {s.note && <p className="mt-1 text-[13px] text-soft">{s.note}</p>}
              {open === s.id && <div className="mt-2 space-y-1.5 border-t pt-2 text-sm">{s.turns.map((t, i) => <div key={i}><b>{(t as { who: string }).who === 'agent' ? 'Agent' : 'Caller'}:</b> {(t as { text: string }).text}</div>)}</div>}</div>))}</div>)}
      </Card>
    </div>
  )
}

function Cases({ agent }: { agent: string }) {
  const qc = useQueryClient()
  const cases = useQuery({ queryKey: ['lab', 'cases', agent], queryFn: () => http<S['CaseOut'][]>(`/lab/cases?agent_id=${agent}`) })
  const [f, setF] = React.useState({ say: '', expect: '', must_call: '' })
  const [busy, setBusy] = React.useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ['lab', 'cases'] })
  const add = () => http('/lab/cases', { method: 'POST', json: { agent_id: agent, say: f.say, expect: f.expect, must_call: f.must_call || null } }).then(() => { setF({ say: '', expect: '', must_call: '' }); refresh() }).catch(say)
  const runAll = async (force: boolean) => { setBusy(true); try { await http(`/lab/cases/run?agent_id=${agent}&force=${force}`, { method: 'POST' }); refresh() } catch (e) { say(e) } finally { setBusy(false) } }
  const list = cases.data ?? []
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between"><div><h3 className="font-semibold">Test cases</h3><p className="text-[13px] text-soft">“When the caller says X, the agent should do Y.” Results are kept for this version of the agent.</p></div>
        <div className="flex gap-2"><Button disabled={busy || !list.length} onClick={() => runAll(false)}>{busy ? 'Running…' : 'Run new'}</Button><Button variant="primary" disabled={busy || !list.length} onClick={() => runAll(true)}>Run all</Button></div></div>
      <div className="space-y-2">{list.map((c) => (
        <div key={c.id} className="flex items-start gap-3 rounded-xl border p-3.5 text-sm"><span className="mt-0.5 shrink-0">{c.passed === null ? <Circle size={17} className="text-soft" /> : c.passed ? <CheckCircle2 size={17} className="text-ok" /> : <AlertCircle size={17} className="text-bad" />}</span>
          <div className="flex-1"><div><b>When:</b> {c.say}</div><div><b>Should:</b> {c.expect}{c.must_call ? ` (using “${c.must_call}”)` : ''}</div>{c.note && <div className="text-[13px] text-soft">{c.note}</div>}</div>
          <Button size="sm" variant="ghost" className="text-bad" onClick={() => http(`/lab/cases/${c.id}`, { method: 'DELETE' }).then(refresh).catch(say)}><Trash2 size={14} /></Button></div>))}</div>
      <div className="mt-4 grid gap-2 border-t pt-4 md:grid-cols-[1fr_1fr_160px_auto]"><Input placeholder="When the caller says…" value={f.say} onChange={(e) => setF({ ...f, say: e.target.value })} /><Input placeholder="The agent should…" value={f.expect} onChange={(e) => setF({ ...f, expect: e.target.value })} />
        <Input placeholder="Tool it must use" value={f.must_call} onChange={(e) => setF({ ...f, must_call: e.target.value })} /><Button onClick={add} disabled={!f.say || !f.expect}><Plus size={14} />Add</Button></div>
    </Card>
  )
}

function AbTests({ agent }: { agent: string }) {
  const qc = useQueryClient()
  const tests = useQuery({ queryKey: ['lab', 'ab', agent], queryFn: () => http<S['AbOut'][]>(`/lab/ab?agent_id=${agent}`), refetchInterval: (q) => (q.state.data?.some((t) => t.status === 'running') ? 3000 : false) })
  const [name, setName] = React.useState(''); const [b, setB] = React.useState(''); const [runs, setRuns] = React.useState('20')
  const start = () => http('/lab/ab', { method: 'POST', json: { agent_id: agent, name, prompt_b: b, runs: Number(runs) } }).then(() => { setName(''); setB(''); qc.invalidateQueries({ queryKey: ['lab', 'ab'] }) }).catch(say)
  const verdict = (r: S['AbOut']['result']) => !r ? null : r.winner ? `Version ${r.winner} is better (this is very unlikely to be luck).` : r.reason === 'not_enough_data' ? `Not enough data yet. We need at least ${r.needed} practice calls per version before calling a winner.` : 'No clear winner: the two versions did about the same.'
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="p-5"><h3 className="font-semibold">Compare two sets of instructions</h3><p className="mb-3 text-[13px] text-soft">Version A is your agent's current instructions. Write version B and we'll run practice callers against both.</p>
        <div className="space-y-3"><Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Shorter greeting" /></Field>
          <Field label="Version B instructions"><Textarea className="min-h-[140px]" value={b} onChange={(e) => setB(e.target.value)} /></Field>
          <Field label="Practice calls per version (2 to 40)"><Input type="number" min={2} max={40} value={runs} onChange={(e) => setRuns(e.target.value)} /></Field>
          <Button variant="primary" className="w-full" disabled={!name || !b} onClick={start}>Start test</Button></div></Card>
      <Card className="p-5"><h3 className="font-semibold">Your tests</h3>
        {!tests.data?.length ? <p className="mt-3 text-sm text-soft">No tests yet.</p> : <div className="mt-3 space-y-3">{tests.data.map((t) => (
          <div key={t.id} className="rounded-lg border p-3 text-sm"><div className="flex items-center justify-between"><b>{t.name}</b>{t.status === 'running' ? <Badge>Running…</Badge> : <Badge tone="green">Done</Badge>}</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-center">{(['A', 'B'] as const).map((v) => <div key={v} className="rounded-md bg-muted p-2"><div className="text-xs text-soft">Version {v}</div><div className="num font-semibold">{v === 'A' ? t.pass_a : t.pass_b} / {v === 'A' ? t.done_a : t.done_b} went well</div></div>)}</div>
            <p className="mt-2 text-[13px] text-soft">{t.status === 'running' ? `${t.done_a + t.done_b} of ${t.runs_per_variant * 2} practice calls done` : verdict(t.result)}</p></div>))}</div>}</Card>
    </div>
  )
}
