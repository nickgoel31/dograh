/** Real Home, Knowledge, Tools and Campaigns. Demo versions stay in their own files for mock mode. */
import * as React from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AlertTriangle, Check, Circle, FileText, Globe, Megaphone, MessageSquare, Mic, Plus, Trash2, Type, Plug } from '@/components/icons'
import { toast } from 'sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Area, AreaChart, ResponsiveContainer, Tooltip as RTooltip, XAxis } from 'recharts'
import { Badge, Button, Card, Dialog, Field, Input, Select, Tab, TabPanel, Tabs, TabsList, Textarea } from '@/components/ui'
import { EmptyState, PageHeader, StatusBadge, TableSkeleton } from '@/components/shared'
import { http } from '@/lib/api/http'
import { API_URL } from '@/lib/api/env'
import { CalendarCard } from '@/pages/CalendarCard'
import { ConnectorGrid } from '@/components/ConnectorCards'
import { useData } from '@/store/data'
import { useUI } from '@/store/ui'
import { cn } from '@/lib/utils'
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
      <PageHeader title={doneCount < steps.length && h && h.kpis.calls === 0 ? `Welcome${first ? `, ${first}` : ''}` : `Hello${first ? `, ${first}` : ''}`} subtitle="Here’s how your agents are doing." />
      <Card className="mb-6 flex flex-wrap items-center justify-between gap-4 relative overflow-hidden border-white/10 bg-[linear-gradient(135deg,#06352e_0%,#0b5c4c_55%,#16866c_100%)] p-8 text-white shadow-raised before:pointer-events-none before:absolute before:-right-20 before:-top-24 before:h-72 before:w-72 before:rounded-full before:bg-white/10 before:blur-3xl">
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
  const gaps = useQuery({ queryKey: ['knowledge', 'gaps'], queryFn: () => http<{ question: string; count: number }[]>('/knowledge/gaps') })
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
      <Card className="mt-6 p-6"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">Questions your agents couldn't answer</h3><p className="text-[13px] text-soft">From calls in the last 30 days. Add an answer so it never happens again.</p></div><Button size="sm" onClick={() => setOpen(true)}>Add an answer</Button></div>
        {gaps.data && gaps.data.length > 0 ? <ul className="mt-4 divide-y">{gaps.data.map((g) => <li key={g.question} className="flex items-center justify-between gap-3 py-2.5 text-sm"><span>{g.question}</span><Badge tone={g.count > 2 ? 'orange' : 'gray'}>{g.count} {g.count === 1 ? 'time' : 'times'}</Badge></li>)}</ul> : <p className="mt-4 text-sm text-soft">{gaps.isPending ? 'Looking…' : 'Nothing yet. When a caller asks something your agent can’t answer, it shows up here.'}</p>}</Card>
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
  const tools = useQuery({ queryKey: ['tools'], queryFn: () => http<S['ToolOut'][]>('/tools') })
  const [open, setOpen] = React.useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ['tools'] })
  return (
    <>
      <PageHeader title="Tools & Integrations" subtitle="Connect the apps your agent should work with." actions={<Button variant="primary" onClick={() => setOpen(true)}><Plus size={16} />Make a tool</Button>} />
      <CalendarCard />
      <h2 className="mb-3 font-semibold">Connect your apps</h2>
      <ConnectorGrid />
      <h2 className="mb-3 mt-8 font-semibold">Your tools</h2>
      {tools.data && tools.data.length === 0 ? <p className="text-sm text-soft">You haven’t made any tools yet.</p> : (
        <div className="space-y-2">{tools.data?.map((t) => <Card key={t.id} className="flex items-center gap-3 p-4"><div className="flex-1"><div className="font-medium">{t.name}</div><div className="text-[13px] text-soft">{t.description}</div><div className="mt-1 truncate text-xs text-soft">{t.method} {t.url}</div></div>
          <Button size="sm" variant="ghost" className="text-bad" onClick={async () => { if (window.confirm(`Delete “${t.name}”?`)) try { await http(`/tools/${t.id}`, { method: 'DELETE' }); refresh() } catch (e) { say(e) } }}><Trash2 size={14} /></Button></Card>)}</div>)}
      <MakeToolDialog open={open} onClose={() => setOpen(false)} onSaved={refresh} />
    </>
  )
}

/* ---------------- Make a tool ---------------- */
type ToolParam = { name: string; type: 'string' | 'number' | 'boolean'; description: string; required: boolean; sample: string }
const EMPTY_TOOL = { name: '', description: '', url: '', method: 'POST', auth: '' }
const snake = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[0-9]+/, '').slice(0, 40)
const sampleFor = (p: ToolParam) => (p.sample.trim() || (p.type === 'number' ? '1' : p.type === 'boolean' ? 'true' : 'test'))
const typed = (p: ToolParam) => { const v = sampleFor(p); return p.type === 'number' ? (Number.isFinite(Number(v)) ? Number(v) : 0) : p.type === 'boolean' ? v === 'true' : v }

function MakeToolDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = React.useState(EMPTY_TOOL)
  const [params, setParams] = React.useState<ToolParam[]>([])
  const [hdrs, setHdrs] = React.useState<{ k: string; v: string }[]>([])
  const [res, setRes] = React.useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = React.useState<'save' | 'test' | null>(null)
  const urlOk = /^https?:\/\/[^\s/]+\.[^\s/]+/i.test(f.url.trim()) || /^https?:\/\/localhost/i.test(f.url.trim())
  const urlProblem = f.url.trim() && !urlOk ? 'Enter the full web address, starting with https://' : ''
  const clean = params.filter((x) => snake(x.name)).map((x) => ({ ...x, name: snake(x.name) }))
  const dup = new Set(clean.map((x) => x.name)).size !== clean.length
  const headers: Record<string, string> = {}
  if (f.auth.trim()) headers.Authorization = /\s/.test(f.auth.trim()) ? f.auth.trim() : `Bearer ${f.auth.trim()}`
  for (const h of hdrs) if (h.k.trim() && h.v.trim()) headers[h.k.trim()] = h.v.trim()
  const sample = Object.fromEntries(clean.map((x) => [x.name, typed(x)]))
  const query = f.method === 'GET' || f.method === 'DELETE'
  const preview = clean.length === 0 ? 'Nothing is sent with the request.' : query ? `?${clean.map((x) => `${x.name}=${sampleFor(x)}`).join('&')}` : JSON.stringify(sample, null, 2)
  const reset = () => { setF(EMPTY_TOOL); setParams([]); setHdrs([]); setRes(null) }
  const setP = (i: number, patch: Partial<ToolParam>) => setParams((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const save = async () => {
    setBusy('save')
    try {
      await http('/tools', { method: 'POST', json: { name: f.name.trim(), description: f.description.trim(), url: f.url.trim(), method: f.method, headers, parameters: clean.map(({ sample: _s, ...x }) => ({ ...x, description: x.description.trim() || `The ${x.name.replace(/_/g, ' ')}` })) } })
      toast.success('Tool saved!'); reset(); onSaved(); onClose()
    } catch (e) { say(e) } finally { setBusy(null) }
  }
  const test = async () => {
    setBusy('test'); setRes(null)
    try {
      const r = await http<{ ok: boolean; status: number; ms: number; response: string }>('/tools/test', { method: 'POST', json: { url: f.url.trim(), method: f.method, headers, sample }, timeoutMs: 30000 })
      setRes({ ok: r.ok, text: `${r.ok ? 'Worked' : 'The address answered with an error'}: ${r.status} in ${r.ms} ms.${r.response ? `\n${r.response.slice(0, 600)}` : ''}` })
    } catch (e) { setRes({ ok: false, text: e instanceof Error ? e.message : 'The test failed.' }) } finally { setBusy(null) }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }} title="Make a tool" description="Your agent can call any web address (like a Zapier or n8n webhook) during a call.">
      <form className="space-y-4" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
        <Field label="Name"><Input name="tool-name" autoComplete="off" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Notify the team" /></Field>
        <Field label="What does it do, and when should the agent use it?"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Use this when a caller books an appointment, to tell the team." /></Field>
        <div>
          <div className="mb-1.5 text-[13px] font-medium">Where should it send the information?</div>
          <div className="grid grid-cols-[110px_1fr] gap-2">
            <Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} aria-label="Method">{['POST', 'GET', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}</Select>
            <Input name="tool-url" type="url" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false} value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://hooks.zapier.com/…" aria-label="Web address" />
          </div>
          {urlProblem && <p className="mt-1 text-xs text-bad">{urlProblem}</p>}
        </div>
        <div>
          <div className="mb-1 text-[13px] font-medium">What information does it need?</div>
          <p className="mb-2 text-xs text-soft">The agent asks the caller for these and sends them. {query ? 'They go in the web address.' : 'They are sent as JSON.'}</p>
          <div className="space-y-2">
            {params.map((x, i) => (
              <div key={i} className="rounded-xl border p-3">
                <div className="grid grid-cols-[1fr_110px] gap-2">
                  <Input autoComplete="off" value={x.name} onChange={(e) => setP(i, { name: e.target.value })} placeholder="caller name" aria-label="Field name" />
                  <Select value={x.type} onChange={(e) => setP(i, { type: e.target.value as ToolParam['type'] })} aria-label="Type"><option value="string">Text</option><option value="number">Number</option><option value="boolean">Yes / no</option></Select>
                </div>
                <Input className="mt-2" autoComplete="off" value={x.description} onChange={(e) => setP(i, { description: e.target.value })} placeholder="What the agent should put here, e.g. the caller's full name" aria-label="Description" />
                <div className="mt-2 flex items-center gap-2">
                  <Input autoComplete="off" value={x.sample} onChange={(e) => setP(i, { sample: e.target.value })} placeholder="Example value for testing" aria-label="Test value" />
                  <label className="flex shrink-0 items-center gap-1.5 text-xs text-soft"><input type="checkbox" checked={x.required} onChange={(e) => setP(i, { required: e.target.checked })} />Required</label>
                  <button type="button" onClick={() => setParams((xs) => xs.filter((_, j) => j !== i))} className="shrink-0 rounded-md p-1.5 text-soft hover:bg-muted hover:text-bad" aria-label="Remove field"><Trash2 size={14} /></button>
                </div>
              </div>))}
          </div>
          <Button type="button" size="sm" className="mt-2" onClick={() => setParams((xs) => [...xs, { name: '', type: 'string', description: '', required: true, sample: '' }])}><Plus size={14} />Add information</Button>
          {dup && <p className="mt-1 text-xs text-bad">Two fields have the same name.</p>}
          <div className="mt-3"><div className="mb-1 text-xs font-medium text-soft">What gets sent ({f.method})</div><pre className="max-h-32 overflow-auto rounded-lg bg-muted p-3 text-xs">{preview}</pre></div>
        </div>
        <Field label="Secret key (optional)"><Input type="password" name="tool-secret" autoComplete="new-password" value={f.auth} onChange={(e) => setF({ ...f, auth: e.target.value })} placeholder="Your key, or Bearer … (hidden after saving)" /></Field>
        <div>
          {hdrs.map((h, i) => (
            <div key={i} className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-2">
              <Input autoComplete="off" value={h.k} onChange={(e) => setHdrs((xs) => xs.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} placeholder="Header name" aria-label="Header name" />
              <Input type="password" autoComplete="new-password" value={h.v} onChange={(e) => setHdrs((xs) => xs.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} placeholder="Value" aria-label="Header value" />
              <button type="button" onClick={() => setHdrs((xs) => xs.filter((_, j) => j !== i))} className="rounded-md p-1.5 text-soft hover:bg-muted hover:text-bad" aria-label="Remove header"><Trash2 size={14} /></button>
            </div>))}
          {hdrs.length < 8 && <Button type="button" size="sm" variant="ghost" className="-ml-2" onClick={() => setHdrs((xs) => [...xs, { k: '', v: '' }])}><Plus size={14} />Add another header</Button>}
        </div>
        {res && <pre className={cn('whitespace-pre-wrap break-words rounded-lg p-3 text-xs', res.ok ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad')}>{res.text}</pre>}
        <div className="flex gap-2">
          <Button type="button" onClick={test} disabled={!urlOk || busy !== null || dup}>{busy === 'test' ? 'Testing…' : 'Test this tool'}</Button>
          <Button type="button" variant="primary" className="flex-1" onClick={save} disabled={!f.name.trim() || !f.description.trim() || !urlOk || dup || busy !== null}>{busy === 'save' ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Dialog>
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
  const [tries, setTries] = React.useState(2); const [wait, setWait] = React.useState(30); const [onBusy, setOnBusy] = React.useState(true); const [onNoAnswer, setOnNoAnswer] = React.useState(true); const [onVoicemail, setOnVoicemail] = React.useState(false)
  const pick = async (f: File | null) => {
    if (!f) return
    const text = await f.text(); setCsv(text); setCheck(null)
    try { setCheck(await http<S['ContactsOut']>('/campaigns/contacts/check', { method: 'POST', json: { csv_text: text } })) } catch (e) { say(e) }
  }
  const ready = !!(name && (agent || agents[0]) && check && check.valid > 0 && consent && dnc && days.some(Boolean))
  const create = async () => {
    setBusy(true)
    try {
      await http('/campaigns', { method: 'POST', json: { name, agent_id: agent || agents[0].id, csv_text: csv, timezone: tz, slots: days.flatMap((on, i) => (on ? [{ day_of_week: i, start_time: start, end_time: end }] : [])), consent_confirmed: consent, dnc_checked: dnc, max_retries: tries, retry_delay_minutes: wait, retry_on_busy: onBusy, retry_on_no_answer: onNoAnswer, retry_on_voicemail: onVoicemail } })
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
        <div className="rounded-lg border p-3 text-sm"><div className="mb-2 text-[13px] font-medium">If a call does not connect</div>
          <div className="grid grid-cols-2 gap-2"><Field label="Try again up to"><Select value={tries} onChange={(e) => setTries(Number(e.target.value))}>{[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n === 0 ? 'Do not retry' : n === 1 ? '1 more time' : `${n} more times`}</option>)}</Select></Field>
            <Field label="Wait between tries"><Select value={wait} disabled={tries === 0} onChange={(e) => setWait(Number(e.target.value))}>{[[5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours']].map(([m, l]) => <option key={m} value={m}>{l}</option>)}</Select></Field></div>
          {tries > 0 && <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
            <label className="flex items-center gap-2"><input type="checkbox" checked={onBusy} onChange={(e) => setOnBusy(e.target.checked)} />Line busy</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={onNoAnswer} onChange={(e) => setOnNoAnswer(e.target.checked)} />No answer</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={onVoicemail} onChange={(e) => setOnVoicemail(e.target.checked)} />Answering machine</label></div>}
          <p className="mt-2 text-xs text-soft">Retries only happen inside your calling hours.</p></div>
        <div className="space-y-2 rounded-lg border p-3 text-sm">
          <label className="flex items-start gap-2"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />I confirm the people on this list agreed to be called.</label>
          <label className="flex items-start gap-2"><input type="checkbox" checked={dnc} onChange={(e) => setDnc(e.target.checked)} className="mt-1" />I’ve checked this list against the Do-Not-Call register. <span className="text-xs text-soft">(We keep a record of this.)</span></label></div>
        <Button variant="primary" className="w-full" disabled={!ready || busy} onClick={create}>{busy ? 'Creating…' : 'Create campaign'}</Button>
      </div>
    </Dialog>
  )
}
void API_URL
