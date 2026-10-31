/** Real Home, Knowledge, Tools and Campaigns. Demo versions stay in their own files for mock mode. */
import * as React from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AlertTriangle, Check, Circle, FileText, Globe, Megaphone, MessageSquare, Mic, Plus, Trash2, Type, Plug } from 'lucide-react'
import { toast } from 'sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Area, AreaChart, ResponsiveContainer, Tooltip as RTooltip, XAxis } from 'recharts'
import { Badge, Button, Card, Dialog, Field, Input, Select, Tab, TabPanel, Tabs, TabsList, Textarea } from '@/components/ui'
import { EmptyState, PageHeader, StatusBadge, TableSkeleton } from '@/components/shared'
import { http } from '@/lib/api/http'
import { API_URL } from '@/lib/api/env'
import { useData } from '@/store/data'
import { useUI } from '@/store/ui'
import { useMe } from '@/lib/useMe'
import { money } from '@/lib/utils'
import type { components } from '@/lib/api/schema'

const say = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
type S = components['schemas']

/* ---------------- Home ---------------- */
export function HomeReal() {
  const mode = useUI((s) => s.mode)
  const set = useUI((s) => s.set)
  const agents = useData((s) => s.agents)
  const me = useMe().data
  const { data: h, isPending } = useQuery({ queryKey: ['home', mode], queryFn: () => http<S['HomeOut']>('/home/summary?range=7d') })
  const today = useQuery({ queryKey: ['home', mode, 'today'], queryFn: () => http<S['HomeOut']>('/home/summary?range=today') })
  const first = me?.user.name?.split(' ')[0]
  const steps = h?.onboarding ?? []
  const doneCount = steps.filter((s) => s.done).length
  const agentsLoaded = useData((s) => s.agentsLoaded)
  // Brand-new workspace with no agents: start with the guided setup (once per visit unless skipped).
  if (agentsLoaded && agents.length === 0 && !sessionStorage.getItem('skip-welcome')) return <Navigate to="/welcome" replace />
  return (
    <>
      <PageHeader title={doneCount < steps.length && h && h.kpis.calls === 0 ? `Welcome${first ? `, ${first}` : ''} 👋` : `Hello${first ? `, ${first}` : ''}`} subtitle="Here’s how your agents are doing." />
      <Card className="mb-6 flex flex-wrap items-center justify-between gap-4 bg-gradient-to-br from-accent to-[#2f9e83] p-8 text-white">
        <div><h2 className="text-2xl font-semibold">Talk to your agent now</h2><p className="mt-1 text-white/80">Have a free practice call, right here in your browser.</p></div>
        {agents[0] ? <Button size="lg" className="h-14 bg-white px-8 text-base text-accent hover:bg-white/90" onClick={() => set({ playground: agents[0].id })}><Mic size={20} />Start talking</Button>
          : <Link to="/agents/new"><Button size="lg" className="h-14 bg-white px-8 text-base text-accent hover:bg-white/90">Create your first agent</Button></Link>}
      </Card>
      {steps.length > 0 && doneCount < steps.length && (
        <Card className="mb-6 p-6"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Getting started</h3><span className="text-sm text-soft">{doneCount} of {steps.length} done</span></div>
          <ul className="space-y-2">{steps.map((s) => <li key={s.id} className="flex items-center gap-3 text-sm">{s.done ? <Check size={18} className="text-ok" /> : <Circle size={18} className="text-soft" />}<span className={s.done ? 'text-soft line-through' : 'font-medium'}>{s.label}</span></li>)}</ul></Card>)}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[['Calls today', today.data?.kpis.calls], ['Success rate', today.data?.kpis.success_rate == null ? '—' : `${today.data.kpis.success_rate}%`], ['Minutes today', today.data?.kpis.minutes], ['Spend today', today.data ? (mode === 'test' ? 'Free' : money(today.data.kpis.spend)) : undefined]].map(([l, v]) => (
          <Card key={String(l)} className="p-5"><div className="text-sm text-soft">{l}</div><div className="num mt-1 text-2xl font-semibold">{v ?? '…'}</div></Card>))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card className="p-6"><h3 className="font-semibold">Calls, last 7 days</h3>
          <div className="mt-4 h-56">{isPending ? <TableSkeleton rows={3} /> : h && h.days.length ? (
            <ResponsiveContainer><AreaChart data={h.days}><XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} fontSize={11} /><RTooltip /><Area dataKey="calls" name="Calls" stroke="currentColor" className="text-accent" fill="currentColor" fillOpacity={0.15} /></AreaChart></ResponsiveContainer>
          ) : <p className="text-sm text-soft">No calls yet. They’ll show up here.</p>}</div></Card>
        <Card className="p-6"><h3 className="font-semibold">Needs attention</h3>
          {h && h.attention.length === 0 ? <p className="mt-3 text-sm text-ok">✓ All good. Nothing needs your attention.</p> :
            <ul className="mt-3 space-y-2">{h?.attention.map((a) => <li key={a.kind}><Link to={a.link} className="flex items-start gap-2 rounded-lg bg-warn/10 p-3 text-sm text-warn"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{a.text}</Link></li>)}</ul>}</Card>
      </div>
    </>
  )
}

/* ---------------- Knowledge ---------------- */
const KIND = { PDF: FileText, Website: Globe, Text: Type, 'Q&A': MessageSquare } as const

export function KnowledgeReal() {
  const qc = useQueryClient()
  const { data, isPending } = useQuery({ queryKey: ['knowledge'], queryFn: () => http<S['DocOut'][]>('/knowledge'), refetchInterval: (q) => (q.state.data?.some((d) => d.status === 'learning') ? 4000 : false) })
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState('')
  const [ans, setAns] = React.useState<S['AnswerOut'] | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['knowledge'] })
  const ask = async (e: React.FormEvent) => { e.preventDefault(); setAns(null); try { setAns(await http<S['AnswerOut']>('/knowledge/ask', { method: 'POST', json: { question: q } })) } catch (x) { say(x) } }
  const del = async (id: string) => { if (window.confirm('Remove this from your agents’ knowledge?')) try { await http(`/knowledge/${id}`, { method: 'DELETE' }); refresh() } catch (x) { say(x) } }
  return (
    <>
      <PageHeader title="Knowledge" subtitle="Everything your agents know about your business." actions={<Button variant="primary" onClick={() => setOpen(true)}><Plus size={16} />Add knowledge</Button>} />
      <Card className="mb-6 p-6"><h3 className="font-semibold">Test a question</h3>
        <form className="mt-3 flex gap-2" onSubmit={ask}><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. How much is a cleaning?" aria-label="Question" /><Button variant="primary" disabled={!q.trim()}>Ask</Button></form>
        {ans && (ans.found ? <div className="mt-4 rounded-lg bg-accent-soft p-4"><p>{ans.answer}</p><p className="mt-2 text-xs text-soft">Source: {ans.source}</p></div> : <p className="mt-4 text-sm text-warn">Your agents don’t know the answer to that yet. Add it below.</p>)}</Card>
      {isPending ? <TableSkeleton rows={3} /> : !data?.length ? <EmptyState emoji="📚" title="Nothing here yet" text="Add your website, a PDF or a few answers so your agent can answer questions." action={<Button variant="primary" size="lg" onClick={() => setOpen(true)}>Add knowledge</Button>} /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{data.map((k) => { const I = KIND[k.kind as keyof typeof KIND] ?? FileText; return (
          <Card key={k.id} className="p-5"><div className="flex items-start justify-between"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent"><I size={18} /></div><StatusBadge status={k.status as never} /></div>
            <div className="mt-3 truncate font-medium" title={k.title}>{k.title}</div><div className="text-xs text-soft">{k.kind}{k.problem ? ` · ${k.problem}` : ''}</div>
            <Button size="sm" variant="ghost" className="mt-3 -ml-2 text-bad" onClick={() => del(k.id)}><Trash2 size={13} />Remove</Button></Card>) })}</div>)}
      <div className="mt-6 flex items-center gap-2 text-xs text-soft"><Badge tone="accent">Coming soon</Badge>“Questions your callers asked that you have no answer for” will appear here.</div>
      <AddKnowledge open={open} onClose={() => setOpen(false)} onAdded={refresh} />
    </>
  )
}

function AddKnowledge({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [url, setUrl] = React.useState(''); const [title, setTitle] = React.useState(''); const [text, setText] = React.useState('')
  const [q, setQ] = React.useState(''); const [a, setA] = React.useState(''); const [file, setFile] = React.useState<File | null>(null); const [busy, setBusy] = React.useState(false)
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); toast.success('Added! Your agent is learning it now.'); onAdded(); onClose(); setUrl(''); setTitle(''); setText(''); setQ(''); setA(''); setFile(null) } catch (e) { say(e) } finally { setBusy(false) } }
  const upload = async () => {
    if (!file) return
    const t = await http<{ upload_urls: string[]; ticket: string }>('/knowledge/file', { method: 'POST', json: { filename: file.name, mime_type: file.type || 'application/pdf' } })
    for (const u of t.upload_urls) { const r = await fetch(u, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/pdf' } }); if (!r.ok) throw new Error('The upload didn’t go through. Please try again.') }
    await http('/knowledge/file/process', { method: 'POST', json: { ticket: t.ticket } })
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Add knowledge">
      <Tabs defaultValue="web"><TabsList><Tab value="web">Website</Tab><Tab value="pdf">PDF</Tab><Tab value="text">Text</Tab><Tab value="qa">Q&A</Tab></TabsList>
        <TabPanel value="web"><Input placeholder="https://yourbusiness.com" value={url} onChange={(e) => setUrl(e.target.value)} /><Button variant="primary" className="mt-4 w-full" disabled={busy || !url} onClick={() => run(() => http('/knowledge/url', { method: 'POST', json: { url } }))}>Add</Button></TabPanel>
        <TabPanel value="pdf"><input type="file" accept="application/pdf,.pdf,.txt,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="w-full rounded-xl border border-dashed p-6 text-sm" /><Button variant="primary" className="mt-4 w-full" disabled={busy || !file} onClick={() => run(upload)}>Add</Button></TabPanel>
        <TabPanel value="text"><Input placeholder="Name, e.g. Opening hours" value={title} onChange={(e) => setTitle(e.target.value)} className="mb-2" /><Textarea placeholder="Paste anything your agent should know…" value={text} onChange={(e) => setText(e.target.value)} /><Button variant="primary" className="mt-4 w-full" disabled={busy || !title || !text} onClick={() => run(() => http('/knowledge/text', { method: 'POST', json: { title, text } }))}>Add</Button></TabPanel>
        <TabPanel value="qa"><Input placeholder="Name, e.g. Refund policy" value={title} onChange={(e) => setTitle(e.target.value)} className="mb-2" /><Input placeholder="Question" value={q} onChange={(e) => setQ(e.target.value)} className="mb-2" /><Textarea placeholder="Answer" value={a} onChange={(e) => setA(e.target.value)} /><Button variant="primary" className="mt-4 w-full" disabled={busy || !title || !q || !a} onClick={() => run(() => http('/knowledge/qa', { method: 'POST', json: { title, pairs: [{ q, a }] } }))}>Add</Button></TabPanel>
      </Tabs>
    </Dialog>
  )
}

/* ---------------- Tools ---------------- */
export function ToolsReal() {
  const qc = useQueryClient()
  const cat = useQuery({ queryKey: ['tools', 'catalog'], queryFn: () => http<S['CatalogItem'][]>('/tools/catalog') })
  const tools = useQuery({ queryKey: ['tools'], queryFn: () => http<S['ToolOut'][]>('/tools') })
  const [open, setOpen] = React.useState(false)
  const [f, setF] = React.useState({ name: '', description: '', url: '', method: 'POST', auth: '', params: '' })
  const [res, setRes] = React.useState<string | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['tools'] })
  const params = f.params.split(',').map((p) => p.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_')).filter(Boolean).map((name) => ({ name, type: 'string', description: `The ${name.replace(/_/g, ' ')}`, required: true }))
  const headers = f.auth.trim() ? { Authorization: f.auth.trim() } : {}
  const save = async () => { try { await http('/tools', { method: 'POST', json: { name: f.name, description: f.description, url: f.url, method: f.method, headers, parameters: params } }); toast.success('Tool saved!'); setOpen(false); setF({ name: '', description: '', url: '', method: 'POST', auth: '', params: '' }); refresh() } catch (e) { say(e) } }
  const test = async () => { try { const r = await http<{ ok: boolean; status: number; ms: number; response: string }>('/tools/test', { method: 'POST', json: { url: f.url, method: f.method, headers, sample: Object.fromEntries(params.map((p) => [p.name, 'test'])) } }); setRes(`${r.ok ? '✓' : '✗'} ${r.status} in ${r.ms} ms. ${r.response.slice(0, 200)}`) } catch (e) { setRes(e instanceof Error ? e.message : 'Test failed') } }
  return (
    <>
      <PageHeader title="Tools & Integrations" subtitle="Connect the apps your agent should work with." actions={<Button variant="primary" onClick={() => setOpen(true)}><Plus size={16} />Make a tool</Button>} />
      <h2 className="mb-3 font-semibold">Ready-made</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{(cat.data ?? []).map((i) => (
        <Card key={i.id} className="p-5"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent"><Plug size={18} /></div><div className="mt-3 font-medium">{i.name}</div><div className="text-[13px] text-soft">{i.blurb}</div>
          <div className="mt-3">{i.status === 'available' ? <Button size="sm" onClick={() => setOpen(true)}>Set up</Button> : <Badge tone="accent">Coming soon</Badge>}</div></Card>))}</div>
      <h2 className="mb-3 mt-8 font-semibold">Your tools</h2>
      {tools.data && tools.data.length === 0 ? <p className="text-sm text-soft">You haven’t made any tools yet.</p> : (
        <div className="space-y-2">{tools.data?.map((t) => <Card key={t.id} className="flex items-center gap-3 p-4"><div className="flex-1"><div className="font-medium">{t.name}</div><div className="text-[13px] text-soft">{t.description}</div><div className="mt-1 truncate text-xs text-soft">{t.method} {t.url}</div></div>
          <Button size="sm" variant="ghost" className="text-bad" onClick={async () => { if (window.confirm(`Delete “${t.name}”?`)) try { await http(`/tools/${t.id}`, { method: 'DELETE' }); refresh() } catch (e) { say(e) } }}><Trash2 size={14} /></Button></Card>)}</div>)}
      <Dialog open={open} onOpenChange={setOpen} title="Make a tool" description="Your agent can call any web address (like a Zapier or n8n webhook) during a call.">
        <div className="space-y-3">
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Notify the team" /></Field>
          <Field label="What does it do, and when should the agent use it?"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Use this when a caller books an appointment, to tell the team." /></Field>
          <Field label="What information does it need? (comma separated)"><Input value={f.params} onChange={(e) => setF({ ...f, params: e.target.value })} placeholder="caller name, phone number, time" /></Field>
          <div className="grid grid-cols-[110px_1fr] gap-2"><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{['POST', 'GET', 'PUT', 'PATCH'].map((m) => <option key={m}>{m}</option>)}</Select><Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://hooks.zapier.com/…" /></div>
          <Field label="Secret key (optional)"><Input type="password" value={f.auth} onChange={(e) => setF({ ...f, auth: e.target.value })} placeholder="Bearer …  (hidden after saving)" /></Field>
          {res && <p className="rounded-lg bg-muted p-3 text-xs">{res}</p>}
          <div className="flex gap-2"><Button onClick={test} disabled={!f.url}>Test this tool</Button><Button variant="primary" className="flex-1" onClick={save} disabled={!f.name || !f.description || !f.url}>Save</Button></div>
        </div>
      </Dialog>
    </>
  )
}

/* ---------------- Campaigns ---------------- */
export function CampaignsReal() {
  const mode = useUI((s) => s.mode)
  const qc = useQueryClient()
  const agents = useData((s) => s.agents).filter((a) => a.status === 'live')
  const { data, isPending } = useQuery({ queryKey: ['campaigns', mode], queryFn: () => http<S['CampaignOut'][]>('/campaigns'), refetchInterval: 5000 })
  const [open, setOpen] = React.useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ['campaigns'] })
  const act = async (id: string, a: 'start' | 'pause' | 'resume') => { try { await http(`/campaigns/${id}/${a}`, { method: 'POST' }); refresh() } catch (e) { say(e) } }
  return (
    <>
      <PageHeader title="Campaigns" subtitle="Call a list of people with one of your live agents." actions={<Button variant="primary" onClick={() => setOpen(true)} disabled={mode === 'test'} title={mode === 'test' ? 'Campaigns call real people: switch to Live' : undefined}><Plus size={16} />New campaign</Button>} />
      {mode === 'test' && <Card className="mb-4 border-warn/40 bg-warn/10 p-4 text-sm text-warn">Campaigns call real people, so they only run in Live mode.</Card>}
      {isPending ? <TableSkeleton rows={3} /> : !data?.length ? <EmptyState emoji="📣" title="No campaigns yet" text="Upload a list of phone numbers and let your agent call them." /> : (
        <div className="space-y-3">{data.map((c) => { const pct = c.total ? Math.round((100 * c.dialed) / c.total) : 0; return (
          <Card key={c.id} className="p-5"><div className="flex flex-wrap items-center gap-3"><Megaphone size={18} className="text-accent" /><div className="flex-1"><div className="font-medium">{c.name}</div><div className="text-xs text-soft">{agents.find((a) => a.id === c.agent_id)?.name ?? 'Agent'}</div></div>
            <StatusBadge status={c.status as never} />
            {c.status === 'scheduled' && <Button size="sm" variant="primary" onClick={() => act(c.id, 'start')}>Start</Button>}
            {c.status === 'running' && <Button size="sm" onClick={() => act(c.id, 'pause')}>Pause</Button>}
            {c.status === 'paused' && <Button size="sm" variant="primary" onClick={() => act(c.id, 'resume')}>Resume</Button>}</div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm sm:grid-cols-6">{[['Contacts', c.total], ['Dialed', c.dialed], ['Answered', c.answered], ['Voicemail', c.voicemail], ['No answer', c.no_answer], ['Converted', c.converted]].map(([l, v]) => <div key={String(l)}><div className="num text-lg font-semibold">{v}</div><div className="text-xs text-soft">{l}</div></div>)}</div></Card>) })}</div>)}
      <NewCampaign open={open} onClose={() => setOpen(false)} agents={agents} onCreated={refresh} />
    </>
  )
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
function NewCampaign({ open, onClose, agents, onCreated }: { open: boolean; onClose: () => void; agents: { id: string; name: string }[]; onCreated: () => void }) {
  const [name, setName] = React.useState(''); const [agent, setAgent] = React.useState(''); const [csv, setCsv] = React.useState('')
  const [check, setCheck] = React.useState<S['ContactsOut'] | null>(null); const [days, setDays] = React.useState([true, true, true, true, true, false, false])
  const [start, setStart] = React.useState('10:00'); const [end, setEnd] = React.useState('18:00'); const [tz, setTz] = React.useState('Asia/Kolkata')
  const [consent, setConsent] = React.useState(false); const [dnc, setDnc] = React.useState(false); const [busy, setBusy] = React.useState(false)
  const pick = async (f: File | null) => {
    if (!f) return
    const text = await f.text(); setCsv(text); setCheck(null)
    try { setCheck(await http<S['ContactsOut']>('/campaigns/contacts/check', { method: 'POST', json: { csv_text: text } })) } catch (e) { say(e) }
  }
  const ready = !!(name && (agent || agents[0]) && check && check.valid > 0 && consent && dnc && days.some(Boolean))
  const create = async () => {
    setBusy(true)
    try {
      await http('/campaigns', { method: 'POST', json: { name, agent_id: agent || agents[0].id, csv_text: csv, timezone: tz, slots: days.flatMap((on, i) => (on ? [{ day_of_week: i, start_time: start, end_time: end }] : [])), consent_confirmed: consent, dnc_checked: dnc } })
      toast.success('Campaign created. Press Start when you’re ready.'); onCreated(); onClose()
    } catch (e) { say(e) } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} wide title="New campaign" description="Upload your contacts, choose when to call, and confirm you’re allowed to.">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Campaign name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Agent"><Select value={agent || agents[0]?.id || ''} onChange={(e) => setAgent(e.target.value)}>{agents.length === 0 && <option value="">No live agents yet</option>}{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field></div>
        <Field label="Contacts (CSV with a phone column)"><input type="file" accept=".csv,text/csv" onChange={(e) => pick(e.target.files?.[0] ?? null)} className="w-full rounded-xl border border-dashed p-4 text-sm" /></Field>
        {check && <div className="rounded-lg bg-muted p-3 text-sm"><b>{check.valid}</b> numbers ready · {check.duplicates} duplicates removed · <span className={check.invalid.length ? 'text-warn' : ''}>{check.invalid.length} can’t be used</span>
          {check.invalid.slice(0, 3).map((r) => <div key={r.row as number} className="text-xs text-soft">Row {String(r.row)}: {String(r.reason)}</div>)}</div>}
        <div><div className="mb-2 text-[13px] font-medium">When to call (contacts’ local time, between 09:00 and 21:00)</div>
          <div className="flex flex-wrap gap-2">{DAYS.map((d, i) => <button key={d} type="button" aria-pressed={days[i]} onClick={() => setDays(days.map((x, j) => (j === i ? !x : x)))} className={`rounded-md border px-2.5 py-1 text-sm ${days[i] ? 'border-accent bg-accent-soft text-accent' : 'text-soft'}`}>{d}</button>)}</div>
          <div className="mt-2 grid grid-cols-3 gap-2"><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="From" /><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Until" />
            <Select value={tz} onChange={(e) => setTz(e.target.value)}>{['Asia/Kolkata', 'UTC', 'Europe/London', 'America/New_York', 'Asia/Dubai', 'Asia/Singapore'].map((z) => <option key={z}>{z}</option>)}</Select></div></div>
        <div className="space-y-2 rounded-lg border p-3 text-sm">
          <label className="flex items-start gap-2"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />I confirm the people on this list agreed to be called.</label>
          <label className="flex items-start gap-2"><input type="checkbox" checked={dnc} onChange={(e) => setDnc(e.target.checked)} className="mt-1" />I’ve checked this list against the Do-Not-Call register. <span className="text-xs text-soft">(We keep a record of this.)</span></label></div>
        <Button variant="primary" className="w-full" disabled={!ready || busy} onClick={create}>{busy ? 'Creating…' : 'Create campaign'}</Button>
      </div>
    </Dialog>
  )
}
void API_URL
