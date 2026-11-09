import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Copy, Download, Lock, ShieldCheck } from '@/components/icons'
import { Badge, Button, Card } from '@/components/ui'
import { BASE, API_URL } from '@/lib/api/env'
import { BRAND, SECURITY_EMAIL } from '@/config/brand'
import { cn } from '@/lib/utils'

/** Pages anyone can open without signing in: status, changelog, security and the API reference. */
export type PublicPage = 'status' | 'changelog' | 'security' | 'api-reference'
export const PUBLIC_PAGES: Record<PublicPage, string> = { status: 'Status', changelog: 'Changelog', security: 'Security', 'api-reference': 'API reference' }
export const publicPageFor = (path: string): PublicPage | null => (Object.keys(PUBLIC_PAGES) as PublicPage[]).find((k) => path === `${BASE}/${k}` || path === `${BASE}/${k}/`) ?? null

const apiRoot = new URL(API_URL.replace(/\/product$/, ''), window.location.origin).href.replace(/\/$/, '')
const get = async <T,>(path: string): Promise<T> => {
  const r = await fetch(`${API_URL}/public${path}`)
  if (!r.ok) throw new Error('Could not load this page.')
  return r.json() as Promise<T>
}

export default function PublicSite({ page }: { page: PublicPage }) {
  React.useEffect(() => { document.title = `${PUBLIC_PAGES[page]} · ${BRAND}` }, [page])
  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="sticky top-0 z-10 border-b bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-4 px-4">
          <a href={`${BASE}/`} className="font-semibold tracking-tight">{BRAND}</a>
          <nav className="ml-2 flex items-center gap-1 overflow-x-auto text-sm">
            {(Object.keys(PUBLIC_PAGES) as PublicPage[]).map((k) => (
              <a key={k} href={`${BASE}/${k}`} className={cn('whitespace-nowrap rounded-full px-3 py-1.5 transition hover:bg-muted', k === page ? 'bg-muted font-medium text-ink' : 'text-soft')}>{PUBLIC_PAGES[k]}</a>
            ))}
          </nav>
          <a href={`${BASE}/`} className="ml-auto hidden sm:block"><Button size="sm" variant="primary">Open the app</Button></a>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-10">
        {page === 'status' && <StatusView />}
        {page === 'changelog' && <ChangelogView />}
        {page === 'security' && <SecurityView />}
        {page === 'api-reference' && <ApiReferenceView />}
      </main>
      <footer className="border-t py-8 text-center text-xs text-soft">© {new Date().getFullYear()} {BRAND}</footer>
    </div>
  )
}

const H1 = ({ children, sub }: { children: React.ReactNode; sub?: string }) => (
  <div className="mb-8"><h1 className="text-[30px] font-semibold leading-tight tracking-[-0.03em]">{children}</h1>{sub && <p className="mt-2 max-w-2xl text-[15px] text-soft">{sub}</p>}</div>
)

/* ------------------------------------------------------------------ status */
type StatusData = { overall: string; checked_at: string; components: { key: string; name: string; state: string; uptime: number | null; history: { date: string; uptime: number | null }[] }[]; incidents: { date: string; title: string; status: string; body: string }[] }
const dot = (u: number | null) => (u === null ? 'bg-line' : u >= 99.9 ? 'bg-ok' : u >= 99 ? 'bg-warn' : 'bg-bad')
const STATE: Record<string, { label: string; cls: string }> = { operational: { label: 'Operational', cls: 'text-ok' }, outage: { label: 'Not working', cls: 'text-bad' }, unknown: { label: 'No recent check', cls: 'text-soft' } }

function StatusView() {
  const q = useQuery({ queryKey: ['public-status'], queryFn: () => get<StatusData>('/status'), refetchInterval: 60000 })
  const d = q.data
  const banner = !d || d.overall === 'unknown' ? { t: q.isError ? 'We could not load the status' : 'Checking…', cls: 'bg-muted text-ink' } : d.overall === 'operational' ? { t: 'All systems operational', cls: 'bg-ok/15 text-ok' } : { t: 'Some systems are having problems', cls: 'bg-bad/15 text-bad' }
  return (
    <>
      <H1 sub="Live health of the parts of the platform, checked every minute, with the last 30 days.">Status</H1>
      <div className={cn('mb-8 rounded-2xl px-5 py-4 text-lg font-semibold', banner.cls)} role="status">{banner.t}</div>
      <div className="space-y-4">
        {(d?.components ?? []).map((c) => (
          <Card key={c.key} className="rounded-2xl p-5 shadow-none">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium">{c.name}</div>
              <div className="flex items-center gap-3 text-sm"><span className="text-soft">{c.uptime === null ? '' : `${c.uptime}% uptime`}</span><span className={cn('font-medium', STATE[c.state]?.cls)}>{STATE[c.state]?.label}</span></div>
            </div>
            <div className="mt-3 flex h-8 items-stretch gap-[3px]" aria-label={`${c.name}: last 30 days`}>
              {c.history.map((h) => <div key={h.date} title={`${h.date}: ${h.uptime === null ? 'no data' : h.uptime + '%'}`} className={cn('flex-1 rounded-[3px]', dot(h.uptime))} />)}
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] text-soft"><span>30 days ago</span><span>Today</span></div>
          </Card>
        ))}
      </div>
      {d && d.components.length === 0 && !q.isError && <p className="text-sm text-soft">The first checks have not run yet. Check back in a minute.</p>}
      <h2 className="mb-3 mt-12 text-lg font-semibold">Past incidents</h2>
      {d && d.incidents.length === 0 ? <p className="text-sm text-soft">No incidents in the last 90 days.</p> : (d?.incidents ?? []).map((i) => (
        <div key={i.date + i.title} className="mb-4 border-l-2 border-line pl-4"><div className="text-xs text-soft">{i.date} · {i.status}</div><div className="font-medium">{i.title}</div><p className="text-sm text-soft">{i.body}</p></div>
      ))}
      <p className="mt-10 text-xs text-soft">Phone carriers and AI model providers publish their own status. We show what we can check ourselves.</p>
    </>
  )
}

/* ------------------------------------------------------------------ changelog */
const KIND: Record<string, { label: string; tone: 'accent' | 'gray' | 'orange' }> = { new: { label: 'New', tone: 'accent' }, improved: { label: 'Improved', tone: 'gray' }, fixed: { label: 'Fixed', tone: 'orange' } }
function ChangelogView() {
  const q = useQuery({ queryKey: ['public-changelog'], queryFn: () => get<{ date: string; title: string; items: { kind: string; text: string }[] }[]>('/changelog') })
  return (
    <>
      <H1 sub="What is new and what got better, newest first.">Changelog</H1>
      {q.isPending && <div className="skeleton h-40 rounded-2xl" />}
      <div className="space-y-10">
        {(q.data ?? []).map((e) => (
          <section key={e.date} className="grid gap-3 sm:grid-cols-[130px_1fr]">
            <time className="text-sm text-soft sm:pt-1" dateTime={e.date}>{new Date(e.date + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</time>
            <div><h2 className="text-lg font-semibold">{e.title}</h2>
              <ul className="mt-3 space-y-2">{e.items.map((i, n) => <li key={n} className="flex gap-3 text-[15px]"><Badge tone={KIND[i.kind]?.tone ?? 'gray'} className="mt-0.5 h-fit shrink-0">{KIND[i.kind]?.label ?? i.kind}</Badge><span>{i.text}</span></li>)}</ul></div>
          </section>
        ))}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ security */
const SECTIONS: { title: string; items: string[] }[] = [
  { title: 'Your data stays yours', items: [
    'Every workspace is separate. Each request is checked against the workspace it belongs to, so one customer can never see another customer’s agents, calls or numbers.',
    'Traffic to the app and the API is encrypted in transit with HTTPS.',
    'You choose what is kept: turn recording off, hide phone numbers and emails in transcripts, and set how many days recordings and transcripts are kept before they are cleared.',
    'Card details are handled by our payment provider, Razorpay. They never reach our servers.',
  ] },
  { title: 'Signing in', items: [
    'Two-step sign-in with an authenticator app, per person.',
    'Company sign-in: require Google sign-in for everyone with your email domain.',
    'Restrict sign-in to approved networks, such as your office.',
    'Email and WhatsApp numbers are verified before they are trusted.',
  ] },
  { title: 'Working as a team', items: [
    'Four roles: Owner, Admin, Developer and Viewer, so people only get what they need.',
    'An audit log records important actions in your workspace.',
    'Invites are links valid for 7 days that you send yourself.',
  ] },
  { title: 'Developers', items: [
    'API keys are shown once and stored only as a hash. Revoke a key any time.',
    'Test keys (sk_test_) only reach practice data. Live keys (sk_live_) only reach live data.',
    'Webhooks are signed with HMAC-SHA256 and a timestamp, so you can check they came from us and reject replays.',
    'Every API request is rate limited and logged.',
  ] },
  { title: 'Calling people responsibly', items: [
    'Campaigns need your confirmation that people agreed to be called and that the list was checked against Do-Not-Call. Both confirmations are recorded.',
    'Calls are only placed inside the calling hours you set, and never outside the allowed window (9 AM to 9 PM by default).',
    'Anyone who asks not to be called is added to your do-not-call list automatically.',
    'You can have the agent say a recording notice at the start of every live call.',
  ] },
]
function SecurityView() {
  return (
    <>
      <H1 sub="What we do to protect your data and your callers, in plain words.">Security</H1>
      <div className="grid gap-5 sm:grid-cols-2">
        {SECTIONS.map((s) => (
          <Card key={s.title} className="rounded-2xl p-6 shadow-none">
            <div className="mb-3 flex items-center gap-2 font-semibold"><ShieldCheck size={18} className="text-accent" />{s.title}</div>
            <ul className="space-y-2.5 text-[14px] leading-relaxed text-soft">{s.items.map((i) => <li key={i} className="flex gap-2"><Check size={14} className="mt-1 shrink-0 text-accent" /><span>{i}</span></li>)}</ul>
          </Card>
        ))}
      </div>
      <Card className="mt-6 rounded-2xl bg-muted/40 p-6 shadow-none">
        <div className="mb-2 flex items-center gap-2 font-semibold"><Lock size={18} className="text-accent" />What we do not have yet</div>
        <p className="text-[14px] leading-relaxed text-soft">We have not completed an independent audit such as SOC 2 or ISO 27001 yet. If your company needs one before you can use a service, or a data processing agreement, tell us and we will work it out with you.</p>
      </Card>
      <h2 className="mb-2 mt-10 text-lg font-semibold">Found a problem?</h2>
      <p className="text-[15px] text-soft">Email <a className="text-accent hover:underline" href={`mailto:${SECURITY_EMAIL}`}>{SECURITY_EMAIL}</a> with what you found and how to reproduce it. We read every report, reply quickly, and will not take action against anyone who reports in good faith.</p>
    </>
  )
}

/* ------------------------------------------------------------------ API reference */
type Ref = {
  base_path: string; auth: string; rate_limit: string; errors: { status: string; code: string; desc: string }[]
  webhooks: { intro: string; events: { name: string; desc: string }[]; signature: string; retries: string }
  endpoints: { id: string; method: string; path: string; title: string; summary: string; params: { name: string; in: string; type: string; desc: string }[]; response: unknown; examples: Record<string, string> }[]
  sdks: { id: string; name: string; file: string; install: string }[]
}
const LANG = [['curl', 'curl'], ['python', 'Python'], ['typescript', 'TypeScript']] as const

function Code({ text }: { text: string }) {
  const [done, setDone] = React.useState(false)
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-xl bg-muted/70 p-4 pr-12 font-mono text-[12.5px] leading-relaxed">{text}</pre>
      <button className="absolute right-2 top-2 rounded-md p-1.5 text-soft hover:bg-muted hover:text-ink" aria-label="Copy" onClick={() => { void navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) }}>{done ? <Check size={14} /> : <Copy size={14} />}</button>
    </div>
  )
}

function Endpoint({ e }: { e: Ref['endpoints'][number] }) {
  const [lang, setLang] = React.useState<(typeof LANG)[number][0]>('curl')
  const [key, setKey] = React.useState('')
  const [out, setOut] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const needsId = e.path.includes('{')
  const tryIt = async () => {
    setBusy(true); setOut(null)
    try {
      const r = await fetch(`${apiRoot}${e.path.replace('{call_id}', 'call_example')}`, { headers: { Authorization: `Bearer ${key.trim()}` } })
      setOut(`${r.status}\n${JSON.stringify(await r.json().catch(() => ({})), null, 2)}`)
    } catch { setOut('Could not reach the API from this page.') }
    setBusy(false)
  }
  return (
    <Card id={e.id} className="scroll-mt-20 rounded-2xl p-6 shadow-none">
      <div className="flex flex-wrap items-center gap-2"><Badge tone="accent">{e.method}</Badge><code className="font-mono text-sm">{e.path}</code></div>
      <h3 className="mt-3 text-lg font-semibold">{e.title}</h3>
      <p className="mt-1 text-[14px] text-soft">{e.summary}</p>
      {e.params.length > 0 && <dl className="mt-4 space-y-1.5 text-[13px]">{e.params.map((p) => <div key={p.name} className="flex gap-2"><dt className="font-mono text-ink">{p.name}</dt><dd className="text-soft">{p.type} · {p.in}. {p.desc}</dd></div>)}</dl>}
      <div className="mt-5 flex gap-1.5">{LANG.map(([k, l]) => <button key={k} onClick={() => setLang(k)} className={cn('rounded-full px-3 py-1 text-xs', lang === k ? 'bg-ink text-bg' : 'bg-muted text-soft hover:text-ink')}>{l}</button>)}</div>
      <div className="mt-2"><Code text={e.examples[lang].split('{base}').join(apiRoot)} /></div>
      <div className="mt-4 text-xs font-medium uppercase tracking-wide text-soft">Example response</div>
      <div className="mt-1"><Code text={JSON.stringify(e.response, null, 2)} /></div>
      {!needsId && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input className="h-9 min-w-0 flex-1 rounded-lg border bg-surface px-3 font-mono text-xs outline-none focus:border-soft/60" placeholder="Paste a sk_test_ key to try it" value={key} onChange={(ev) => setKey(ev.target.value)} aria-label="API key" />
          <Button size="sm" onClick={tryIt} disabled={busy || key.trim().length < 8}>{busy ? 'Sending…' : 'Send request'}</Button>
        </div>
      )}
      {out && <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-muted/70 p-3 font-mono text-xs">{out}</pre>}
    </Card>
  )
}

function ApiReferenceView() {
  const q = useQuery({ queryKey: ['public-api-ref'], queryFn: () => get<Ref>('/api-reference'), staleTime: Infinity })
  const r = q.data
  return (
    <>
      <H1 sub="Read your agents and calls from your own software, and get told when things happen.">API reference</H1>
      {q.isPending && <div className="skeleton h-60 rounded-2xl" />}
      {r && (
        <div className="space-y-10">
          <section><h2 className="mb-2 text-lg font-semibold">Base URL</h2><Code text={`${apiRoot}${r.base_path}`} /></section>
          <section><h2 className="mb-2 text-lg font-semibold">Authentication</h2><p className="text-[15px] text-soft">{r.auth}</p><p className="mt-2 text-[15px] text-soft">Rate limit: {r.rate_limit}</p></section>
          <section><h2 className="mb-3 text-lg font-semibold">Client libraries</h2>
            <div className="grid gap-3 sm:grid-cols-2">{r.sdks.map((s) => (
              <Card key={s.id} className="flex items-center gap-3 rounded-2xl p-4 shadow-none"><div className="min-w-0 flex-1"><div className="font-medium">{s.name}</div><div className="text-[13px] text-soft">{s.install}</div></div>
                <a href={`${API_URL}/public/sdk/${s.id}`} download={s.file}><Button size="sm"><Download size={14} />{s.file}</Button></a></Card>
            ))}</div></section>
          <section className="space-y-5"><h2 className="text-lg font-semibold">Endpoints</h2>{r.endpoints.map((e) => <Endpoint key={e.id} e={e} />)}</section>
          <section><h2 className="mb-2 text-lg font-semibold">Webhooks</h2><p className="text-[15px] text-soft">{r.webhooks.intro}</p>
            <ul className="mt-3 space-y-1.5 text-[14px]">{r.webhooks.events.map((e) => <li key={e.name} className="flex gap-2"><code className="font-mono">{e.name}</code><span className="text-soft">{e.desc}</span></li>)}</ul>
            <h3 className="mb-1 mt-5 font-medium">Checking the signature</h3><p className="text-[14px] text-soft">{r.webhooks.signature}</p>
            <h3 className="mb-1 mt-5 font-medium">Retries</h3><p className="text-[14px] text-soft">{r.webhooks.retries}</p></section>
          <section><h2 className="mb-3 text-lg font-semibold">Errors</h2>
            <div className="divide-y rounded-2xl border">{r.errors.map((e) => <div key={e.status} className="flex flex-wrap gap-x-3 gap-y-1 p-3 text-[14px]"><code className="font-mono">{e.status}</code><code className="font-mono text-soft">{e.code}</code><span className="text-soft">{e.desc}</span></div>)}</div></section>
        </div>
      )}
    </>
  )
}
