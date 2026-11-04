import * as React from 'react'
import { useParams } from 'react-router-dom'
import { API_URL } from '@/lib/api/env'

/** The chat window that appears inside other people's websites. Public, no sign-in, no app chrome. */
type Cfg = { enabled: boolean; title: string; greeting: string; color: string; position: string; prompts: string[]; collect_lead: boolean; powered_by: boolean }
type Msg = { id: number; role: 'visitor' | 'agent' | 'human'; text: string }

const BASE = API_URL.replace(/\/product$/, '') + '/public/chat'
const post = async <T,>(path: string, body: unknown): Promise<T> => {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(typeof j?.detail === 'object' ? j.detail.message : 'Something went wrong. Please try again.')
  return j as T
}
const store = (k: string, v?: string | null) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* private window: the chat just will not be remembered */ } return null }
const link = (t: string) => t.split(/(https?:\/\/[^\s]+)/g).map((p, i) => (/^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">{p}</a> : <React.Fragment key={i}>{p}</React.Fragment>))

export default function ChatWidgetPage() {
  const { key = '' } = useParams()
  const q = new URLSearchParams(window.location.search)
  const embedder = q.get('embedder') || window.location.origin
  const [cfg, setCfg] = React.useState<Cfg | null>(null)
  const [token, setToken] = React.useState<string | null>(null)
  const [msgs, setMsgs] = React.useState<Msg[]>([])
  const [status, setStatus] = React.useState('bot')
  const [text, setText] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [lead, setLead] = React.useState({ name: q.get('name') || '', email: q.get('email') || '' })
  const [asked, setAsked] = React.useState(false)
  const [rated, setRated] = React.useState(false)
  const end = React.useRef<HTMLDivElement>(null)
  const last = React.useRef(0)
  const color = cfg?.color || '#6366f1'

  const start = React.useCallback(async (who?: { name?: string; email?: string }) => {
    try {
      const r = await post<{ token: string; status: string; config: Cfg; messages: Msg[] }>('/session', { key, embedder, token: store(`swarvo-chat:${key}`) || undefined, ...who })
      store(`swarvo-chat:${key}`, r.token)
      setToken(r.token); setCfg(r.config); setMsgs(r.messages); setStatus(r.status); setError(null)
      last.current = r.messages.reduce((a, m) => Math.max(a, m.id), 0)
    } catch (e) { setError(e instanceof Error ? e.message : 'This chat is not available.') }
  }, [key, embedder])

  React.useEffect(() => {
    const known = store(`swarvo-lead:${key}`) === '1' || !!(lead.name || lead.email)
    setAsked(known)
    void fetch(BASE + `/config?key=${encodeURIComponent(key)}`).then((r) => r.json()).then((c: Cfg) => { setCfg(c); if (!c.collect_lead || known) void start(lead.name || lead.email ? lead : undefined) }).catch(() => setError('This chat is not available.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  React.useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }) }, [msgs.length, busy])

  // while a person has the chat, their replies arrive by asking now and then
  React.useEffect(() => {
    if (!token || status !== 'human') return
    const t = setInterval(async () => {
      try {
        const r = await fetch(BASE + `/poll?token=${encodeURIComponent(token)}&after=${last.current}`).then((x) => x.json())
        if (r.messages?.length) { last.current = Math.max(last.current, ...r.messages.map((m: Msg) => m.id)); setMsgs((m) => [...m, ...r.messages.filter((x: Msg) => !m.some((y) => y.id === x.id))]) }
        if (r.status) setStatus(r.status)
      } catch { /* try again on the next beat */ }
    }, 3000)
    return () => clearInterval(t)
  }, [token, status])

  const send = async (t: string) => {
    const body = t.trim()
    if (!body || busy || !token) return
    setText(''); setBusy(true); setError(null)
    const temp: Msg = { id: -Date.now(), role: 'visitor', text: body }
    setMsgs((m) => [...m, temp])
    try {
      const r = await post<{ status: string; messages: Msg[] }>('/message', { token, text: body })
      last.current = Math.max(last.current, ...r.messages.map((m) => m.id))
      setMsgs((m) => [...m.filter((x) => x.id !== temp.id), ...r.messages]); setStatus(r.status)
    } catch (e) {
      setMsgs((m) => m.filter((x) => x.id !== temp.id)); setText(body); setError(e instanceof Error ? e.message : 'Could not send. Try again.')
    } finally { setBusy(false) }
  }
  const close = () => window.parent.postMessage('swarvo-chat-close', '*')
  const rate = async (n: number) => { setRated(true); if (token) try { await post('/rate', { token, rating: n }) } catch { /* not important */ } }
  const agentTurns = msgs.filter((m) => m.role !== 'visitor').length

  if (error && !cfg) return <div className="flex h-screen items-center justify-center bg-white p-6 text-center text-sm text-gray-500">{error}</div>
  if (!cfg) return <div className="h-screen bg-white" />
  if (!cfg.enabled) return <div className="flex h-screen items-center justify-center bg-white p-6 text-center text-sm text-gray-500">This chat is turned off right now.</div>

  const needLead = cfg.collect_lead && !asked
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white text-[14px] text-gray-900" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <header className="flex items-center gap-3 px-4 py-3.5 text-white" style={{ background: color }}>
        <div className="min-w-0 flex-1"><div className="truncate text-[15px] font-semibold">{cfg.title}</div><div className="text-xs opacity-80">{status === 'human' ? 'A teammate is with you' : 'We usually reply in a moment'}</div></div>
        <button onClick={close} aria-label="Close chat" className="rounded-full p-1.5 opacity-90 transition hover:bg-white/20"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
      </header>

      {needLead ? (
        <form className="flex flex-1 flex-col justify-center gap-3 px-6" onSubmit={(e) => { e.preventDefault(); store(`swarvo-lead:${key}`, '1'); setAsked(true); void start(lead) }}>
          <p className="text-[15px] font-medium">{cfg.greeting}</p>
          <p className="text-xs text-gray-500">Tell us who you are so we can follow up if we get disconnected.</p>
          <input required value={lead.name} onChange={(e) => setLead({ ...lead, name: e.target.value })} placeholder="Your name" aria-label="Your name" className="h-11 rounded-xl border border-gray-200 px-3.5 outline-none focus:border-gray-400" />
          <input required type="email" value={lead.email} onChange={(e) => setLead({ ...lead, email: e.target.value })} placeholder="Your email" aria-label="Your email" className="h-11 rounded-xl border border-gray-200 px-3.5 outline-none focus:border-gray-400" />
          <button className="h-11 rounded-xl font-medium text-white" style={{ background: color }}>Start chat</button>
        </form>
      ) : (
        <>
          <div className="flex-1 space-y-2.5 overflow-y-auto px-4 py-4" aria-live="polite">
            {cfg.greeting && <div className="flex"><div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-gray-100 px-3.5 py-2.5 leading-relaxed">{cfg.greeting}</div></div>}
            {!msgs.some((m) => m.role === 'visitor') && cfg.prompts.length > 0 && <div className="flex flex-wrap gap-2 pt-1">{cfg.prompts.map((p) => <button key={p} onClick={() => void send(p)} className="rounded-full border px-3.5 py-1.5 text-[13px] transition hover:bg-gray-50" style={{ borderColor: color, color }}>{p}</button>)}</div>}
            {msgs.map((m) => (
              <div key={m.id} className={m.role === 'visitor' ? 'flex justify-end' : 'flex'}>
                <div className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 leading-relaxed ${m.role === 'visitor' ? 'rounded-br-md text-white' : 'rounded-bl-md bg-gray-100'}`} style={m.role === 'visitor' ? { background: color } : undefined}>
                  {m.role === 'human' && <div className="mb-0.5 text-[11px] font-medium text-gray-500">Team</div>}{link(m.text)}
                </div>
              </div>))}
            {busy && <div className="flex"><div className="flex gap-1 rounded-2xl rounded-bl-md bg-gray-100 px-4 py-3.5" aria-label="Typing">{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400" style={{ animationDelay: `${i * 150}ms` }} />)}</div></div>}
            {!rated && agentTurns >= 2 && !busy && (
              <div className="flex items-center justify-center gap-2 pt-2 text-xs text-gray-500">Was this helpful?
                <button onClick={() => void rate(5)} className="rounded-full border px-2.5 py-1 transition hover:bg-gray-50" aria-label="Helpful">👍</button>
                <button onClick={() => void rate(1)} className="rounded-full border px-2.5 py-1 transition hover:bg-gray-50" aria-label="Not helpful">👎</button>
              </div>)}
            {rated && <div className="pt-2 text-center text-xs text-gray-500">Thanks for the feedback.</div>}
            <div ref={end} />
          </div>
          {error && <div className="mx-4 mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{error}</div>}
          <form className="flex items-end gap-2 border-t border-gray-100 p-3" onSubmit={(e) => { e.preventDefault(); void send(text) }}>
            <textarea rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text) } }} placeholder="Write a message…" aria-label="Message" maxLength={2000}
              className="max-h-28 min-h-[42px] flex-1 resize-none rounded-2xl border border-gray-200 px-3.5 py-2.5 outline-none focus:border-gray-400" />
            <button disabled={!text.trim() || busy} aria-label="Send" className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full text-white transition disabled:opacity-40" style={{ background: color }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
            </button>
          </form>
        </>
      )}
      {cfg.powered_by && <a href="https://swarvoai.com" target="_blank" rel="noreferrer noopener" className="block pb-2 text-center text-[11px] text-gray-400 hover:text-gray-600">Powered by Swarvo AI</a>}
    </div>
  )
}
