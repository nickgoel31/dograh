import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowUp, Check, ChevronDown, Copy, History, Loader2, MessageCircle, Pause, Play, Plus, RotateCcw, Sparkles, Trash2, Wand2, X } from '@/components/icons'
import { Badge, Button, Card, Chip, Dialog, Field, Input, Slider, Switch, Tab, TabPanel, Tabs, TabsList, Textarea } from '@/components/ui'
import { CodeBlock, ConfirmDialog, PageHeader, UnsavedBar } from '@/components/shared'
import { http } from '@/lib/api/http'
import { CURRENCY } from '@/config/brand'
import { cn } from '@/lib/utils'

/* ---------- types ---------- */
type Opt = { label: string; goto: string }
type Step = { id: string; type: 'message' | 'ask' | 'choice' | 'ai' | 'human' | 'end'; text: string; save_as?: string; kind?: 'text' | 'email' | 'phone'; options?: Opt[]; next?: string }
type Widget = { title: string; greeting: string; color: string; position: 'left' | 'right'; prompts: string[]; collect_lead: boolean; powered_by: boolean; offline_message: string }
type Handover = { keywords: string[]; after_failures: number; message: string }
type Agent = {
  id: string; key: string; use_case: string; status: 'draft' | 'live' | 'paused'; name: string; emoji: string | null; prompt: string; model: string; temperature: number; reply_length: string; tone: string; language: string
  use_knowledge: boolean; memory: number; flow: { steps: Step[] }; handover: Handover; widget: Widget; origins: string[]; version: number; updated: string | null; price: number; chats: number
}
type Model = { id: string; name: string; provider: string; tier: string; tier_label: string; price: number; blurb: string }
type UseCase = { key: string; name: string; emoji: string; blurb: string }
type Meta = { models: Model[]; ai_ready: boolean; use_cases: UseCase[]; tones: string[]; lengths: string[]; languages: string[] }
type Msg = { id: number; role: 'visitor' | 'agent' | 'human'; text: string; options?: string[] }
type Pricing = { models: Model[]; slabs: { from: number; discount: number; label: string }[]; free: string[]; currency: string; per: string }
type Usage = { month_replies: number; month_spend: number; discount: number; next_slab: { at: number; discount: number; to_go: number } | null; prices: Record<string, number>; by_model: Record<string, { replies: number; spend: number }>; balance: number | null }

const say = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
const money = (n: number, d = 2) => `${CURRENCY}${n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })}`
const sel = 'h-10 w-full rounded-xl border border-line bg-surface px-3.5 text-sm'
export const useChatMeta = () => useQuery({ queryKey: ['chat', 'meta'], queryFn: () => http<Meta>('/chat/meta'), staleTime: 300_000 })
const useAgent = (id: string) => useQuery({ queryKey: ['chat', 'agent', id], queryFn: () => http<Agent>(`/chat/agents/${id}`), enabled: !!id })
const origin = () => window.location.origin
const STATUS: Record<string, { tone: 'green' | 'gray' | 'orange'; label: string }> = { live: { tone: 'green', label: 'Live' }, draft: { tone: 'gray', label: 'Draft' }, paused: { tone: 'orange', label: 'Paused' } }

/* ======================================================================== list */
export function ChatAgentsListPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const meta = useChatMeta()
  const list = useQuery({ queryKey: ['chat', 'agents'], queryFn: () => http<Agent[]>('/chat/agents') })
  const [open, setOpen] = React.useState(false)
  const [use, setUse] = React.useState('support')
  const [business, setBusiness] = React.useState('')
  const [desc, setDesc] = React.useState('')
  const make = useMutation({
    mutationFn: () => http<Agent & { written_by_ai: boolean }>('/chat/agents', { method: 'POST', json: { use_case: use, business, description: desc } }),
    onSuccess: (a) => { void qc.invalidateQueries({ queryKey: ['chat'] }); setOpen(false); toast.success(a.written_by_ai ? `${a.name} is ready. I wrote it from your description.` : `${a.name} is ready to customise.`); nav(`/chat/agents/${a.id}`) }, onError: say,
  })
  const rows = list.data ?? []
  return (
    <>
      <PageHeader title="Chat agents" subtitle="One agent for each job: support, sales, bookings. Each has its own instructions, model, flow and website chat." actions={<Button variant="primary" onClick={() => setOpen(true)}><Plus size={15} />New chat agent</Button>} />
      {!list.isPending && !rows.length ? (
        <Card className="mx-auto max-w-2xl p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent"><MessageCircle size={26} /></div>
          <h2 className="mt-4 text-xl font-semibold tracking-tight">Make your first chat agent</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-soft">Pick a job, describe your business in a sentence or two, and it writes the agent for you. Then change anything by just telling it what to change.</p>
          <Button className="mt-5" variant="primary" size="lg" onClick={() => setOpen(true)}><Wand2 size={16} />Create a chat agent</Button>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((a) => (
            <Link key={a.id} to={`/chat/agents/${a.id}`} className="group rounded-2xl border bg-surface p-5 transition hover:-translate-y-0.5 hover:border-soft/40 hover:shadow-[0_10px_30px_-16px_hsl(var(--shadow)/.4)]">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-xl">{a.emoji ?? '💬'}</span>
                <div className="min-w-0 flex-1"><div className="truncate text-[15px] font-semibold">{a.name}</div><div className="truncate text-xs capitalize text-soft">{meta.data?.use_cases.find((u) => u.key === a.use_case)?.name ?? a.use_case}</div></div>
                <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
              </div>
              <p className="mt-3 line-clamp-2 text-[13px] text-soft">{a.prompt}</p>
              <div className="mt-4 flex items-center justify-between text-xs text-soft"><span>{meta.data?.models.find((m) => m.id === a.model)?.name ?? a.model} · {money(a.price)} a reply</span><span>{a.chats} {a.chats === 1 ? 'chat' : 'chats'}</span></div>
            </Link>))}
        </div>)}

      <Dialog open={open} onOpenChange={setOpen} title="New chat agent" description="Pick what it should do. You can change everything afterwards." wide>
        <div className="space-y-5">
          <div className="grid gap-2.5 sm:grid-cols-2">
            {(meta.data?.use_cases ?? []).map((u) => (
              <button key={u.key} onClick={() => setUse(u.key)} className={cn('flex items-start gap-3 rounded-xl border p-3.5 text-left transition', use === u.key ? 'border-accent bg-accent-soft/50 ring-2 ring-accent/20' : 'hover:bg-muted/50')}>
                <span className="text-xl">{u.emoji}</span><span><span className="block text-[13.5px] font-semibold">{u.name}</span><span className="block text-xs text-soft">{u.blurb}</span></span>
              </button>))}
          </div>
          <Field label="Business name"><Input value={business} maxLength={80} onChange={(e) => setBusiness(e.target.value)} placeholder="Sunrise Dental" /></Field>
          <Field label="Tell me about your business (optional)" hint={<span className="text-xs text-soft">A few sentences are enough. The AI writes the instructions, first message and quick questions from it.</span>}>
            <Textarea rows={4} value={desc} maxLength={3000} onChange={(e) => setDesc(e.target.value)} placeholder="We are a dental clinic in Pune, open Mon to Sat 10 to 6. We do check-ups, braces and root canals. Most people ask about prices and appointments." />
          </Field>
          <div className="flex justify-end"><Button variant="primary" disabled={make.isPending} onClick={() => make.mutate()}>{make.isPending ? <><Loader2 size={15} className="animate-spin" />Writing…</> : <><Sparkles size={15} />Create agent</>}</Button></div>
        </div>
      </Dialog>
    </>
  )
}

/* ======================================================================== the test chat */
function TestChat({ agent, dirty }: { agent: Agent; dirty: boolean }) {
  const [token, setToken] = React.useState<string | null>(null)
  const [msgs, setMsgs] = React.useState<Msg[]>([])
  const [text, setText] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const end = React.useRef<HTMLDivElement>(null)
  const call = async (t?: string, fresh?: boolean) => {
    setBusy(true)
    try {
      const r = await http<{ token: string; messages: Msg[] }>(`/chat/agents/${agent.id}/test`, { method: 'POST', json: { token: fresh ? undefined : token ?? undefined, text: t } })
      setToken(r.token); setMsgs((m) => (fresh ? [] : m).concat(r.messages))
    } catch (e) { say(e) } finally { setBusy(false) }
  }
  React.useEffect(() => { void call(undefined, true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [agent.id, agent.version])
  React.useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs.length, busy])
  const send = (t: string) => { const v = t.trim(); if (!v || busy) return; setText(''); void call(v) }
  const color = agent.widget.color
  const lastAgent = [...msgs].reverse().find((m) => m.role !== 'visitor')
  return (
    <Card className="flex h-[560px] flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 text-white" style={{ background: color }}>
        <div className="min-w-0 flex-1"><div className="truncate text-[14px] font-semibold">{agent.widget.title}</div><div className="text-[11px] opacity-80">Test chat · free, never shown in your inbox</div></div>
        <button onClick={() => void call(undefined, true)} aria-label="Start over" className="rounded-full p-1.5 transition hover:bg-white/20"><RotateCcw size={15} /></button>
      </div>
      {dirty && <div className="border-b bg-warn/10 px-3 py-1.5 text-center text-[11.5px] text-warn">Save your changes to try them here.</div>}
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {msgs.map((m) => (
          <div key={m.id} className={m.role === 'visitor' ? 'flex justify-end' : 'flex'}>
            <div className={cn('max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13.5px] leading-relaxed', m.role === 'visitor' ? 'rounded-br-md text-white' : 'rounded-bl-md bg-muted')} style={m.role === 'visitor' ? { background: color } : undefined}>{m.text}</div>
          </div>))}
        {lastAgent?.options && lastAgent.options.length > 0 && !busy && <div className="flex flex-wrap gap-2 pt-1">{lastAgent.options.map((o) => <button key={o} onClick={() => send(o)} className="rounded-full border px-3 py-1.5 text-[13px] transition hover:bg-muted" style={{ borderColor: color, color }}>{o}</button>)}</div>}
        {busy && <div className="flex gap-1 px-1 py-2" aria-label="Typing">{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-soft/60" style={{ animationDelay: `${i * 150}ms` }} />)}</div>}
        <div ref={end} />
      </div>
      <form className="flex items-end gap-2 border-t p-2.5" onSubmit={(e) => { e.preventDefault(); send(text) }}>
        <Textarea rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text) } }} placeholder="Write as a visitor…" className="min-h-[40px] resize-none rounded-2xl py-2" aria-label="Test message" />
        <Button variant="primary" size="icon" className="shrink-0 rounded-full" disabled={!text.trim() || busy} aria-label="Send"><ArrowUp size={16} /></Button>
      </form>
    </Card>
  )
}

/* ======================================================================== the simple flow */
const TYPE_LABEL: Record<Step['type'], string> = { message: 'Say something', ask: 'Ask a question', choice: 'Offer buttons', ai: 'AI answers', human: 'Hand to a person', end: 'End the chat' }
const TYPE_HELP: Record<Step['type'], string> = { message: 'A fixed message. Free.', ask: 'Ask and remember the answer. Free.', choice: 'Buttons that go to different places. Free.', ai: 'From here the AI replies in its own words. Charged per reply.', human: 'Bring in someone from your team.', end: 'Say goodbye.' }
const newId = (steps: Step[]) => { let i = steps.length + 1; while (steps.some((s) => s.id === `s${i}`)) i++; return `s${i}` }

function FlowEditor({ steps, onChange }: { steps: Step[]; onChange: (s: Step[]) => void }) {
  const set = (i: number, p: Partial<Step>) => onChange(steps.map((s, k) => (k === i ? { ...s, ...p } : s)))
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= steps.length) return; const c = [...steps]; [c[i], c[j]] = [c[j], c[i]]; onChange(c) }
  const del = (i: number) => onChange(steps.filter((_, k) => k !== i))
  const add = (type: Step['type']) => {
    const base: Step = { id: newId(steps), type, text: '' }
    if (type === 'ask') Object.assign(base, { text: 'What is your name?', save_as: 'name', kind: 'text' })
    if (type === 'choice') Object.assign(base, { text: 'How can I help?', options: [{ label: 'Option one', goto: 'ai' }, { label: 'Talk to a person', goto: 'human' }] })
    if (type === 'message') base.text = 'Hi there!'
    if (type === 'human') base.text = "I'm bringing in a teammate now."
    if (type === 'end') base.text = 'Thanks for chatting. Have a great day!'
    onChange([...steps, base])
  }
  const targets = (self: string) => [...steps.filter((s) => s.id !== self).map((s, i) => ({ v: s.id, l: `${TYPE_LABEL[s.type]}${s.text ? `: ${s.text.slice(0, 28)}` : ''}` || `Step ${i + 1}` })), { v: 'ai', l: 'Let the AI answer' }, { v: 'human', l: 'Bring in a person' }, { v: 'end', l: 'End the chat' }]
  return (
    <div className="space-y-3">
      {steps.map((s, i) => (
        <Card key={s.id + i} className={cn('p-4', s.type === 'ai' && 'border-accent/40 bg-accent-soft/20')}>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">{i + 1}</span>
            <div className="min-w-0 flex-1"><div className="text-[13.5px] font-semibold">{TYPE_LABEL[s.type]}</div><div className="text-[11.5px] text-soft">{TYPE_HELP[s.type]}</div></div>
            <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></Button>
            <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === steps.length - 1} onClick={() => move(i, 1)}><ChevronDown size={14} /></Button>
            <Button size="sm" variant="ghost" aria-label="Delete step" className="hover:text-bad" onClick={() => del(i)}><Trash2 size={14} /></Button>
          </div>
          <div className="mt-3 space-y-3">
            {s.type !== 'ai' || true ? <Textarea rows={2} value={s.text} maxLength={600} onChange={(e) => set(i, { text: e.target.value })}
              placeholder={s.type === 'ai' ? 'Optional first line before the AI takes over' : s.type === 'ask' ? 'The question to ask' : 'What the agent says'} aria-label="Text" /> : null}
            {s.type === 'ask' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Remember the answer as"><Input value={s.save_as ?? ''} maxLength={20} onChange={(e) => set(i, { save_as: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} placeholder="name, email, phone…" /></Field>
                <Field label="It should be"><select className={sel} value={s.kind ?? 'text'} onChange={(e) => set(i, { kind: e.target.value as Step['kind'] })}><option value="text">Any text</option><option value="email">An email address</option><option value="phone">A phone number</option></select></Field>
              </div>)}
            {s.type === 'choice' && (
              <div className="space-y-2">
                {(s.options ?? []).map((o, k) => (
                  <div key={k} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <Input value={o.label} maxLength={40} aria-label="Button label" onChange={(e) => set(i, { options: s.options!.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)) })} />
                    <select className={sel} aria-label="Where it goes" value={o.goto} onChange={(e) => set(i, { options: s.options!.map((x, j) => (j === k ? { ...x, goto: e.target.value } : x)) })}>{targets(s.id).map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}</select>
                    <Button size="sm" variant="ghost" aria-label="Remove button" className="hover:text-bad" onClick={() => set(i, { options: s.options!.filter((_, j) => j !== k) })}><X size={14} /></Button>
                  </div>))}
                {(s.options?.length ?? 0) < 6 && <Button size="sm" onClick={() => set(i, { options: [...(s.options ?? []), { label: 'New button', goto: 'ai' }] })}><Plus size={13} />Add a button</Button>}
              </div>)}
            {(s.type === 'message' || s.type === 'ask') && (
              <Field label="Then"><select className={sel} value={s.next ?? ''} onChange={(e) => set(i, { next: e.target.value || undefined })}><option value="">Go to the next step</option>{targets(s.id).map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}</select></Field>)}
          </div>
        </Card>))}
      <div>
        <div className="mb-2 text-[13px] font-medium">Add a step</div>
        <div className="flex flex-wrap gap-2">{(Object.keys(TYPE_LABEL) as Step['type'][]).map((t) => <Button key={t} size="sm" onClick={() => add(t)} disabled={steps.length >= 30}><Plus size={13} />{TYPE_LABEL[t]}</Button>)}</div>
        <p className="mt-2 text-xs text-soft">Use <code className="rounded bg-muted px-1">{'{first_name}'}</code> or <code className="rounded bg-muted px-1">{'{email}'}</code> in any text to use what the visitor already shared.</p>
      </div>
    </div>
  )
}

/* ======================================================================== the editor */
const EXAMPLES = ['Make it more formal', 'Ask for their name and email first', 'Reply in Hindi', 'Hand over to a person when someone mentions a refund', 'Keep answers very short', 'Be more playful']

export function ChatAgentEditorPage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const meta = useChatMeta()
  const q = useAgent(id)
  const [d, setD] = React.useState<Agent | null>(null)
  const [instruction, setInstruction] = React.useState('')
  const [note, setNote] = React.useState<string | null>(null)
  const [del, setDel] = React.useState(false)
  const [kws, setKws] = React.useState('')
  const [prompts, setPrompts] = React.useState('')
  const [origins, setOrigins] = React.useState('')
  const [volume, setVolume] = React.useState(2000)
  React.useEffect(() => { if (q.data) { setD(q.data); setKws(q.data.handover.keywords.join(', ')); setPrompts(q.data.widget.prompts.join('\n')); setOrigins(q.data.origins.join('\n')) } }, [q.data])
  const hist = useQuery({ queryKey: ['chat', 'history', id, q.data?.version], queryFn: () => http<{ index: number; at: string; label: string; version: number }[]>(`/chat/agents/${id}/history`), enabled: !!id })
  const saved = q.data
  const draft = React.useMemo(() => (d ? { ...d, handover: { ...d.handover, keywords: kws.split(',').map((x) => x.trim()).filter(Boolean) }, widget: { ...d.widget, prompts: prompts.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 4) }, origins: origins.split('\n').map((x) => x.trim()).filter(Boolean) } : null), [d, kws, prompts, origins])
  const dirty = !!(saved && draft && JSON.stringify(pick(saved)) !== JSON.stringify(pick(draft)))
  const refresh = (a: Agent) => { qc.setQueryData(['chat', 'agent', id], a); void qc.invalidateQueries({ queryKey: ['chat', 'agents'] }); void qc.invalidateQueries({ queryKey: ['chat', 'history', id] }) }
  const save = useMutation({ mutationFn: () => http<Agent>(`/chat/agents/${id}`, { method: 'PATCH', json: pick(draft!) }), onSuccess: (a) => { refresh(a); toast.success('Saved') }, onError: say })
  const status = useMutation({ mutationFn: (s: string) => http<Agent>(`/chat/agents/${id}/status`, { method: 'POST', json: { status: s } }), onSuccess: (a) => { refresh(a); toast.success(a.status === 'live' ? `${a.name} is live` : a.status === 'paused' ? 'Paused' : 'Saved as a draft') }, onError: say })
  const edit = useMutation({
    mutationFn: () => http<{ summary: string; changed: string[]; agent: Agent }>(`/chat/agents/${id}/ai-edit`, { method: 'POST', json: { instruction } }),
    onSuccess: (r) => { refresh(r.agent); setInstruction(''); setNote(r.changed.length ? r.summary : `${r.summary} (nothing needed to change)`) }, onError: say,
  })
  const undo = useMutation({ mutationFn: (index: number) => http<Agent>(`/chat/agents/${id}/undo`, { method: 'POST', json: { index } }), onSuccess: (a) => { refresh(a); setNote('Put it back the way it was.') }, onError: say })
  const dup = useMutation({ mutationFn: () => http<Agent>(`/chat/agents/${id}/duplicate`, { method: 'POST' }), onSuccess: (a) => { void qc.invalidateQueries({ queryKey: ['chat'] }); nav(`/chat/agents/${a.id}`) }, onError: say })
  const remove = useMutation({ mutationFn: () => http(`/chat/agents/${id}`, { method: 'DELETE' }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['chat'] }); nav('/chat/agents') }, onError: say })
  if (q.isError) return <Card className="p-8 text-center text-sm text-soft">We couldn't find that chat agent. <Link to="/chat/agents" className="font-medium text-accent">Back to chat agents</Link></Card>
  if (!d || !draft || !saved) return <Card className="p-8 text-sm text-soft">Loading…</Card>
  const set = (p: Partial<Agent>) => setD({ ...d, ...p })
  const setW = (p: Partial<Widget>) => setD({ ...d, widget: { ...d.widget, ...p } })
  const model = meta.data?.models.find((m) => m.id === d.model)
  const monthly = volume * (model?.price ?? 0.6)
  const embed = `<script src="${origin()}/api/v1/public/chat.js" data-key="${d.key}" async></script>`
  const standalone = `${origin()}/chat-widget/${d.key}?embedder=${encodeURIComponent(origin())}`
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link to="/chat/agents" aria-label="Back" className="flex h-9 w-9 items-center justify-center rounded-full border bg-surface text-soft transition hover:bg-muted hover:text-ink"><ArrowLeft size={16} /></Link>
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-xl">{d.emoji ?? '💬'}</span>
        <div className="min-w-0 flex-1"><Input value={d.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} aria-label="Agent name" className="h-9 max-w-xs border-transparent bg-transparent px-1 text-xl font-semibold tracking-tight hover:border-line" /><div className="px-1 text-xs text-soft">{meta.data?.use_cases.find((u) => u.key === d.use_case)?.name} · version {saved.version}</div></div>
        <Badge tone={STATUS[saved.status].tone}>{STATUS[saved.status].label}</Badge>
        {saved.status === 'live' ? <Button onClick={() => status.mutate('paused')} disabled={status.isPending}><Pause size={14} />Pause</Button> : <Button variant="primary" onClick={() => status.mutate('live')} disabled={status.isPending || dirty}><Play size={14} />Go live</Button>}
        <Button variant="ghost" onClick={() => dup.mutate()} aria-label="Duplicate"><Copy size={15} /></Button>
        <Button variant="ghost" className="hover:text-bad" onClick={() => setDel(true)} aria-label="Delete"><Trash2 size={15} /></Button>
      </div>

      <Card className="mb-4 overflow-hidden p-4 sm:p-5">
        <div className="flex items-center gap-2 text-[14px] font-semibold"><Wand2 size={16} className="text-accent" />Change it by telling me what to change</div>
        <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (instruction.trim().length >= 3) edit.mutate() }}>
          <Input value={instruction} maxLength={1500} onChange={(e) => setInstruction(e.target.value)} disabled={dirty || edit.isPending} placeholder={dirty ? 'Save your changes first' : 'For example: ask for their phone number, and reply in Hindi'} aria-label="What should change" />
          <Button variant="primary" disabled={dirty || edit.isPending || instruction.trim().length < 3}>{edit.isPending ? <><Loader2 size={15} className="animate-spin" />Changing…</> : <><Sparkles size={15} />Change it</>}</Button>
        </form>
        <div className="mt-2.5 flex flex-wrap gap-2">{EXAMPLES.map((x) => <button key={x} type="button" disabled={dirty} onClick={() => setInstruction(x)} className="rounded-full border bg-surface px-3 py-1 text-xs text-soft transition hover:border-accent/50 hover:text-ink disabled:opacity-50">{x}</button>)}</div>
        {note && <div className="mt-3 flex items-center gap-2 rounded-xl bg-ok/10 px-3 py-2 text-[13px] text-ok"><Check size={15} className="shrink-0" /><span className="min-w-0 flex-1">{note}</span><Button size="sm" variant="ghost" disabled={undo.isPending} onClick={() => undo.mutate(0)}><RotateCcw size={13} />Undo</Button></div>}
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Tabs defaultValue="instructions">
          <TabsList className="flex-wrap"><Tab value="instructions">Instructions</Tab><Tab value="flow">Flow</Tab><Tab value="model">Model</Tab><Tab value="handover">Hand-over</Tab><Tab value="widget">Widget</Tab><Tab value="install">Install</Tab></TabsList>

          <TabPanel value="instructions" className="space-y-4">
            <Card className="space-y-4 p-5">
              <Field label="What this agent knows and does" hint={<span className="text-xs text-soft">Written in plain words. It also uses your Knowledge page and everything the flow collected.</span>}><Textarea rows={12} value={d.prompt} maxLength={6000} onChange={(e) => set({ prompt: e.target.value })} /></Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Tone"><select className={sel} value={d.tone} onChange={(e) => set({ tone: e.target.value })}>{(meta.data?.tones ?? []).map((t) => <option key={t}>{t}</option>)}</select></Field>
                <Field label="Reply length"><select className={sel} value={d.reply_length} onChange={(e) => set({ reply_length: e.target.value })}>{(meta.data?.lengths ?? []).map((t) => <option key={t} value={t}>{t === 'short' ? 'Short (1 to 3 sentences)' : t === 'medium' ? 'Medium (a short paragraph)' : 'Long (when needed)'}</option>)}</select></Field>
                <Field label="Language"><select className={sel} value={d.language} onChange={(e) => set({ language: e.target.value })}>{(meta.data?.languages ?? []).map((t) => <option key={t} value={t}>{t === 'auto' ? 'Same as the visitor' : t}</option>)}</select></Field>
              </div>
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-2 text-[14px] font-semibold"><History size={15} />Earlier versions</div>
              {!hist.data?.length ? <p className="mt-2 text-[13px] text-soft">Every change is kept here so you can go back.</p> : (
                <div className="mt-2 divide-y">{hist.data.map((h) => (
                  <div key={h.index} className="flex items-center gap-3 py-2.5 text-[13px]"><span className="min-w-0 flex-1 truncate">{h.label}<span className="ml-2 text-xs text-soft">{new Date(h.at).toLocaleString()}</span></span><Button size="sm" disabled={undo.isPending || dirty} onClick={() => undo.mutate(h.index)}><RotateCcw size={12} />Go back to before this</Button></div>))}</div>)}
            </Card>
          </TabPanel>

          <TabPanel value="flow">
            <Card className="mb-3 p-4 text-[13px] text-soft">A flow is the path a chat follows. Scripted steps are <b className="text-ink">free</b>; once it reaches <b className="text-ink">AI answers</b>, the AI replies in its own words and each reply is charged. No code needed: reorder, add and remove steps.</Card>
            <FlowEditor steps={d.flow.steps} onChange={(steps) => set({ flow: { steps } })} />
          </TabPanel>

          <TabPanel value="model" className="space-y-4">
            <Card className="p-5">
              <h3 className="text-[15px] font-semibold">Which AI answers</h3>
              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                {(meta.data?.models ?? []).map((m) => (
                  <button key={m.id} onClick={() => set({ model: m.id })} className={cn('rounded-xl border p-3.5 text-left transition', d.model === m.id ? 'border-accent bg-accent-soft/50 ring-2 ring-accent/20' : 'hover:bg-muted/50')}>
                    <div className="flex items-center justify-between gap-2"><span className="text-[14px] font-semibold">{m.name}</span><span className="num text-[13px] font-semibold">{money(m.price)}<span className="text-xs font-normal text-soft"> / reply</span></span></div>
                    <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-accent">{m.tier_label}</div>
                    <p className="mt-1 text-xs text-soft">{m.blurb}</p>
                  </button>))}
              </div>
              {meta.data && !meta.data.ai_ready && <p className="mt-3 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">The AI is not switched on for this platform yet, so replies will not work until it is.</p>}
            </Card>
            <Card className="space-y-5 p-5">
              <div><div className="flex items-center justify-between text-[13.5px]"><span className="font-medium">Creativity</span><span className="num text-soft">{d.temperature.toFixed(2)}</span></div><div className="mt-2"><Slider value={d.temperature} min={0} max={1} step={0.05} onChange={(v) => set({ temperature: v })} label="Creativity" /></div><p className="mt-1.5 text-xs text-soft">Low is steady and sticks to the facts. High is livelier but can wander. 0.3 to 0.5 suits most businesses.</p></div>
              <div><div className="flex items-center justify-between text-[13.5px]"><span className="font-medium">How much of the chat it remembers</span><span className="num text-soft">{d.memory} messages</span></div><div className="mt-2"><Slider value={d.memory} min={2} max={40} step={2} onChange={(v) => set({ memory: v })} label="Memory" /></div><p className="mt-1.5 text-xs text-soft">More memory follows long chats better. Price per reply stays the same.</p></div>
              <label className="flex items-center justify-between gap-4 text-sm"><span><b className="font-medium">Answer from my Knowledge</b><span className="block text-xs text-soft">Looks up your websites, files and notes for every question. Free.</span></span><Switch checked={d.use_knowledge} onChange={(v) => set({ use_knowledge: v })} label="Use knowledge" /></label>
            </Card>
            <Card className="p-5">
              <h3 className="text-[15px] font-semibold">What will this cost?</h3>
              <div className="mt-3 flex items-center justify-between text-[13.5px]"><span>AI replies a month</span><span className="num font-medium">{volume.toLocaleString('en-IN')}</span></div>
              <div className="mt-2"><Slider value={volume} min={100} max={50000} step={100} onChange={setVolume} label="Replies a month" /></div>
              <div className="mt-3 text-[26px] font-semibold tracking-tight num">{money(monthly, 0)}<span className="ml-1 text-sm font-normal text-soft">a month, before volume discounts</span></div>
              <p className="mt-1 text-xs text-soft">Only the AI's own replies count. <Link to="/chat/pricing" className="font-medium text-accent">See full pricing</Link></p>
            </Card>
          </TabPanel>

          <TabPanel value="handover" className="space-y-4">
            <Card className="space-y-4 p-5">
              <h3 className="text-[15px] font-semibold">When a person should step in</h3>
              <Field label="Words that bring in a person" hint={<span className="text-xs text-soft">Separate with commas. Asking for a human always works too.</span>}><Input value={kws} onChange={(e) => setKws(e.target.value)} placeholder="refund, complaint, legal" /></Field>
              <div><div className="flex items-center justify-between text-[13.5px]"><span className="font-medium">Hand over after the AI is unsure</span><span className="num text-soft">{d.handover.after_failures === 0 ? 'Never' : `${d.handover.after_failures} times in a row`}</span></div><div className="mt-2"><Slider value={d.handover.after_failures} min={0} max={5} onChange={(v) => set({ handover: { ...d.handover, after_failures: v } })} label="After unsure replies" /></div></div>
              <Field label="What the visitor is told"><Input value={d.handover.message} maxLength={300} onChange={(e) => set({ handover: { ...d.handover, message: e.target.value } })} /></Field>
              <p className="text-xs text-soft">Your team is alerted in the app, and by email if you set one under <Link to="/chat/channels" className="font-medium text-accent">Channels</Link>. Reply from the <Link to="/chat/inbox" className="font-medium text-accent">Inbox</Link>; the agent stays quiet until you hand the chat back.</p>
            </Card>
          </TabPanel>

          <TabPanel value="widget" className="space-y-4">
            <Card className="space-y-4 p-5">
              <h3 className="text-[15px] font-semibold">How the chat looks</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Title"><Input value={d.widget.title} maxLength={60} onChange={(e) => setW({ title: e.target.value })} /></Field>
                <Field label="Colour"><div className="flex gap-2"><input type="color" aria-label="Colour" value={d.widget.color} onChange={(e) => setW({ color: e.target.value })} className="h-10 w-12 shrink-0 cursor-pointer rounded-xl border bg-surface p-1" /><Input value={d.widget.color} onChange={(e) => setW({ color: e.target.value })} /></div></Field>
              </div>
              <Field label="First message"><Input value={d.widget.greeting} maxLength={300} onChange={(e) => setW({ greeting: e.target.value })} /></Field>
              <Field label="Quick questions (one per line, up to 4)"><Textarea rows={3} value={prompts} onChange={(e) => setPrompts(e.target.value)} placeholder={'What are your opening hours?\nHow much does it cost?'} /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Position"><select className={sel} value={d.widget.position} onChange={(e) => setW({ position: e.target.value as 'left' | 'right' })}><option value="right">Bottom right</option><option value="left">Bottom left</option></select></Field>
                <Field label="Where it may appear (one website per line, empty means anywhere)"><Textarea rows={2} value={origins} onChange={(e) => setOrigins(e.target.value)} placeholder="https://www.example.com" /></Field>
              </div>
              <label className="flex items-center justify-between gap-4 border-t pt-4 text-sm"><b className="font-medium">Show “Powered by Swarvo AI”</b><Switch checked={d.widget.powered_by} onChange={(v) => setW({ powered_by: v })} label="Powered by" /></label>
            </Card>
          </TabPanel>

          <TabPanel value="install" className="space-y-4">
            <Card className="space-y-3 p-5">
              <h3 className="text-[15px] font-semibold">Put it on a website</h3>
              <p className="text-[13px] text-soft">Paste this line before the closing <code className="rounded bg-muted px-1">&lt;/body&gt;</code> tag. This agent has its own line, so every page or use case can have a different agent.</p>
              <CodeBlock code={embed} />
              {saved.status !== 'live' && <p className="rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">This agent is {saved.status}. The chat only shows on websites once you press <b>Go live</b>.</p>}
            </Card>
            <Card className="space-y-4 p-5">
              <h3 className="text-[15px] font-semibold">Where each kind of agent works best</h3>
              <div className="grid gap-3 text-[13px] sm:grid-cols-2">
                {[['Support', 'Help centre, order and account pages, and the contact page.'], ['Sales', 'Pricing, product and landing pages. Add your own button that opens it.'], ['Bookings', 'Contact and service pages, or share the link in your Instagram bio.'], ['Orders', 'Your shop pages, and WhatsApp for customers who already know you.']].map(([t, x]) => <div key={t} className="rounded-xl bg-muted/50 p-3"><div className="font-semibold">{t}</div><div className="mt-0.5 text-soft">{x}</div></div>)}
              </div>
            </Card>
            <Card className="space-y-4 p-5">
              <h3 className="text-[15px] font-semibold">Platform guides</h3>
              <div className="space-y-3 text-[13px] text-soft">
                <div><b className="text-ink">WordPress.</b> Appearance, Theme file editor, footer.php: paste the line before <code className="rounded bg-muted px-1">&lt;/body&gt;</code>. Or use a header and footer plugin.</div>
                <div><b className="text-ink">Shopify.</b> Online Store, Themes, Edit code, theme.liquid: paste before <code className="rounded bg-muted px-1">&lt;/body&gt;</code>.</div>
                <div><b className="text-ink">Wix, Squarespace, Webflow.</b> Settings, Custom code: add the line to the end of the body on all pages.</div>
                <div><b className="text-ink">Google Tag Manager.</b> New tag, Custom HTML, paste the line, trigger on All Pages.</div>
                <div><b className="text-ink">React or Next.js.</b><CodeBlock className="mt-2" code={`useEffect(() => {\n  const s = document.createElement('script')\n  s.src = '${origin()}/api/v1/public/chat.js'\n  s.dataset.key = '${d.key}'\n  s.async = true\n  document.body.appendChild(s)\n}, [])`} /></div>
                <div><b className="text-ink">Your own button.</b> Call <code className="rounded bg-muted px-1">SwarvoChat.open()</code> from any button. Add <code className="rounded bg-muted px-1">data-user-name</code> and <code className="rounded bg-muted px-1">data-user-email</code> to greet signed-in users by name.</div>
              </div>
            </Card>
            <Card className="space-y-3 p-5">
              <h3 className="text-[15px] font-semibold">A link you can share</h3>
              <p className="text-[13px] text-soft">Opens the chat on its own page. Put it in an email, an Instagram bio or a QR code.</p>
              <CodeBlock code={standalone} />
              <p className="text-xs text-soft">To answer on WhatsApp with this agent, choose it under <Link to="/chat/channels?tab=whatsapp" className="font-medium text-accent">Channels, WhatsApp</Link>.</p>
            </Card>
          </TabPanel>
        </Tabs>

        <div className="xl:sticky xl:top-4 xl:self-start"><div className="mb-2 text-[13px] font-medium text-soft">Try it</div><TestChat agent={saved} dirty={dirty} /></div>
      </div>

      <UnsavedBar show={dirty} onSave={() => save.mutate()} onDiscard={() => { setD(saved); setKws(saved.handover.keywords.join(', ')); setPrompts(saved.widget.prompts.join('\n')); setOrigins(saved.origins.join('\n')) }} />
      <ConfirmDialog open={del} onOpenChange={setDel} danger confirm="Delete agent" title={`Delete ${saved.name}?`} text="Its website chat stops working and the instructions are gone. Past conversations stay in your inbox." onConfirm={() => remove.mutate()} />
    </>
  )
}

const pick = (a: Agent) => ({ name: a.name, prompt: a.prompt, model: a.model, temperature: a.temperature, reply_length: a.reply_length, tone: a.tone, language: a.language, use_knowledge: a.use_knowledge, memory: a.memory, flow: a.flow, handover: a.handover, widget: a.widget, origins: a.origins })

/* ======================================================================== pricing and usage */
export function ChatPricingPage() {
  const price = useQuery({ queryKey: ['chat', 'pricing'], queryFn: () => http<Pricing>('/chat/pricing') })
  const use = useQuery({ queryKey: ['chat', 'usage'], queryFn: () => http<Usage>('/chat/usage?days=30') })
  const [volume, setVolume] = React.useState(5000)
  const [model, setModel] = React.useState('gpt-4.1-mini')
  const p = price.data
  const m = p?.models.find((x) => x.id === model)
  const slab = p ? [...p.slabs].reverse().find((s) => volume >= s.from) : undefined
  const unit = m ? m.price * (1 - (slab?.discount ?? 0)) : 0
  const u = use.data
  return (
    <>
      <PageHeader title="Chat pricing" subtitle="Pay only when the AI writes a reply. Everything else is free." />
      <Card className="mb-4 overflow-hidden p-6 sm:p-8">
        <div className="max-w-2xl">
          <Badge tone="accent">Per reply, no monthly fee</Badge>
          <h2 className="mt-3 text-[28px] font-semibold leading-tight tracking-[-0.03em] sm:text-[34px]">From {p ? money(Math.min(...p.models.map((x) => x.price))) : '…'} for each free-form AI reply.</h2>
          <p className="mt-2 text-[15px] text-soft">A reply is one message the AI writes in its own words. Scripted flow messages, buttons, what visitors write and replies from your own team never cost anything.</p>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-5 sm:p-6">
          <h3 className="text-[15px] font-semibold">Price per AI reply</h3>
          <div className="mt-3 divide-y">
            {(p?.models ?? []).map((x) => (
              <div key={x.id} className="flex items-center gap-4 py-3.5">
                <div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-[14px] font-semibold">{x.name}<Badge>{x.tier_label}</Badge></div><div className="mt-0.5 text-xs text-soft">{x.blurb}</div></div>
                <div className="text-right"><div className="num text-[17px] font-semibold">{money(x.price)}</div><div className="text-[11px] text-soft">{money(x.price * 1000, 0)} per 1,000</div></div>
              </div>))}
          </div>
          <h3 className="mt-6 text-[15px] font-semibold">The more you use, the less you pay</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">{(p?.slabs ?? []).map((s) => <div key={s.from} className={cn('rounded-xl border p-3', u && u.discount === s.discount && 'border-accent bg-accent-soft/40')}><div className="text-[11px] text-soft">{s.label}</div><div className="mt-1 text-[17px] font-semibold">{s.discount ? `${Math.round(s.discount * 100)}% off` : 'List price'}</div></div>)}</div>
          <p className="mt-2 text-xs text-soft">The discount applies to every reply in the month once you pass each level, and starts again at the beginning of the next month.</p>
        </Card>

        <div className="space-y-4">
          <Card className="p-5 sm:p-6">
            <h3 className="text-[15px] font-semibold">Estimate your month</h3>
            <div className="mt-3 flex flex-wrap gap-2">{(p?.models ?? []).map((x) => <Chip key={x.id} active={model === x.id} onClick={() => setModel(x.id)}>{x.name}</Chip>)}</div>
            <div className="mt-4 flex items-center justify-between text-[13.5px]"><span>AI replies a month</span><span className="num font-medium">{volume.toLocaleString('en-IN')}</span></div>
            <div className="mt-2"><Slider value={volume} min={500} max={150000} step={500} onChange={setVolume} label="Replies a month" /></div>
            <div className="mt-4 text-[30px] font-semibold tracking-tight num">{money(volume * unit, 0)}</div>
            <div className="text-xs text-soft">{money(unit, 3)} a reply{slab && slab.discount ? ` after ${Math.round(slab.discount * 100)}% volume discount` : ''}</div>
          </Card>
          <Card className="p-5 sm:p-6">
            <h3 className="text-[15px] font-semibold">Always free</h3>
            <ul className="mt-3 space-y-2">{(p?.free ?? []).map((f) => <li key={f} className="flex items-start gap-2 text-[13.5px]"><Check size={15} className="mt-0.5 shrink-0 text-ok" />{f}</li>)}</ul>
          </Card>
        </div>
      </div>

      <Card className="mt-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-[15px] font-semibold">Your usage this month</h3><Link to="/billing"><Button size="sm">Add money</Button></Link></div>
        {!u ? <p className="mt-3 text-sm text-soft">Loading…</p> : (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-4">
              {[['AI replies', u.month_replies.toLocaleString('en-IN')], ['Spent', money(u.month_spend)], ['Your discount', u.discount ? `${Math.round(u.discount * 100)}%` : 'None yet'], ['Balance', u.balance === null ? '—' : money(u.balance)]].map(([l, v]) => <div key={l}><div className="text-xs text-soft">{l}</div><div className="num mt-1 text-[22px] font-semibold">{v}</div></div>)}
            </div>
            {u.next_slab && <p className="mt-3 text-xs text-soft">{u.next_slab.to_go.toLocaleString('en-IN')} more replies this month and you get {Math.round(u.next_slab.discount * 100)}% off.</p>}
            {Object.keys(u.by_model).length > 0 && <div className="mt-4 divide-y rounded-xl border">{Object.entries(u.by_model).map(([k, v]) => <div key={k} className="flex items-center justify-between px-4 py-2.5 text-[13px]"><span>{p?.models.find((x) => x.id === k)?.name ?? k}</span><span className="num text-soft">{v.replies.toLocaleString('en-IN')} replies · {money(v.spend)}</span></div>)}</div>}
          </>)}
      </Card>

      <Card className="mt-4 p-5 sm:p-6">
        <h3 className="text-[15px] font-semibold">Questions</h3>
        <div className="mt-3 grid gap-5 text-[13.5px] sm:grid-cols-2">
          {[['What is a reply?', 'One message the AI writes on its own. A visitor tapping a button, a scripted greeting or your team typing are not replies.'], ['Do long chats cost more?', 'No. Each AI reply costs the same however long the chat is. Pick a larger memory on the Model tab for long conversations.'], ['What if my balance runs out?', 'Visitors are told you cannot take messages right now, you get an alert, and replies resume as soon as you add money.'], ['Is testing free?', 'Yes. Chats in the editor never cost anything and never appear in your inbox.']].map(([q, a]) => <div key={q}><div className="font-semibold">{q}</div><p className="mt-1 text-soft">{a}</p></div>)}
        </div>
      </Card>
    </>
  )
}
