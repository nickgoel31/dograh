/** The call or chat window inside a customer's website (loaded in an iframe by widget.js). No sign-in. */
import * as React from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Mic, PhoneOff, Send } from 'lucide-react'
import { Button, Input } from '@/components/ui'
import { useAgentCall } from '@/lib/call'
import { API_URL } from '@/lib/api/env'
import { BRAND } from '@/config/brand'

const base = () => (API_URL.startsWith('http') ? API_URL : `${window.location.origin}${API_URL}`)
async function post<T>(path: string, json: unknown): Promise<T> {
  const res = await fetch(`${base()}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.detail?.message ?? 'Something went wrong. Please try again.')
  return body as T
}

function VoiceWindow({ agentId, embedder }: { agentId: string; embedder: string }) {
  const widget = React.useMemo(() => ({ embedder }), [embedder])
  const { status, error, lines, start, end } = useAgentCall(agentId, widget)
  const live = status === 'live' || status === 'connecting'
  return (
    <>
      <div className="flex-1 space-y-2 overflow-y-auto">
        {lines.length === 0 && !error && <p className="mt-10 text-center text-sm text-soft">{status === 'idle' ? 'Press the button and say hello.' : status === 'connecting' ? 'Connecting…' : ''}</p>}
        {lines.map((l) => <div key={l.id} className={l.who === 'agent' ? 'max-w-[85%] rounded-2xl bg-muted px-3 py-2 text-sm' : 'ml-auto max-w-[85%] rounded-2xl bg-accent px-3 py-2 text-sm text-accent-fg'}>{l.text}</div>)}
        {error && <p role="alert" className="text-center text-sm text-bad">{error}</p>}
        {status === 'ended' && <p className="text-center text-sm text-soft">The call has ended.</p>}
      </div>
      <div className="pt-3">{live ? <Button className="w-full" onClick={end}><PhoneOff size={16} />End call</Button> : <Button variant="primary" className="w-full" onClick={start}><Mic size={16} />{status === 'idle' ? 'Start talking' : 'Talk again'}</Button>}</div>
    </>
  )
}

function ChatWindow({ agentId, embedder }: { agentId: string; embedder: string }) {
  const [log, setLog] = React.useState<{ who: 'agent' | 'me'; text: string }[]>([])
  const [session, setSession] = React.useState<string | null>(null)
  const [text, setText] = React.useState('')
  const [busy, setBusy] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [ended, setEnded] = React.useState(false)
  const end = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [log, busy])
  React.useEffect(() => {
    post<{ session: string; reply: string; ended: boolean }>(`/public/widget/${encodeURIComponent(agentId)}/chat/start`, { embedder })
      .then((r) => { setSession(r.session); setLog([{ who: 'agent', text: r.reply }]); setEnded(r.ended) }).catch((e) => setError(e.message)).finally(() => setBusy(false))
  }, [agentId, embedder])
  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t || !session || busy) return
    setText(''); setLog((l) => [...l, { who: 'me', text: t }]); setBusy(true); setError(null)
    try { const r = await post<{ reply: string; ended: boolean }>(`/public/widget/${encodeURIComponent(agentId)}/chat/say`, { embedder, session, text: t }); setLog((l) => [...l, { who: 'agent', text: r.reply }]); setEnded(r.ended) }
    catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong.') } finally { setBusy(false) }
  }
  return (
    <>
      <div className="flex-1 space-y-2 overflow-y-auto">
        {log.map((m, i) => <div key={i} className={m.who === 'agent' ? 'max-w-[85%] rounded-2xl bg-muted px-3 py-2 text-sm' : 'ml-auto max-w-[85%] rounded-2xl bg-accent px-3 py-2 text-sm text-accent-fg'}>{m.text}</div>)}
        {busy && <div className="max-w-[40%] rounded-2xl bg-muted px-3 py-2 text-sm text-soft">…</div>}
        {error && <p role="alert" className="text-center text-sm text-bad">{error}</p>}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="flex gap-2 pt-3"><Input value={text} onChange={(e) => setText(e.target.value)} placeholder={ended ? 'This chat has ended' : 'Type a message'} disabled={!session || ended} aria-label="Your message" maxLength={500} />
        <Button variant="primary" size="icon" aria-label="Send" disabled={!session || busy || ended}><Send size={15} /></Button></form>
    </>
  )
}

export default function WidgetPage() {
  const { agentId = '' } = useParams()
  const [sp] = useSearchParams()
  const embedder = sp.get('embedder') ?? ''
  return (
    <div className="flex h-screen flex-col bg-bg p-4 text-ink">
      {sp.get('mode') === 'chat' ? <ChatWindow agentId={agentId} embedder={embedder} /> : <VoiceWindow agentId={agentId} embedder={embedder} />}
      <p className="mt-2 text-center text-[11px] text-soft">Powered by {BRAND}</p>
    </div>
  )
}
