import * as React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, BookOpen, CheckCircle2, Code2, Coins, Key, MessageCircle, Sparkles, Terminal } from '@/components/icons'
import { Badge, Button, Card, Chip, Tab, TabPanel, Tabs, TabsList } from '@/components/ui'
import { CodeBlock, PageHeader } from '@/components/shared'
import { MeshBadge } from '@/layout/Shell'
import { http } from '@/lib/api/http'
import { API_URL } from '@/lib/api/env'
import { cn } from '@/lib/utils'

const fmt = (n: number, cur = 'INR', d = 2) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur, maximumFractionDigits: d }).format(n)
const base = () => (API_URL.startsWith('http') ? API_URL : `${window.location.origin}${API_URL}`)

/* ---------- Chat agents: coming soon ---------- */
export function ChatAgentsPage() {
  const items = [
    ['Answer on your website and WhatsApp', 'One agent, many channels, the same knowledge as your voice agents.'],
    ['Hand over to a person', 'Pass a chat to your team with the whole conversation attached.'],
    ['Book, look up and follow up', 'The same tools and integrations your voice agents already use.'],
  ]
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-11rem)] max-w-2xl flex-col items-center justify-center py-8 text-center">
      <MeshBadge className="h-16 w-16 rounded-full"><MessageCircle size={26} /></MeshBadge>
      <Badge className="mt-6">Coming soon</Badge>
      <h1 className="mt-4 text-[34px] font-semibold leading-tight tracking-[-0.03em]">Swarvo Chat Agents</h1>
      <p className="mt-3 max-w-lg text-[15px] text-soft">Everything your voice agents do, as text chat for your website and messaging apps. We are building it now.</p>
      <div className="mt-8 grid w-full gap-3 text-left sm:grid-cols-3">
        {items.map(([t, d]) => <Card key={t} className="p-4"><div className="text-[13.5px] font-semibold">{t}</div><div className="mt-1 text-xs leading-snug text-soft">{d}</div></Card>)}
      </div>
      <p className="mt-8 text-sm text-soft">Want early access? Write to us from the <Link to="/help" className="font-medium text-accent underline underline-offset-2">Help</Link> page.</p>
    </div>
  )
}

/* ---------- Swarvo API: overview ---------- */
export function ApiOverviewPage() {
  const [lang, setLang] = React.useState('curl')
  const sample = 'sk_live_xxxxxxxx'
  const code: Record<string, string> = {
    curl: `curl ${base()}/public/agents \\\n  -H "Authorization: Bearer ${sample}"`,
    node: `const res = await fetch('${base()}/public/agents', {\n  headers: { Authorization: 'Bearer ${sample}' },\n})\nconsole.log(await res.json())`,
    python: `import requests\n\nr = requests.get('${base()}/public/agents', headers={'Authorization': 'Bearer ${sample}'})\nprint(r.json())`,
  }
  const cards = [
    { to: '/developers', icon: Key, t: 'API keys and webhooks', d: 'Create keys, set up webhooks and see recent requests.' },
    { to: '/swarvo-api/docs', icon: BookOpen, t: 'Documentation', d: 'Every endpoint with an example you can copy.' },
    { to: '/swarvo-api/models', icon: Sparkles, t: 'Models', d: 'The AI models your agents can think with.' },
    { to: '/swarvo-api/pricing', icon: Coins, t: 'Pricing', d: 'Per-minute prices and how they drop as your wallet grows.' },
  ]
  return (
    <>
      <PageHeader title="Swarvo API" subtitle="Connect your own apps to your agents and calls." actions={<Link to="/developers"><Button variant="primary"><Key size={15} />Create an API key</Button></Link>} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.to} to={c.to} className="group rounded-2xl border bg-surface p-5 transition hover:bg-muted/40">
            <c.icon size={18} className="text-soft group-hover:text-ink" />
            <div className="mt-4 flex items-center gap-1.5 text-[14px] font-semibold">{c.t}<ArrowRight size={13} className="text-soft opacity-0 transition group-hover:opacity-100" /></div>
            <p className="mt-1 text-[13px] leading-snug text-soft">{c.d}</p>
          </Link>))}
      </div>
      <Card className="mt-6 p-6">
        <h3 className="text-[15px] font-semibold">Quick start</h3>
        <p className="mt-1 text-[13px] text-soft">Create a key on the API keys page, then send it as a bearer token. Keys made in Test mode only see your test agents and calls.</p>
        <Tabs value={lang} onValueChange={setLang} className="mt-4"><TabsList>{[['curl', 'cURL'], ['node', 'Node'], ['python', 'Python']].map(([v, l]) => <Tab key={v} value={v}>{l}</Tab>)}</TabsList>
          {Object.entries(code).map(([k, v]) => <TabPanel key={k} value={k}><CodeBlock code={v} /></TabPanel>)}</Tabs>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-soft">
          <span>Base address <code className="rounded bg-muted px-1.5 py-0.5 text-ink">{base()}</code></span>
          <span>Limit <b className="text-ink">120 requests a minute</b> per key</span>
        </div>
      </Card>
    </>
  )
}

/* ---------- Swarvo API: documentation ---------- */
const ENDPOINTS = [
  { m: 'GET', p: '/public/me', d: 'Which workspace and mode this key belongs to.', res: '{ "workspace": "ws_...", "environment": "live" }' },
  { m: 'GET', p: '/public/agents', d: 'The agents this key can see (live agents for a live key, test copies for a test key).', res: '[ { "id": "ag_...", "name": "Front desk", "status": "live" } ]' },
  { m: 'GET', p: '/public/calls', d: 'Calls, newest first.', q: 'page, limit (max 100), agent', res: '{ "calls": [ { "id": "cl_...", "caller": "Asha", "duration": 84, "outcome": "booked" } ], "total": 1, "page": 1, "limit": 25 }' },
  { m: 'GET', p: '/public/calls/{id}', d: 'One call with its transcript, summary and recording link.', res: '{ "id": "cl_...", "turns": [ ... ], "summary": "...", "audio_url": "..." }' },
]
export function ApiDocsPage() {
  const [open, setOpen] = React.useState(ENDPOINTS[0].p)
  return (
    <>
      <PageHeader title="Documentation" subtitle="Every endpoint, with an example." />
      <Card className="mb-4 p-5">
        <h3 className="text-[15px] font-semibold">Authentication</h3>
        <p className="mt-1 text-[13px] text-soft">Send your API key as a bearer token on every request. A key is read-only: it can look at agents and calls but cannot change anything or start calls.</p>
        <div className="mt-3"><CodeBlock code={`Authorization: Bearer sk_live_xxxxxxxx`} /></div>
        <p className="mt-3 text-[13px] text-soft">Errors come back as <code className="rounded bg-muted px-1.5 py-0.5 text-ink">{'{ "detail": { "code": "...", "message": "..." } }'}</code>. A bad key gives <b className="text-ink">401</b> and going over the limit gives <b className="text-ink">429</b>.</p>
      </Card>
      <div className="space-y-2">
        {ENDPOINTS.map((e) => (
          <Card key={e.p} className="overflow-hidden">
            <button className="flex w-full items-center gap-3 px-5 py-4 text-left" onClick={() => setOpen(open === e.p ? '' : e.p)}>
              <span className="rounded-md bg-ok/10 px-2 py-0.5 text-[11px] font-bold text-ok">{e.m}</span>
              <code className="text-[13.5px] font-medium">{e.p}</code><span className="ml-2 hidden truncate text-[13px] text-soft sm:block">{e.d}</span>
            </button>
            {open === e.p && (
              <div className="space-y-3 border-t px-5 py-4">
                <p className="text-[13px] text-soft">{e.d}</p>
                {e.q && <p className="text-[13px]"><span className="text-soft">Query: </span><code className="rounded bg-muted px-1.5 py-0.5">{e.q}</code></p>}
                <div><div className="mb-1.5 text-xs font-medium text-soft">Request</div><CodeBlock code={`curl ${base()}${e.p.replace('{id}', 'cl_123')} \\\n  -H "Authorization: Bearer sk_live_xxxxxxxx"`} /></div>
                <div><div className="mb-1.5 text-xs font-medium text-soft">Response</div><CodeBlock code={e.res} /></div>
              </div>)}
          </Card>))}
      </div>
      <Card className="mt-4 p-5">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold"><Terminal size={15} />Webhooks</h3>
        <p className="mt-1 text-[13px] text-soft">Get a signed message on your own server when a call ends or something needs attention. Set them up on the <Link to="/developers" className="font-medium text-accent underline underline-offset-2">API keys and webhooks</Link> page. Each message carries a signature header so you can check it came from us.</p>
      </Card>
    </>
  )
}

/* ---------- Swarvo API: models ---------- */
type Model = { id: string; label: string; level: string | null }
const LEVEL: Record<string, string> = { fast: 'Fastest replies', balanced: 'Balanced', smartest: 'Smartest' }
export function ApiModelsPage() {
  const q = useQuery({ queryKey: ['models'], queryFn: () => http<Model[]>('/agents/models') })
  const voices = useQuery({ queryKey: ['voices-count'], queryFn: () => http<{ id: string; language: string; provider: string }[]>('/voices') })
  const [f, setF] = React.useState<string>('all')
  const list = (q.data ?? []).filter((m) => f === 'all' || m.level === f)
  const engines = Object.entries((voices.data ?? []).reduce<Record<string, number>>((a, v) => ({ ...a, [v.provider]: (a[v.provider] ?? 0) + 1 }), {}))
  return (
    <>
      <PageHeader title="Models" subtitle="The AI models your agents can think with, and the voices they can speak in." />
      <div className="mb-4 flex flex-wrap gap-2">{[['all', 'All'], ['fast', 'Fast'], ['balanced', 'Balanced'], ['smartest', 'Smartest']].map(([k, l]) => <Chip key={k} active={f === k} onClick={() => setF(k)}>{l}</Chip>)}</div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm"><thead className="border-b"><tr>{['Model', 'Id', 'Best for'].map((h) => <th key={h} className="px-5 py-2.5 text-left text-xs font-medium text-soft">{h}</th>)}</tr></thead>
          <tbody>{q.isPending ? <tr><td className="px-5 py-8 text-soft" colSpan={3}>Loading…</td></tr> : list.length === 0 ? <tr><td className="px-5 py-8 text-center text-soft" colSpan={3}>No models match.</td></tr> : list.map((m) => (
            <tr key={m.id} className="border-b last:border-0 hover:bg-muted/30">
              <td className="px-5 py-3.5 font-medium">{m.label}</td>
              <td className="px-5 py-3.5"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{m.id}</code></td>
              <td className="px-5 py-3.5 text-soft">{m.level ? LEVEL[m.level] ?? m.level : 'Available on request'}</td>
            </tr>))}</tbody></table>
      </Card>
      <h3 className="mb-3 mt-8 text-[15px] font-semibold">Voices</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        {engines.map(([name, n]) => <Card key={name} className="p-4"><div className="text-[13.5px] font-semibold">{name}</div><div className="mt-1 text-xs text-soft">{n} voices</div></Card>)}
        <Link to="/voices" className="flex items-center justify-between rounded-2xl border bg-surface p-4 text-[13.5px] font-medium transition hover:bg-muted/40">Browse and play voices<ArrowRight size={14} /></Link>
      </div>
    </>
  )
}

/* ---------- Swarvo API: pricing ---------- */
type Price = { currency: string; slabs: { up_to: number; rate: number }[]; contact_sales_above: number; number_monthly_local: number; number_monthly_toll_free: number; signup_bonus: number; bonus_left: number }
export function ApiPricingPage() {
  const q = useQuery({ queryKey: ['pricing'], queryFn: () => http<Price>('/billing/pricing') })
  const p = q.data
  const rows = (p?.slabs ?? []).map((s, i, all) => ({ from: i === 0 ? 0 : all[i - 1].up_to, to: s.up_to, rate: s.rate, unlock: (i === 0 ? 0 : all[i - 1].up_to) * s.rate }))
  return (
    <>
      <PageHeader title="Pricing" subtitle="One price per minute. It covers the AI, the voice, the phone line, recordings and analytics." />
      {!p ? <Card className="p-8 text-sm text-soft">Loading…</Card> : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="p-5"><div className="text-[13px] text-soft">Starting price</div><div className="num mt-2 text-[28px] font-semibold leading-none">{fmt(rows[0]?.rate ?? 0, p.currency)}<span className="ml-1 text-sm font-normal text-soft">/ min</span></div><div className="mt-2 text-xs text-soft">Billed per minute, rounded up</div></Card>
            <Card className="p-5"><div className="text-[13px] text-soft">Best self-serve price</div><div className="num mt-2 text-[28px] font-semibold leading-none">{fmt(rows[rows.length - 1]?.rate ?? 0, p.currency)}<span className="ml-1 text-sm font-normal text-soft">/ min</span></div><div className="mt-2 text-xs text-soft">With {rows[rows.length - 1]?.from.toLocaleString('en-IN')}+ minutes in your wallet</div></Card>
            <Card className="p-5"><div className="text-[13px] text-soft">Phone number rent</div><div className="num mt-2 text-[28px] font-semibold leading-none">{p.number_monthly_local > 0 ? fmt(p.number_monthly_local, p.currency, 0) : 'On request'}<span className="ml-1 text-sm font-normal text-soft">{p.number_monthly_local > 0 ? '/ month' : ''}</span></div><div className="mt-2 text-xs text-soft">Billed separately from calls</div></Card>
          </div>
          <Card className="mt-4 overflow-hidden">
            <div className="border-b px-5 py-4"><h3 className="text-[15px] font-semibold">Price steps</h3><p className="mt-0.5 text-[13px] text-soft">The more minutes your wallet holds, the lower your price. A price you have reached is kept.</p></div>
            <table className="w-full text-sm"><thead className="border-b"><tr>{['Minutes in your wallet', 'Wallet balance needed', 'Price per minute'].map((h, i) => <th key={h} className={cn('px-5 py-2.5 text-xs font-medium text-soft', i === 2 ? 'text-right' : 'text-left')}>{h}</th>)}</tr></thead>
              <tbody>{rows.map((r) => <tr key={r.to} className="border-b last:border-0 hover:bg-muted/30"><td className="num px-5 py-3.5">{r.from.toLocaleString('en-IN')} to {r.to.toLocaleString('en-IN')}</td><td className="num px-5 py-3.5 text-soft">{r.unlock > 0 ? fmt(r.unlock, p.currency, 0) : 'Any amount'}</td><td className="num px-5 py-3.5 text-right font-semibold">{fmt(r.rate, p.currency)}</td></tr>)}</tbody></table>
            <p className="border-t px-5 py-3 text-xs text-soft">More than {p.contact_sales_above.toLocaleString('en-IN')} minutes in your wallet? Talk to us for enterprise pricing.</p>
          </Card>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Card className="p-5"><h3 className="text-[15px] font-semibold">What is included</h3>
              <ul className="mt-3 grid gap-2 text-sm">{['The AI that talks and thinks', 'The voice and speech recognition', 'The phone line for the call', 'Recordings, transcripts and analytics'].map((x) => <li key={x} className="flex items-center gap-2.5"><CheckCircle2 size={15} className="text-ok" />{x}</li>)}</ul></Card>
            <Card className="p-5"><h3 className="text-[15px] font-semibold">Good to know</h3>
              <ul className="mt-3 space-y-2 text-sm text-soft"><li>A call that never connects is free.</li><li>Practice calls from the browser cost the same per minute.</li>{p.signup_bonus > 0 && p.bonus_left > 0 && <li>New accounts get <b className="text-ink">{fmt(p.signup_bonus, p.currency, 0)}</b> to start, for the first 1,000 accounts.</li>}<li>Add money any time on the <Link to="/billing" className="font-medium text-accent underline underline-offset-2">Billing</Link> page.</li></ul></Card>
          </div>
        </>)}
      <p className="mt-6 flex items-center gap-1.5 text-xs text-soft"><Code2 size={12} />Prices are in {p?.currency ?? 'INR'} and may change; the price on your Billing page is what you are charged.</p>
    </>
  )
}
