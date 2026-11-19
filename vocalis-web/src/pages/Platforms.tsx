import * as React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, BookOpen, CheckCircle2, Code2, Coins, Key, MessageCircle, Mic, Sparkles, Terminal } from '@/components/icons'
import { Badge, Button, Card, Chip, Select, Slider, Tab, TabPanel, Tabs, TabsList, Textarea } from '@/components/ui'
import { toast } from 'sonner'
import { CodeBlock, PageHeader } from '@/components/shared'
import { MeshBadge } from '@/layout/Shell'
import { http } from '@/lib/api/http'
import { API_URL } from '@/lib/api/env'
import { cn } from '@/lib/utils'

const fmt = (n: number, cur = 'INR', d = 2) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur, maximumFractionDigits: d }).format(n)
/** Swarvo TTS 3 price steps by minutes of speech a month. Change them here. */
const TTS_STEPS = [
  { from: 0, to: 1000, rate: 2.0 }, { from: 1000, to: 5000, rate: 1.6 }, { from: 5000, to: 15000, rate: 1.3 },
  { from: 15000, to: 50000, rate: 1.0 }, { from: 50000, to: Infinity, rate: 0.8 },
]
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
    { to: 'https://docs.swarvoai.com', icon: BookOpen, t: 'Documentation', d: 'Every endpoint with an example you can copy.' },
    { to: '/swarvo-api/playground', icon: Mic, t: 'Playground', d: 'Type text and hear it in Swarvo TTS 3.' },
    { to: '/swarvo-api/models', icon: Sparkles, t: 'Models', d: 'Swarvo TTS 3, our own text to speech model.' },
    { to: '/swarvo-api/pricing', icon: Coins, t: 'Pricing', d: 'Prices for voice agents and for Swarvo TTS 3.' },
  ]
  return (
    <>
      <PageHeader title="Swarvo API" subtitle="Connect your own apps to your agents and calls." actions={<Link to="/developers"><Button variant="primary"><Key size={15} />Create an API key</Button></Link>} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.to} to={c.to} {...(c.to.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className="group rounded-2xl border bg-surface p-5 transition hover:bg-muted/40">
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

/* ---------- Swarvo API: TTS playground ---------- */
type TtsInfo = { available: boolean; voices: { name: string; gender: string | null }[]; languages: { code: string; name: string }[]; max_chars: number }
const SAMPLES: Record<string, string> = {
  hi: 'नमस्ते! मैं आपकी कैसे मदद कर सकती हूँ? बताइए, आपको किस चीज़ की जानकारी चाहिए?',
  en: 'Hello! Thanks for calling. How can I help you today?',
}
export function ApiPlaygroundPage() {
  const info = useQuery({ queryKey: ['tts-info'], queryFn: () => http<TtsInfo>('/swarvo-api/tts/voices') })
  const [text, setText] = React.useState(SAMPLES.hi)
  const [voice, setVoice] = React.useState('')
  const [lang, setLang] = React.useState('hi')
  const [mode, setMode] = React.useState<'chat' | 'read'>('chat')
  const [speed, setSpeed] = React.useState(100)
  const [busy, setBusy] = React.useState(false)
  const [url, setUrl] = React.useState<string | null>(null)
  const audio = React.useRef<HTMLAudioElement>(null)
  const d = info.data
  const chosen = voice || d?.voices[0]?.name || ''
  React.useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  const run = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      const blob = await http<Blob>('/swarvo-api/tts', { method: 'POST', json: { text, voice: chosen, lang, mode, speed: speed / 100 }, blob: true, timeoutMs: 120000 })
      const u = URL.createObjectURL(blob)
      setUrl(u)
      setTimeout(() => audio.current?.play().catch(() => {}), 50)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'We could not make that audio.') } finally { setBusy(false) }
  }
  const code = `curl -X POST ${base()}/swarvo-api/tts \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify({ text: text.slice(0, 60) + (text.length > 60 ? '...' : ''), voice: chosen, lang, mode, speed: speed / 100 })}' \\\n  --output speech.wav`
  return (
    <>
      <PageHeader title="Playground" subtitle="Type something and hear it in Swarvo TTS 3." />
      {d && !d.available && <Card className="mb-4 border-accent/30 bg-accent-soft/40 p-4 text-sm">Swarvo TTS 3 is coming soon for customers. <Link to="/help" className="font-medium text-accent underline underline-offset-2">Ask for early access</Link>.</Card>}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="p-5">
          <div className="mb-2 flex items-center justify-between"><label className="text-[13px] font-medium" htmlFor="tts-text">Text</label><span className="num text-xs text-soft">{text.length} / {d?.max_chars ?? 500}</span></div>
          <Textarea id="tts-text" className="min-h-[170px]" maxLength={d?.max_chars ?? 500} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="mt-3 flex flex-wrap gap-2">{d?.languages.map((l) => <Chip key={l.code} active={lang === l.code} onClick={() => { setLang(l.code); setText(SAMPLES[l.code] ?? text) }}>Try {l.name}</Chip>)}</div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={run} disabled={busy || !text.trim() || !d?.available}>{busy ? 'Making audio…' : 'Generate speech'}</Button>
            {url && <><audio ref={audio} src={url} controls className="h-10 max-w-full" /><a href={url} download="swarvo-tts-3.wav" className="text-[13px] font-medium text-accent underline underline-offset-2">Download</a></>}
          </div>
        </Card>
        <Card className="space-y-4 p-5">
          <div><label className="mb-1.5 block text-[13px] font-medium" htmlFor="tts-voice">Voice</label>
            <Select id="tts-voice" value={chosen} onChange={(e) => setVoice(e.target.value)}>{d?.voices.map((v) => <option key={v.name} value={v.name}>{v.name}{v.gender ? ` (${v.gender})` : ''}</option>)}</Select></div>
          <div><div className="mb-1.5 text-[13px] font-medium">Style</div>
            <div className="flex gap-2">{([['chat', 'Chat'], ['read', 'Read']] as const).map(([k, l]) => <Chip key={k} active={mode === k} onClick={() => setMode(k)}>{l}</Chip>)}</div>
            <p className="mt-1.5 text-xs text-soft">{mode === 'chat' ? 'Natural pauses and little fillers, like a person talking.' : 'Clean, even reading of the text.'}</p></div>
          <div><div className="mb-1.5 flex justify-between text-[13px] font-medium"><span>Speed</span><span className="num text-soft">{(speed / 100).toFixed(2)}x</span></div>
            <Slider value={speed} onChange={setSpeed} min={70} max={150} step={5} label="Speed" /></div>
        </Card>
      </div>
      <Card className="mt-4 p-5"><h3 className="text-[15px] font-semibold">Use it in your own code</h3><p className="mt-1 text-[13px] text-soft">The same request, ready to copy. Use an API key from <Link to="/developers" className="font-medium text-accent underline underline-offset-2">API keys</Link>.</p><div className="mt-3"><CodeBlock code={code} /></div></Card>
    </>
  )
}

/* ---------- Swarvo API: models ---------- */
export function ApiModelsPage() {
  const facts = [['Type', 'Text to speech'], ['Status', 'Coming soon'], ['Price', `From ${fmt(TTS_STEPS[0].rate)} down to ${fmt(TTS_STEPS[TTS_STEPS.length - 1].rate)} a minute`]]
  return (
    <>
      <PageHeader title="Models" subtitle="Our own models, available through the Swarvo API." />
      <Card className="relative overflow-hidden p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[#22d3ee]/20 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-24 right-10 h-56 w-56 rounded-full bg-[#8b5cf6]/15 blur-3xl" aria-hidden />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <MeshBadge className="h-14 w-14 rounded-2xl"><Mic size={22} /></MeshBadge>
            <div><h2 className="text-[22px] font-semibold tracking-[-0.02em]">Swarvo TTS 3</h2><p className="mt-0.5 text-sm text-soft">Natural, fast text to speech for voice agents and apps.</p></div>
          </div>
          <Badge>Coming soon</Badge>
        </div>
        <dl className="relative mt-6 grid gap-4 sm:grid-cols-3">{facts.map(([k, v]) => <div key={k} className="rounded-xl border bg-surface/70 p-4"><dt className="text-xs text-soft">{k}</dt><dd className="mt-1 text-[14px] font-medium">{v}</dd></div>)}</dl>
        <div className="relative mt-6 flex flex-wrap gap-2">
          <Link to="/swarvo-api/playground"><Button variant="primary">Open the playground</Button></Link>
          <Link to="/swarvo-api/pricing"><Button>See pricing</Button></Link>
          <Link to="/help"><Button>Ask for early access</Button></Link>
        </div>
      </Card>
    </>
  )
}

/* ---------- Swarvo API: pricing ---------- */
type Price = { currency: string; slabs: { up_to: number; rate: number }[]; contact_sales_above: number; number_monthly_local: number; number_monthly_toll_free: number; signup_bonus: number; bonus_left: number }
function AgentPricing() {
  const q = useQuery({ queryKey: ['pricing'], queryFn: () => http<Price>('/billing/pricing') })
  const p = q.data
  const rows = (p?.slabs ?? []).map((s, i, all) => ({ from: i === 0 ? 0 : all[i - 1].up_to, to: s.up_to, rate: s.rate, unlock: (i === 0 ? 0 : all[i - 1].up_to) * s.rate }))
  return (
    <>
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

function TtsPricing() {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5"><div className="text-[13px] text-soft">Starting price</div><div className="num mt-2 text-[28px] font-semibold leading-none">{fmt(TTS_STEPS[0].rate)}<span className="ml-1 text-sm font-normal text-soft">/ min</span></div><div className="mt-2 text-xs text-soft">Per minute of speech</div></Card>
        <Card className="p-5"><div className="text-[13px] text-soft">Lowest price</div><div className="num mt-2 text-[28px] font-semibold leading-none">{fmt(TTS_STEPS[TTS_STEPS.length - 1].rate)}<span className="ml-1 text-sm font-normal text-soft">/ min</span></div><div className="mt-2 text-xs text-soft">With {TTS_STEPS[TTS_STEPS.length - 1].from.toLocaleString('en-IN')}+ minutes a month</div></Card>
        <Card className="p-5"><div className="text-[13px] text-soft">Availability</div><div className="mt-2 text-[28px] font-semibold leading-none">Coming soon</div><div className="mt-2 text-xs text-soft">Prices may change before launch</div></Card>
      </div>
      <Card className="mt-4 overflow-hidden">
        <div className="border-b px-5 py-4"><h3 className="text-[15px] font-semibold">Swarvo TTS 3 price steps</h3><p className="mt-0.5 text-[13px] text-soft">The more speech you generate in a month, the lower the price per minute.</p></div>
        <table className="w-full text-sm"><thead className="border-b"><tr>{['Minutes a month', 'Price per minute'].map((h, i) => <th key={h} className={cn('px-5 py-2.5 text-xs font-medium text-soft', i === 1 ? 'text-right' : 'text-left')}>{h}</th>)}</tr></thead>
          <tbody>{TTS_STEPS.map((r) => <tr key={r.from} className="border-b last:border-0 hover:bg-muted/30"><td className="num px-5 py-3.5">{r.to === Infinity ? `${r.from.toLocaleString('en-IN')}+` : `${r.from.toLocaleString('en-IN')} to ${r.to.toLocaleString('en-IN')}`}</td><td className="num px-5 py-3.5 text-right font-semibold">{fmt(r.rate)}</td></tr>)}</tbody></table>
      </Card>
    </>
  )
}

export function ApiPricingPage() {
  return (
    <>
      <PageHeader title="Pricing" subtitle="What each part of the Swarvo platform costs." />
      <Tabs defaultValue="agents">
        <TabsList><Tab value="agents">Voice agents</Tab><Tab value="tts">Swarvo TTS 3</Tab></TabsList>
        <TabPanel value="agents"><AgentPricing /></TabPanel>
        <TabPanel value="tts"><TtsPricing /></TabPanel>
      </Tabs>
    </>
  )
}
