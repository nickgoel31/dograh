import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUp, Check, CheckCircle2, Circle, MessageCircle, Phone, Globe } from '@/components/icons'
import { AgentAvatar } from '@/components/AgentAvatar'
import { Badge, Button, Card, Chip, Field, Input, Switch, Tab, TabPanel, Tabs, TabsList, Textarea } from '@/components/ui'
import { CodeBlock, PageHeader, SearchPill } from '@/components/shared'
import { http } from '@/lib/api/http'
import { useData } from '@/store/data'
import { cn } from '@/lib/utils'

type Cfg = { title: string; greeting: string; color: string; position: 'left' | 'right'; prompts: string[]; collect_lead: boolean; powered_by: boolean; offline_message: string }
type Settings = {
  key: string; agent_id: string | null; enabled: boolean; config: Cfg; origins: string[]; notify_email: string | null; answering_agent: string | null; ready: boolean
  whatsapp: { phone_number_id: string; has_token: boolean; has_secret: boolean; verify_token: string; connected: boolean }
}
type Row = { id: string; name: string | null; contact: string; email: string | null; channel: 'web' | 'whatsapp'; status: 'bot' | 'human' | 'closed'; unread: number; last_text: string | null; last_at: string | null; rating: number | null; handoff: boolean }
type Msg = { id: number; role: 'visitor' | 'agent' | 'human'; text: string; at: string | null }
type Stats = { sessions: number; messages: number; handed_over: number; handled_by_agent: number; open: number; needs_you: number; avg_rating: number | null; rated: number; by_day: { day: string; sessions: number }[] }

const say = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
const ago = (iso: string | null) => { if (!iso) return ''; const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 6e4)); return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d` }
export const useChatSettings = () => useQuery({ queryKey: ['chat', 'settings'], queryFn: () => http<Settings>('/chat/settings') })
const who = (r: Row) => r.name || (r.channel === 'whatsapp' ? `+${r.contact}` : 'Website visitor')

/* ---------- Overview ---------- */
export function ChatOverviewPage() {
  const s = useChatSettings()
  const stats = useQuery({ queryKey: ['chat', 'stats'], queryFn: () => http<Stats>('/chat/stats?days=30') })
  const recent = useQuery({ queryKey: ['chat', 'sessions', 'recent'], queryFn: () => http<{ sessions: Row[] }>('/chat/sessions?limit=5'), refetchInterval: 15000 })
  const d = stats.data
  const cards = [
    ['Conversations', d ? d.sessions.toLocaleString('en-IN') : '—', 'Last 30 days'],
    ['Answered by the agent', d && d.sessions ? `${Math.round((d.handled_by_agent / d.sessions) * 100)}%` : '—', d ? `${d.handled_by_agent} of ${d.sessions} chats` : ''],
    ['Needs you now', d ? String(d.needs_you) : '—', 'Waiting for a person'],
    ['Average rating', d?.avg_rating ? `${d.avg_rating} / 5` : '—', d?.rated ? `${d.rated} rated` : 'No ratings yet'],
  ]
  const steps = [
    { done: !!s.data?.ready, t: 'Publish an agent', d: 'Chats are answered by a live agent. Build one and press Publish.', to: '/agents' },
    { done: !!s.data?.enabled && !!s.data?.ready, t: 'Add the chat to your website', d: 'Copy one line of code from Channels and paste it into your site.', to: '/chat/channels' },
    { done: !!s.data?.whatsapp.connected, t: 'Connect WhatsApp', d: 'Let customers message your WhatsApp number and get the same answers.', to: '/chat/channels?tab=whatsapp' },
    { done: !!s.data?.notify_email, t: 'Get told when a person is needed', d: 'Add an email address so you hear about chats the agent hands over.', to: '/chat/channels' },
  ]
  return (
    <>
      <PageHeader title="Chat Agents" subtitle="Your agents, answering in text on your website and on WhatsApp." actions={<Link to="/chat/inbox"><Button variant="primary"><MessageCircle size={15} />Open inbox{d && d.needs_you > 0 ? ` (${d.needs_you})` : ''}</Button></Link>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([l, v, h]) => <Card key={l} className="p-5"><div className="text-[13px] text-soft">{l}</div><div className="num mt-2 text-[28px] font-semibold leading-none tracking-tight">{v}</div><div className="mt-2 text-xs text-soft">{h}</div></Card>)}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <Card className="p-5 sm:p-6">
          <h3 className="text-[15px] font-semibold">Get set up</h3>
          <div className="mt-3 divide-y">
            {steps.map((x) => (
              <Link key={x.t} to={x.to} className="flex items-start gap-3 py-3.5 transition hover:opacity-80">
                {x.done ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-ok" /> : <Circle size={18} className="mt-0.5 shrink-0 text-soft" />}
                <span><span className={cn('block text-[14px] font-medium', x.done && 'text-soft line-through')}>{x.t}</span><span className="mt-0.5 block text-[13px] text-soft">{x.d}</span></span>
              </Link>))}
          </div>
        </Card>
        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between"><h3 className="text-[15px] font-semibold">Recent chats</h3><Link to="/chat/inbox" className="text-xs font-medium text-accent">See all</Link></div>
          {!recent.data?.sessions.length ? <p className="mt-6 pb-4 text-center text-sm text-soft">Chats will show up here as soon as someone writes in.</p> : (
            <div className="mt-3 divide-y">{recent.data.sessions.map((r) => (
              <Link key={r.id} to="/chat/inbox" className="flex items-center gap-3 py-3">
                <AgentAvatar id={r.id} className="h-9 w-9" />
                <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] font-medium">{who(r)}</span><span className="block truncate text-xs text-soft">{r.last_text}</span></span>
                <span className="text-xs text-soft">{ago(r.last_at)}</span>
              </Link>))}</div>)}
        </Card>
      </div>
    </>
  )
}

/* ---------- Inbox ---------- */
export function ChatInboxPage() {
  const qc = useQueryClient()
  const [filter, setFilter] = React.useState<'open' | 'human' | 'closed'>('open')
  const [q, setQ] = React.useState('')
  const [sel, setSel] = React.useState<string | null>(null)
  const [text, setText] = React.useState('')
  const end = React.useRef<HTMLDivElement>(null)
  const list = useQuery({ queryKey: ['chat', 'sessions', filter, q], queryFn: () => http<{ sessions: Row[]; needs_you: number }>(`/chat/sessions?status=${filter}${q ? `&q=${encodeURIComponent(q)}` : ''}`), refetchInterval: 5000 })
  const thread = useQuery({ queryKey: ['chat', 'thread', sel], queryFn: () => http<Row & { messages: Msg[] }>(`/chat/sessions/${sel}`), enabled: !!sel, refetchInterval: 3000 })
  const rows = list.data?.sessions ?? []
  React.useEffect(() => { if (!sel && rows.length) setSel(rows[0].id) }, [rows, sel])
  React.useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [thread.data?.messages.length, sel])
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['chat'] }) }
  const send = useMutation({ mutationFn: () => http<{ delivered: boolean }>(`/chat/sessions/${sel}/reply`, { method: 'POST', json: { text } }), onSuccess: (r) => { setText(''); refresh(); if (!r.delivered) toast.error('Saved, but WhatsApp did not accept it. Check your WhatsApp settings.') }, onError: say })
  const mark = useMutation({ mutationFn: (status: string) => http(`/chat/sessions/${sel}/status`, { method: 'POST', json: { status } }), onSuccess: refresh, onError: say })
  const t = thread.data
  return (
    <>
      <PageHeader title="Inbox" subtitle="Every chat from your website and WhatsApp. Step in whenever you want." />
      <Card className="grid h-[calc(100dvh-14rem)] min-h-[460px] overflow-hidden md:grid-cols-[340px_1fr]">
        <div className="flex min-h-0 flex-col border-b md:border-b-0 md:border-r">
          <div className="space-y-3 p-3">
            <SearchPill placeholder="Search chats" value={q} onChange={setQ} />
            <div className="flex gap-2">{([['open', 'Open'], ['human', `Needs you${list.data?.needs_you ? ` (${list.data.needs_you})` : ''}`], ['closed', 'Closed']] as const).map(([k, l]) => <Chip key={k} active={filter === k} onClick={() => { setFilter(k); setSel(null) }}>{l}</Chip>)}</div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!rows.length ? <p className="px-4 py-10 text-center text-sm text-soft">{list.isPending ? 'Loading…' : 'No chats here.'}</p> : rows.map((r) => (
              <button key={r.id} onClick={() => setSel(r.id)} className={cn('flex w-full items-center gap-3 border-t px-3 py-3 text-left transition hover:bg-muted/50', sel === r.id && 'bg-muted')}>
                <AgentAvatar id={r.id} className="h-9 w-9" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5"><span className="truncate text-[13.5px] font-medium">{who(r)}</span>{r.channel === 'whatsapp' && <Phone size={11} className="shrink-0 text-ok" />}</span>
                  <span className="block truncate text-xs text-soft">{r.last_text}</span>
                </span>
                <span className="flex flex-col items-end gap-1"><span className="text-[11px] text-soft">{ago(r.last_at)}</span>{r.status === 'human' ? <span className="h-2 w-2 rounded-full bg-warn" title="Needs you" /> : r.unread > 0 ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}</span>
              </button>))}
          </div>
        </div>
        <div className="flex min-h-0 flex-col">
          {!t ? <div className="flex flex-1 items-center justify-center text-sm text-soft">Pick a chat to read it.</div> : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                <div className="min-w-0"><div className="truncate text-[14px] font-semibold">{who(t)}</div><div className="truncate text-xs text-soft">{[t.email, t.channel === 'whatsapp' ? 'WhatsApp' : 'Website'].filter(Boolean).join(' · ')}</div></div>
                <div className="flex items-center gap-2">
                  <Badge tone={t.status === 'human' ? 'orange' : t.status === 'closed' ? 'gray' : 'green'}>{t.status === 'human' ? 'A person has it' : t.status === 'closed' ? 'Closed' : 'Agent answering'}</Badge>
                  {t.status !== 'bot' && t.status !== 'closed' && <Button size="sm" onClick={() => mark.mutate('bot')}>Hand back to agent</Button>}
                  {t.status !== 'closed' ? <Button size="sm" onClick={() => mark.mutate('closed')}><Check size={13} />Close</Button> : <Button size="sm" onClick={() => mark.mutate('bot')}>Reopen</Button>}
                </div>
              </div>
              <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
                {t.messages.map((m) => (
                  <div key={m.id} className={cn('flex', m.role === 'visitor' ? 'justify-start' : 'justify-end')}>
                    <div className="max-w-[78%]">
                      <div className={cn('whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed', m.role === 'visitor' ? 'bg-muted' : m.role === 'human' ? 'bg-ink text-surface' : 'border bg-surface')}>{m.text}</div>
                      <div className={cn('mt-0.5 px-1 text-[10.5px] text-soft', m.role !== 'visitor' && 'text-right')}>{m.role === 'agent' ? 'Agent' : m.role === 'human' ? 'You' : ''} {ago(m.at)}</div>
                    </div>
                  </div>))}
                <div ref={end} />
              </div>
              <form className="flex items-end gap-2 border-t p-3" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send.mutate() }}>
                <Textarea rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (text.trim()) send.mutate() } }}
                  placeholder={t.status === 'bot' ? 'Replying will pause the agent in this chat…' : 'Write a reply…'} className="min-h-[40px] resize-none rounded-2xl py-2" aria-label="Reply" />
                <Button variant="primary" size="icon" className="shrink-0 rounded-full" disabled={!text.trim() || send.isPending} aria-label="Send"><ArrowUp size={16} /></Button>
              </form>
            </>)}
        </div>
      </Card>
    </>
  )
}

/* ---------- Channels ---------- */
const origin = () => window.location.origin
export function ChatChannelsPage() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const s = useChatSettings()
  const agents = useData((u) => u.agents).filter((a) => a.status === 'live')
  const [f, setF] = React.useState<Settings | null>(null)
  const [origins, setOrigins] = React.useState('')
  const [prompts, setPrompts] = React.useState('')
  const [wa, setWa] = React.useState({ phone_number_id: '', token: '', app_secret: '' })
  const tab = new URLSearchParams(window.location.search).get('tab') === 'whatsapp' ? 'whatsapp' : 'web'
  React.useEffect(() => { if (s.data) { setF(s.data); setOrigins(s.data.origins.join('\n')); setPrompts(s.data.config.prompts.join('\n')); setWa({ phone_number_id: s.data.whatsapp.phone_number_id, token: '', app_secret: '' }) } }, [s.data])
  const save = useMutation({
    mutationFn: () => http<Settings>('/chat/settings', { method: 'PUT', json: { agent_id: f!.agent_id, enabled: f!.enabled, notify_email: f!.notify_email, origins: origins.split('\n').map((x) => x.trim()).filter(Boolean), config: { ...f!.config, prompts: prompts.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 4) }, whatsapp: { phone_number_id: wa.phone_number_id, token: wa.token || null, app_secret: wa.app_secret || null } } }),
    onSuccess: (r) => { toast.success('Saved'); qc.setQueryData(['chat', 'settings'], r); void qc.invalidateQueries({ queryKey: ['chat', 'settings'] }) }, onError: say,
  })
  if (!f) return <><PageHeader title="Channels" subtitle="Where your chat agent talks to people." /><Card className="p-8 text-sm text-soft">Loading…</Card></>
  const set = (p: Partial<Cfg>) => setF({ ...f, config: { ...f.config, ...p } })
  const snippet = `<script src="${origin()}/api/v1/public/chat.js" data-key="${f.key}" async></script>`
  const hook = `${origin()}/api/v1/product/hooks/whatsapp`
  return (
    <>
      <PageHeader title="Channels" subtitle="Where your chat agent talks to people." actions={<Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save changes'}</Button>} />
      <Tabs defaultValue={tab} onValueChange={(v) => nav(`/chat/channels${v === 'whatsapp' ? '?tab=whatsapp' : ''}`, { replace: true })}>
        <TabsList><Tab value="web"><Globe size={13} className="mr-1.5 inline" />Website</Tab><Tab value="whatsapp"><Phone size={13} className="mr-1.5 inline" />WhatsApp{f.whatsapp.connected && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-ok" />}</Tab></TabsList>

        <TabPanel value="web">
          <Card className="mb-4 p-5 sm:p-6">
            <h3 className="text-[15px] font-semibold">Add it to your website</h3>
            <p className="mt-1 text-[13px] text-soft">Paste this one line just before the closing <code className="rounded bg-muted px-1">&lt;/body&gt;</code> tag. It works on any site: WordPress, Shopify, Wix, Webflow, or your own code.</p>
            <div className="mt-3"><CodeBlock code={snippet} /></div>
            <p className="mt-3 text-xs text-soft">To open the chat from your own button, call <code className="rounded bg-muted px-1">SwarvoChat.open()</code>. To greet people by name, add <code className="rounded bg-muted px-1">data-user-name</code> and <code className="rounded bg-muted px-1">data-user-email</code> to the line.</p>
          </Card>
          <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
            <div className="space-y-4">
              <Card className="space-y-4 p-5 sm:p-6">
                <div className="flex items-center justify-between gap-4"><div><h3 className="text-[15px] font-semibold">Chat on your website</h3><p className="mt-0.5 text-[13px] text-soft">{f.ready ? <>Answering: <b className="text-ink">{f.answering_agent}</b></> : 'Publish an agent first. Only live agents answer chats.'}</p></div><Switch checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label="Chat on" /></div>
                <Field label="Which agent answers">
                  <select className="h-10 w-full rounded-xl border border-line bg-surface px-3.5 text-sm" value={f.agent_id ?? ''} onChange={(e) => setF({ ...f, agent_id: e.target.value || null })}>
                    <option value="">My newest live agent</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </Field>
              </Card>
              <Card className="space-y-4 p-5 sm:p-6">
                <h3 className="text-[15px] font-semibold">Look and feel</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Title"><Input value={f.config.title} maxLength={60} onChange={(e) => set({ title: e.target.value })} /></Field>
                  <Field label="Colour"><div className="flex gap-2"><input type="color" aria-label="Colour" value={f.config.color} onChange={(e) => set({ color: e.target.value })} className="h-10 w-12 shrink-0 cursor-pointer rounded-xl border bg-surface p-1" /><Input value={f.config.color} onChange={(e) => set({ color: e.target.value })} /></div></Field>
                </div>
                <Field label="First message"><Input value={f.config.greeting} maxLength={300} onChange={(e) => set({ greeting: e.target.value })} /></Field>
                <Field label="Suggested questions (one per line, up to 4)"><Textarea rows={3} value={prompts} onChange={(e) => setPrompts(e.target.value)} placeholder={'What are your opening hours?\nHow much does it cost?'} /></Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Position"><select className="h-10 w-full rounded-xl border border-line bg-surface px-3.5 text-sm" value={f.config.position} onChange={(e) => set({ position: e.target.value as 'left' | 'right' })}><option value="right">Bottom right</option><option value="left">Bottom left</option></select></Field>
                  <Field label="Email me when a person is needed"><Input type="email" value={f.notify_email ?? ''} onChange={(e) => setF({ ...f, notify_email: e.target.value })} placeholder="you@company.com" /></Field>
                </div>
                <div className="space-y-3 border-t pt-4">
                  <label className="flex items-center justify-between gap-4 text-sm"><span><b className="font-medium">Ask for name and email first</b><span className="block text-xs text-soft">Collect a lead before the chat starts.</span></span><Switch checked={f.config.collect_lead} onChange={(v) => set({ collect_lead: v })} label="Ask for name and email" /></label>
                  <label className="flex items-center justify-between gap-4 text-sm"><span><b className="font-medium">Show “Powered by Swarvo AI”</b></span><Switch checked={f.config.powered_by} onChange={(v) => set({ powered_by: v })} label="Powered by" /></label>
                </div>
              </Card>
              <Card className="p-5 sm:p-6">
                <h3 className="text-[15px] font-semibold">Where it may appear</h3>
                <p className="mt-1 text-[13px] text-soft">Leave empty to allow any website. To stop others copying your line onto their site, list yours, one address per line.</p>
                <Textarea className="mt-3" rows={3} value={origins} onChange={(e) => setOrigins(e.target.value)} placeholder="https://www.example.com" aria-label="Allowed websites" />
              </Card>
            </div>
            <div className="xl:sticky xl:top-4 xl:self-start">
              <div className="mb-2 text-[13px] font-medium text-soft">Live preview</div>
              {f.ready ? <iframe title="Chat preview" key={s.dataUpdatedAt} src={`/chat-widget/${f.key}?embedder=${encodeURIComponent(origin())}`} className="h-[560px] w-full rounded-2xl border bg-white" />
                : <Card className="flex h-[300px] items-center justify-center p-6 text-center text-sm text-soft">Publish an agent to try the chat here.</Card>}
              <p className="mt-2 text-xs text-soft">Save your changes to see them here. This is the real chat, so messages you send count as a conversation.</p>
            </div>
          </div>
        </TabPanel>

        <TabPanel value="whatsapp">
          <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
            <Card className="space-y-4 p-5 sm:p-6">
              <div className="flex items-center justify-between"><div><h3 className="text-[15px] font-semibold">WhatsApp Business</h3><p className="mt-0.5 text-[13px] text-soft">Customers message your WhatsApp number. The same agent answers, and you can step in from the inbox.</p></div>{f.whatsapp.connected ? <Badge tone="green">Connected</Badge> : <Badge>Not connected</Badge>}</div>
              <Field label="Phone number ID"><Input value={wa.phone_number_id} inputMode="numeric" onChange={(e) => setWa({ ...wa, phone_number_id: e.target.value.replace(/\D/g, '') })} placeholder="From Meta: WhatsApp → API setup" /></Field>
              <Field label="Access token" hint={f.whatsapp.has_token ? <span className="text-xs text-ok">Saved. Paste a new one to replace it.</span> : undefined}><Input type="password" autoComplete="off" value={wa.token} onChange={(e) => setWa({ ...wa, token: e.target.value })} placeholder={f.whatsapp.has_token ? '••••••••••••' : 'A permanent token from Meta'} /></Field>
              <Field label="App secret" hint={f.whatsapp.has_secret ? <span className="text-xs text-ok">Saved. Paste a new one to replace it.</span> : undefined}><Input type="password" autoComplete="off" value={wa.app_secret} onChange={(e) => setWa({ ...wa, app_secret: e.target.value })} placeholder={f.whatsapp.has_secret ? '••••••••••••' : 'Meta app → Settings → Basic'} /></Field>
              <p className="text-xs text-soft">We use the app secret to check that every message really comes from WhatsApp. Messages without a valid signature are ignored.</p>
            </Card>
            <Card className="p-5 sm:p-6">
              <h3 className="text-[15px] font-semibold">Connect it in 4 steps</h3>
              <ol className="mt-3 space-y-3 text-[13px] text-soft">
                <li><b className="text-ink">1.</b> In Meta for Developers, open your app and add the <b className="text-ink">WhatsApp</b> product.</li>
                <li><b className="text-ink">2.</b> Copy the phone number ID and a permanent access token into the form, then press <b className="text-ink">Save changes</b>.</li>
                <li><b className="text-ink">3.</b> In WhatsApp → Configuration, set the webhook to:<div className="mt-2"><CodeBlock code={hook} /></div></li>
                <li><b className="text-ink">4.</b> Use this verify token, then subscribe to <b className="text-ink">messages</b>:<div className="mt-2"><CodeBlock code={f.whatsapp.verify_token || 'Save changes to get your verify token'} /></div></li>
              </ol>
              <p className="mt-4 text-xs text-soft">Customers can write to you any time. WhatsApp only lets you reply for 24 hours after their last message.</p>
            </Card>
          </div>
        </TabPanel>
      </Tabs>
    </>
  )
}
