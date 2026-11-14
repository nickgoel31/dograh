import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ArrowUp, BarChart3, BookOpen, Bot, Check, FileText, History, Loader2, Megaphone, Mic, Phone, Search, SquarePen, Sparkles, Trash2, Wallet, X } from '@/components/icons'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui'
import { AgentAvatar } from '@/components/AgentAvatar'
import { MeshBadge, Rich } from '@/layout/Shell'
import { http } from '@/lib/api/http'
import { USE_MOCKS } from '@/lib/api/env'
import { agentsApi, toAgent } from '@/lib/api/agents'
import { useMe } from '@/lib/useMe'
import { useData } from '@/store/data'
import { useUI } from '@/store/ui'
import { loadSetup } from '@/components/GetStarted'
import SetupFlow from '@/components/SetupFlow'
import { cn } from '@/lib/utils'

type Call = { id: string; tool: string; kind: 'read' | 'write' | 'ui' | 'auto'; args: Record<string, any> }
type Built = { agent: { id: string; name: string; role: string; status: string; voice: string | null; languages: string[]; number: string | null }; steps: { id: string; label: string; status: string; note: string | null }[]; tools: { key: string; why: string; connected: boolean }[] }
type Item =
  | { k: 'user'; text: string }
  | { k: 'ai'; text: string }
  | { k: 'built'; data: Built }
  | { k: 'plan'; call: Call; status: 'pending' | 'running' | 'done' | 'skipped' | 'failed'; note?: string; link?: string }
type Msg = { role: 'user' | 'assistant'; content: string }

const PAGES = ['/', '/agents', '/conversations', '/contacts', '/numbers', '/campaigns', '/knowledge', '/tools', '/voices', '/analytics', '/billing', '/settings', '/developers', '/help']

const SUGGESTIONS = [
  { icon: Phone, title: 'Review my numbers', text: 'See which agent answers each number', prompt: 'Show me my phone numbers and which agent answers each one.' },
  { icon: BarChart3, title: 'How are calls going?', text: 'Summarize my recent conversations', prompt: 'Summarize my recent calls and tell me what stands out.' },
  { icon: BookOpen, title: 'Teach my agent', text: 'Add answers to frequently asked questions', prompt: 'I want to add frequently asked questions and answers to my knowledge. Help me do that.' },
  { icon: Megaphone, title: 'My campaigns', text: 'Check progress of outbound calling', prompt: 'How are my campaigns doing?' },
  { icon: Wallet, title: 'Balance and minutes', text: 'See what is left in my wallet', prompt: 'How much balance and how many minutes do I have left?' },
  { icon: FileText, title: 'Browse templates', text: 'Start from an industry template', prompt: '', go: '/agents/templates' },
]
const GUIDE_STEPS = ['Your website', 'Knowledge', 'The agent', 'Voice', 'Phone number']
const WANTS_AGENT = /\b(create|build|make|set ?up|start|need)\b.{0,24}\b(agent|assistant|bot|receptionist)\b/i

const LABEL: Record<string, string> = {
  list_agents: 'Looking at your agents', list_templates: 'Looking at agent templates', list_numbers: 'Looking at your phone numbers', list_contacts: 'Looking at your contacts',
  list_conversations: 'Looking at your recent calls', list_campaigns: 'Looking at your campaigns', list_knowledge: 'Looking at your knowledge', list_integrations: 'Looking at your integrations',
  setup_agent: 'Setting up your agent', get_wallet: 'Checking your wallet', go_to: 'Opening a page', create_agent: 'Create an agent', update_agent: 'Change an agent', publish_agent: 'Publish an agent live',
  assign_number: 'Assign a phone number', block_numbers: 'Add to the do-not-call list', add_knowledge_text: 'Add a note to knowledge', add_knowledge_qa: 'Add questions and answers',
}

const short = (v: unknown) => { const t = typeof v === 'string' ? v : JSON.stringify(v); return t.length > 140 ? t.slice(0, 140) + '…' : t }
const clip = (v: unknown) => { const t = JSON.stringify(v ?? null); return t.length > 3500 ? t.slice(0, 3500) + '…(cut)' : t }

async function execute(c: Call, nav: (to: string) => void): Promise<{ result: unknown; link?: string; built?: Built }> {
  const a = c.args
  const id = (x: unknown) => encodeURIComponent(String(x ?? ''))
  switch (c.tool) {
    case 'list_agents': return { result: (await http<any[]>('/agents')).map((x) => ({ id: x.id, name: x.name, status: x.status, role: x.role })) }
    case 'list_templates': return { result: (await http<any[]>('/agents/templates')).map((x) => ({ key: x.key, name: x.name, role: x.role, blurb: x.blurb })) }
    case 'list_numbers': return { result: await http('/numbers') }
    case 'list_contacts': return { result: await http(`/contacts?limit=25${a.q ? `&q=${encodeURIComponent(String(a.q))}` : ''}`) }
    case 'list_conversations': return { result: await http('/conversations') }
    case 'list_campaigns': return { result: await http('/campaigns') }
    case 'list_knowledge': return { result: await http('/knowledge') }
    case 'list_integrations': return { result: await http('/connectors') }
    case 'get_wallet': return { result: await http('/billing/wallet') }
    case 'go_to': {
      const p = String(a.path ?? '')
      if (!PAGES.includes(p) && !/^\/agents\/[\w-]+$/.test(p)) throw new Error('That page does not exist.')
      nav(p); return { result: { opened: p } }
    }
    case 'setup_agent': {
      const r = await http<Built>('/assistant/setup/auto', { method: 'POST', json: { text: String(a.text ?? '').slice(0, 4000) }, timeoutMs: 180000 })
      return { result: { agent: r.agent, steps: r.steps.map((x) => `${x.status}: ${x.label}`) }, link: `/agents/${r.agent.id}`, built: r }
    }
    case 'create_agent': {
      const made = await http<any>('/agents', { method: 'POST', json: { name: a.name, template: a.template ?? null, business: a.business ?? '', what_you_do: a.what_you_do ?? '', script: a.script ?? '', tone: a.tone ?? null } })
      return { result: { id: made.id, name: made.name }, link: `/agents/${made.id}` }
    }
    case 'update_agent': {
      const { agent_id, ...rest } = a
      const patch: Record<string, unknown> = {}
      for (const k of ['name', 'business', 'what_you_do', 'script', 'tone']) if (rest[k] !== undefined) patch[k] = rest[k]
      const r = await http<any>(`/agents/${id(agent_id)}`, { method: 'PATCH', json: patch })
      return { result: { id: r.id, name: r.name }, link: `/agents/${r.id}` }
    }
    case 'publish_agent': { const r = await http<any>(`/agents/${id(a.agent_id)}/publish`, { method: 'POST' }); return { result: { id: r.id, status: r.status }, link: `/agents/${r.id}` } }
    case 'assign_number': return { result: await http(`/numbers/${id(a.number_id)}/assign`, { method: 'POST', json: { agent_id: a.agent_id ?? null } }), link: '/numbers' }
    case 'block_numbers': return { result: await http('/contacts/blocked', { method: 'POST', json: { numbers: String(a.numbers ?? '') } }), link: '/contacts' }
    case 'add_knowledge_text': return { result: await http('/knowledge/text', { method: 'POST', json: { title: a.title, text: a.text } }), link: '/knowledge' }
    case 'add_knowledge_qa': return { result: await http('/knowledge/qa', { method: 'POST', json: { title: a.title, pairs: a.pairs } }), link: '/knowledge' }
    default: throw new Error('I cannot do that yet.')
  }
}

type Saved = { id: string; title: string; updated: number; items: Item[]; history: Msg[] }
const KEY = (ws: string) => `swarvo-chats:${ws || 'default'}`
const readChats = (ws: string): Saved[] => { try { return JSON.parse(localStorage.getItem(KEY(ws)) || '[]') } catch { return [] } }
const writeChats = (ws: string, list: Saved[]) => { try { localStorage.setItem(KEY(ws), JSON.stringify(list.slice(0, 40))) } catch { /* storage full or blocked: history just is not kept */ } }
const bucket = (t: number) => { const d = (Date.now() - t) / 864e5; return d < 1 ? 'Today' : d < 2 ? 'Yesterday' : d < 8 ? 'This week' : 'Earlier' }

const ago = (t: number) => { const m = Math.max(1, Math.round((Date.now() - t) / 6e4)); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago` }

const refreshAgents = async () => { try { useData.getState().setAgents((await agentsApi.list()).map((x) => toAgent(x))) } catch { /* the Agents page reloads on its own */ } }

/** What autopilot did, step by step, with the next things to do. */
function BuiltCard({ data, nav }: { data: Built; nav: (to: string) => void }) {
  const set = useUI((u) => u.set)
  const a = data.agent
  const todo = data.tools.filter((t) => !t.connected)
  return (
    <div className="ml-10 rounded-2xl border bg-surface p-4 animate-fade-in sm:p-5">
      <div className="flex items-center gap-3">
        <AgentAvatar id={a.id} className="h-11 w-11"><Bot size={19} /></AgentAvatar>
        <div className="min-w-0 flex-1"><div className="truncate text-[15px] font-semibold">{a.name}</div><div className="truncate text-[13px] text-soft">{a.role}</div></div>
        <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-semibold', a.status === 'live' ? 'bg-ok/10 text-ok' : 'bg-muted text-soft')}>{a.status === 'live' ? 'Live' : 'Draft'}</span>
      </div>
      <ul className="mt-4 space-y-2">{data.steps.map((x) => (
        <li key={x.id} className="flex items-start gap-2.5 text-[13.5px]">
          <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full', x.status === 'ok' ? 'bg-ok/15 text-ok' : x.status === 'fail' ? 'bg-bad/15 text-bad' : 'bg-muted text-soft')}>{x.status === 'ok' ? <Check size={12} /> : x.status === 'fail' ? <X size={12} /> : <span className="h-1.5 w-1.5 rounded-full bg-soft" />}</span>
          <span className={cn(x.status !== 'ok' && 'text-soft')}>{x.label}{x.note && <span className="block text-xs">{x.note}</span>}</span>
        </li>))}</ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={() => set({ playground: a.id })}><Mic size={14} />Talk to {a.name}</Button>
        <Button size="sm" onClick={() => nav(`/agents/${a.id}`)}>Open it</Button>
        {todo.length > 0 && <Button size="sm" variant="ghost" onClick={() => nav('/tools')}>Connect {todo.slice(0, 2).map((t) => t.key.replace(/_/g, ' ')).join(' or ')}</Button>}
      </div>
    </div>
  )
}

export default function AssistantHome() {
  const nav = useNavigate()
  const qc = useQueryClient()
  const me = useMe().data
  const name = me?.user.name?.split(' ')[0]
  const [items, setItems] = React.useState<Item[]>([])
  const [text, setText] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const history = React.useRef<Msg[]>([])
  const batch = React.useRef<{ waiting: Set<string>; results: string[] }>({ waiting: new Set(), results: [] })
  const round = React.useRef(0)
  const end = React.useRef<HTMLDivElement>(null)
  const chatting = items.length > 0
  const ws = useUI((u) => u.workspaceId) ?? ''
  const agents = useData((u) => u.agents)
  const [rq, setRq] = React.useState('')
  const chatId = React.useRef(Math.random().toString(36).slice(2, 10))
  const [saved, setSaved] = React.useState<Saved[]>(() => readChats(ws))
  const [open, setOpen] = React.useState(false)
  const [guided, setGuided] = React.useState(false)
  const [find, setFind] = React.useState('')
  const panel = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => { setSaved(readChats(ws)) }, [ws])
  React.useEffect(() => {
    if (!items.length) return
    const first = items.find((x) => x.k === 'user') as { text: string } | undefined
    const now: Saved = { id: chatId.current, title: (first?.text ?? 'New chat').slice(0, 60), updated: Date.now(), items, history: history.current }
    const list = [now, ...readChats(ws).filter((c) => c.id !== now.id)]
    writeChats(ws, list); setSaved(list)
  }, [items, ws])
  React.useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (!panel.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [open])
  const fresh = () => { chatId.current = Math.random().toString(36).slice(2, 10); history.current = []; batch.current = { waiting: new Set(), results: [] }; round.current = 0; setItems([]); setText(''); setOpen(false) }
  const load = (c: Saved) => {
    if (busy) return
    chatId.current = c.id; history.current = c.history; batch.current = { waiting: new Set(), results: [] }; round.current = 0
    // a question that was still waiting for a yes can no longer be answered, so show it as skipped
    setItems(c.items.map((x) => (x.k === 'plan' && (x.status === 'pending' || x.status === 'running') ? { ...x, status: 'skipped' as const } : x)))
    setOpen(false)
  }
  const forget = (id: string) => { const list = readChats(ws).filter((c) => c.id !== id); writeChats(ws, list); setSaved(list); if (id === chatId.current) fresh() }

  React.useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [items, busy])

  React.useEffect(() => {
    let asked: string | null = null
    try { asked = sessionStorage.getItem('assistant-prompt'); sessionStorage.removeItem('assistant-prompt') } catch { /* no storage */ }
    if (asked) void send(asked)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const patch = (id: string, p: Partial<Extract<Item, { k: 'plan' }>>) => setItems((xs) => xs.map((x) => (x.k === 'plan' && x.call.id === id ? { ...x, ...p } : x)))

  const think = async () => {
    setBusy(true)
    try {
      const out = await http<{ reply: string; calls: Call[] }>('/assistant/plan', { method: 'POST', json: { messages: history.current.slice(-24), page: '/' } })
      const calls = out.calls
      history.current.push({ role: 'assistant', content: (out.reply || '') + (calls.length ? `\n[I called: ${calls.map((c) => c.tool).join(', ')}]` : '') })
      if (out.reply) setItems((xs) => [...xs, { k: 'ai', text: out.reply }])
      if (!calls.length) return
      batch.current = { waiting: new Set(), results: [] }
      for (const c of calls) {
        if (c.kind === 'write') { batch.current.waiting.add(c.id); setItems((xs) => [...xs, { k: 'plan', call: c, status: 'pending' }]) }
      }
      for (const c of calls.filter((x) => x.kind !== 'write')) {
        setItems((xs) => [...xs, { k: 'plan', call: c, status: 'running' }])
        try { const r = await execute(c, nav); patch(c.id, { status: 'done' }); batch.current.results.push(`${c.tool}: ${clip(r.result)}`); if (r.built) { setItems((xs) => [...xs, { k: 'built', data: r.built! }]); void refreshAgents() } }
        catch (e) { patch(c.id, { status: 'failed', note: e instanceof Error ? e.message : 'Failed' }); batch.current.results.push(`${c.tool}: failed, ${e instanceof Error ? e.message : 'error'}`) }
      }
      if (batch.current.waiting.size === 0 && batch.current.results.length && calls.some((c) => c.kind === 'read' || c.kind === 'auto') && round.current < 5) { await feed() }
    } catch (e) {
      setItems((xs) => [...xs, { k: 'ai', text: e instanceof Error ? e.message : 'Something went wrong. Please try again.' }])
    } finally { setBusy(false) }
  }

  const feed = async () => {
    history.current.push({ role: 'user', content: `TOOL RESULTS\n${batch.current.results.join('\n')}` })
    batch.current.results = []
    round.current += 1
    await think()
  }

  const send = async (t: string) => {
    const msg = t.trim()
    if (!msg || busy) return
    if (!USE_MOCKS && !items.length && WANTS_AGENT.test(msg)) { setText(''); setGuided(true); return } // "create an agent" starts the step-by-step setup
    setText('')
    round.current = 0
    history.current.push({ role: 'user', content: msg.slice(0, 2000) })
    setItems((xs) => [...xs, { k: 'user', text: msg }])
    await think()
  }

  const decide = async (c: Call, yes: boolean) => {
    if (busy) return
    if (yes) {
      patch(c.id, { status: 'running' })
      try {
        const r = await execute(c, nav)
        patch(c.id, { status: 'done', link: r.link }); batch.current.results.push(`${c.tool}: done ${clip(r.result)}`)
        void qc.invalidateQueries(); void refreshAgents()
      } catch (e) { patch(c.id, { status: 'failed', note: e instanceof Error ? e.message : 'Failed' }); batch.current.results.push(`${c.tool}: failed, ${e instanceof Error ? e.message : 'error'}`) }
    } else { patch(c.id, { status: 'skipped' }); batch.current.results.push(`${c.tool}: the person chose not to do this`) }
    batch.current.waiting.delete(c.id)
    if (batch.current.waiting.size === 0) { setBusy(true); try { await feed() } finally { setBusy(false) } }
  }

  const composer = (
    <div className="group relative isolate overflow-hidden rounded-2xl border bg-surface p-3 transition focus-within:border-soft/50">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-0 transition-opacity duration-700 group-focus-within:opacity-100">
        <div className="absolute bottom-0 left-1/2 h-[55%] w-[70%] -translate-x-1/2 translate-y-[70%] scale-x-75 transition-transform duration-[900ms] ease-out group-focus-within:translate-y-[22%] group-focus-within:scale-x-100">
          <div className="h-full w-full blur-[20px]">
            <div className="h-full w-full animate-glow bg-[linear-gradient(to_top,rgba(34,211,238,.3),rgba(99,102,241,.14)_55%,transparent_92%)] [clip-path:polygon(50%_0,100%_100%,0_100%)]" />
          </div>
        </div>
      </div>
      <textarea value={text} rows={chatting ? 1 : 2} onChange={(e) => setText(e.target.value)} placeholder="Ask me to build an agent, check your calls, add knowledge…"
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text) } }}
        className="block max-h-40 w-full resize-none bg-transparent px-1.5 py-1 text-[15px] outline-none placeholder:text-soft/70" aria-label="Message" />
      <div className="mt-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 px-1.5 text-xs text-soft"><Check size={12} />Changes always ask you first</span>
        <button onClick={() => void send(text)} disabled={!text.trim() || busy} aria-label="Send"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-surface transition hover:scale-105 disabled:scale-100 disabled:opacity-30"><ArrowUp size={17} /></button>
      </div>
    </div>
  )

  const bar = (
    <div ref={panel} className="absolute right-0 top-0 z-20">
      <div className="flex items-center gap-1.5">
        {chatting && <button onClick={fresh} title="New chat" aria-label="New chat" className="flex h-9 w-9 items-center justify-center rounded-full border bg-surface text-soft transition hover:bg-muted hover:text-ink"><SquarePen size={16} strokeWidth={1.75} /></button>}
        <button onClick={() => setOpen((o) => !o)} title="Chat history" aria-label="Chat history" aria-expanded={open} className={cn('flex h-9 w-9 items-center justify-center rounded-full border bg-surface text-soft transition hover:bg-muted hover:text-ink', open && 'bg-muted text-ink')}><History size={16} strokeWidth={1.75} /></button>
      </div>
      {open && (
        <div className="absolute right-0 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border bg-surface shadow-[0_18px_50px_-18px_hsl(var(--shadow)/.35)] animate-fade-in">
          <div className="flex items-center gap-2 border-b px-3 py-2.5">
            <Search size={14} className="text-soft" />
            <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search chats" aria-label="Search chats" autoFocus className="w-full bg-transparent text-sm outline-none placeholder:text-soft/70" />
            <button onClick={fresh} className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-accent hover:bg-muted"><SquarePen size={13} />New</button>
          </div>
          <div className="max-h-[55vh] overflow-y-auto p-1.5">
            {(() => {
              const list = saved.filter((c) => c.title.toLowerCase().includes(find.toLowerCase()))
              if (!list.length) return <p className="px-3 py-8 text-center text-sm text-soft">{saved.length ? 'No chats match.' : 'Your past chats will show up here.'}</p>
              let last = ''
              return list.map((c) => {
                const b = bucket(c.updated)
                const head = b !== last ? <div className="px-3 pb-1 pt-3 text-[11px] font-medium text-soft/70">{b}</div> : null
                last = b
                return (
                  <React.Fragment key={c.id}>{head}
                    <div className={cn('group flex items-center gap-1 rounded-lg transition hover:bg-muted', c.id === chatId.current && 'bg-muted')}>
                      <button onClick={() => load(c)} className="min-w-0 flex-1 truncate px-3 py-2 text-left text-[13.5px]">{c.title}</button>
                      <button onClick={() => forget(c.id)} aria-label="Delete chat" className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-soft opacity-0 transition hover:text-bad focus-visible:opacity-100 group-hover:opacity-100"><Trash2 size={14} /></button>
                    </div>
                  </React.Fragment>
                )
              })
            })()}
          </div>
        </div>
      )}
    </div>
  )

  if (guided) return <div className="relative">{bar}<div className="pt-10"><SetupFlow onExit={() => setGuided(false)} /></div></div>

  if (!chatting) {
    const live = agents.filter((a) => a.status === 'live').length
    const started = !USE_MOCKS && me?.user.id ? loadSetup(me.user.id) : null
    return (
      <div className="relative mx-auto flex min-h-[calc(100dvh-11rem)] max-w-3xl flex-col items-center py-8 sm:py-12">
        {bar}
        <div className="relative">
          <div aria-hidden className="absolute -inset-5 rounded-full bg-[radial-gradient(circle,rgba(99,102,241,.22),transparent_70%)] blur-xl" />
          <MeshBadge className="relative h-16 w-16 rounded-[22px]"><Sparkles size={26} /></MeshBadge>
        </div>
        <h1 className="mt-6 text-center text-[32px] font-semibold leading-[1.1] tracking-[-0.035em] sm:text-[42px]">{name ? <>Hi {name}, what should<br className="hidden sm:block" /> we set up?</> : 'What should we set up?'}</h1>
        <p className="mt-3 max-w-md text-center text-[15px] leading-relaxed text-soft">I can build agents, manage numbers, contacts, calls, campaigns and knowledge for you.</p>
        {agents.length > 0 && <div className="mt-4 flex items-center gap-2 text-xs text-soft"><span className="h-1.5 w-1.5 rounded-full bg-ok" />{agents.length} {agents.length === 1 ? 'agent' : 'agents'}{live > 0 ? `, ${live} live` : ', none live yet'}</div>}
        <div className="mt-8 w-full">{composer}</div>

        {!USE_MOCKS && (
          <button onClick={() => setGuided(true)} className="group relative mt-4 w-full overflow-hidden rounded-2xl border bg-surface p-5 text-left transition hover:border-accent/50 sm:p-6">
            <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[radial-gradient(circle,rgba(34,211,238,.2),transparent_70%)] transition group-hover:scale-125" />
            <div className="relative flex items-start gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><Bot size={21} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="text-[15.5px] font-semibold">{started && started.step > 0 && !started.finished ? 'Set up an agent with me' : agents.length > 0 ? 'Add another agent' : 'Set up your first agent'}</span><span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">Guided</span></div>
                <p className="mt-1 text-[13.5px] leading-relaxed text-soft">{agents.length > 0 ? 'I already know your business. Pick what it should do and I will set up the rest.' : "Paste your website. I'll learn what you do, write the agent, pick a voice, add knowledge and connect a number."}</p>
                <ol className="mt-3.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-soft">{GUIDE_STEPS.map((g, i) => <React.Fragment key={g}><li className="flex items-center gap-1.5"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-ink">{i + 1}</span>{g}</li>{i < GUIDE_STEPS.length - 1 && <ArrowRight size={11} className="text-soft/50" />}</React.Fragment>)}</ol>
              </div>
              <ArrowRight size={18} className="mt-3 hidden shrink-0 text-soft transition group-hover:translate-x-1 group-hover:text-ink sm:block" />
            </div>
          </button>
        )}

        <div className="mt-4 grid w-full gap-3 sm:grid-cols-3">
          {SUGGESTIONS.map((s) => (
            <button key={s.title} onClick={() => ('go' in s && s.go ? nav(s.go) : void send(s.prompt))} className="group flex items-start gap-3 rounded-2xl border bg-surface p-4 text-left transition hover:-translate-y-0.5 hover:border-soft/40 hover:shadow-[0_10px_30px_-16px_hsl(var(--shadow)/.4)]">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-soft transition group-hover:bg-accent-soft group-hover:text-accent"><s.icon size={17} strokeWidth={1.75} /></span>
              <span className="min-w-0"><span className="block text-[13.5px] font-semibold">{s.title}</span><span className="mt-0.5 block text-xs leading-snug text-soft">{s.text}</span></span>
            </button>
          ))}
        </div>
        {!USE_MOCKS && me?.user.id && !(started?.finished && agents.length > 0) && <button onClick={() => useUI.getState().set({ guide: true })} className="mt-5 inline-flex items-center gap-1.5 text-xs text-soft underline-offset-2 transition hover:text-ink hover:underline"><Mic size={12} />Prefer a quick 3-minute tour instead?</button>}

        {(saved.length > 0 || agents.length > 0) && (
          <div className="mt-10 w-full">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[15px] font-semibold">Recents</h2>
              <div className="flex h-9 w-52 items-center gap-2 rounded-full border bg-surface px-3 text-sm text-soft transition focus-within:border-soft/50"><Search size={14} /><input value={rq} onChange={(e) => setRq(e.target.value)} placeholder="Search" aria-label="Search recents" className="w-full bg-transparent text-ink outline-none placeholder:text-soft/70" /></div>
            </div>
            <div className="mt-3 overflow-hidden rounded-2xl border bg-surface">
              {(() => {
                const q = rq.toLowerCase()
                const rows = [
                  ...saved.map((c) => ({ key: 'c' + c.id, title: c.title, sub: 'Chat', when: ago(c.updated), icon: History, agent: undefined as (typeof agents)[number] | undefined, go: () => load(c), t: c.updated, status: '' })),
                  ...agents.map((a) => ({ key: 'a' + a.id, title: a.name, sub: a.role || 'Agent', when: '', icon: Bot, agent: a, go: () => nav(`/agents/${a.id}`), t: 0, status: a.status })),
                ].filter((r) => r.title.toLowerCase().includes(q)).sort((x, y) => y.t - x.t).slice(0, 6)
                if (!rows.length) return <p className="px-4 py-8 text-center text-sm text-soft">Nothing matches.</p>
                return rows.map((r) => (
                  <button key={r.key} onClick={r.go} className="flex w-full items-center gap-3 border-b px-4 py-3 text-left transition last:border-0 hover:bg-muted/50">
                    {r.agent ? <AgentAvatar id={r.agent.id} emoji={r.agent.emoji} className="h-9 w-9" size={16} /> : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-soft"><r.icon size={15} /></span>}
                    <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] font-medium">{r.title}</span><span className="block truncate text-xs text-soft">{r.sub}</span></span>
                    {r.status ? <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium capitalize', r.status === 'live' ? 'bg-ok/10 text-ok' : 'bg-muted text-soft')}>{r.status}</span> : <span className="text-xs text-soft">{r.when}</span>}
                  </button>
                ))
              })()}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="relative mx-auto flex min-h-[calc(100dvh-11rem)] max-w-3xl flex-col">
      {bar}
      <div className="flex-1 space-y-4 pb-6 pt-11">
        {items.map((it, i) => it.k === 'user' ? (
          <div key={i} className="flex justify-end"><div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-[14.5px]">{it.text}</div></div>
        ) : it.k === 'ai' ? (
          <div key={i} className="flex gap-3">
            <MeshBadge className="mt-0.5 h-7 w-7 rounded-lg"><Sparkles size={13} /></MeshBadge>
            <div className="min-w-0 flex-1 whitespace-pre-wrap pt-0.5 text-[14.5px] leading-relaxed"><Rich text={it.text} go={nav} /></div>
          </div>
        ) : it.k === 'built' ? (
          <BuiltCard key={i} data={it.data} nav={nav} />
        ) : it.call.kind === 'write' ? (
          <div key={i} className="ml-10 rounded-xl border bg-surface p-4">
            <div className="text-[13.5px] font-semibold">{LABEL[it.call.tool] ?? it.call.tool}</div>
            <dl className="mt-2 space-y-1 text-[12.5px]">{Object.entries(it.call.args).map(([k, v]) => <div key={k} className="flex gap-2"><dt className="w-24 shrink-0 text-soft">{k.replace(/_/g, ' ')}</dt><dd className="min-w-0 break-words">{short(v)}</dd></div>)}</dl>
            <div className="mt-3 flex items-center gap-2">
              {it.status === 'pending' && <><Button size="sm" variant="primary" disabled={busy} onClick={() => void decide(it.call, true)}><Check size={14} />Do it</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void decide(it.call, false)}>Skip</Button></>}
              {it.status === 'running' && <span className="flex items-center gap-2 text-xs text-soft"><Loader2 size={14} className="animate-spin" />Working…</span>}
              {it.status === 'done' && <span className="flex items-center gap-2 text-xs font-medium text-ok"><Check size={14} />Done{it.link && <button className="ml-2 font-semibold text-accent underline underline-offset-2" onClick={() => nav(it.link!)}>Open</button>}</span>}
              {it.status === 'skipped' && <span className="text-xs text-soft">Skipped</span>}
              {it.status === 'failed' && <span className="flex items-center gap-1.5 text-xs text-bad"><X size={14} />{it.note}</span>}
            </div>
          </div>
        ) : (
          <div key={i} className="ml-10 flex items-center gap-2 text-xs text-soft">
            {it.status === 'running' ? <Loader2 size={12} className="animate-spin" /> : it.status === 'failed' ? <X size={12} className="text-bad" /> : <Check size={12} />}
            {LABEL[it.call.tool] ?? it.call.tool}{it.status === 'failed' && it.note ? `: ${it.note}` : ''}
          </div>
        ))}
        {busy && <div className="ml-10 flex gap-1" aria-label="Thinking">{[0, 1, 2].map((d) => <span key={d} className={cn('h-1.5 w-1.5 animate-pulse rounded-full bg-soft/60')} style={{ animationDelay: `${d * 150}ms` }} />)}</div>}
        <div ref={end} />
      </div>
      <div className="sticky bottom-0 -mx-1 bg-gradient-to-t from-surface via-surface to-transparent px-1 pb-4 pt-6">{composer}</div>
    </div>
  )
}
