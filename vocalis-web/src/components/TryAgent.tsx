import * as React from 'react'
import { RotateCcw, Send, Wrench } from 'lucide-react'
import { Button, Dialog, Input } from './ui'
import { http } from '@/lib/api/http'

type Reply = { session: string; reply: string; ended: boolean; tools: string[] }
type Line = { who: 'agent' | 'you'; text: string; tools?: string[] }

/** A real typed conversation with the agent's current draft: same instructions, tools and knowledge, on the private test copy. */
export function TryAgent({ agentId, open, onOpenChange }: { agentId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [log, setLog] = React.useState<Line[]>([])
  const [session, setSession] = React.useState<string | null>(null)
  const [text, setText] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [ended, setEnded] = React.useState(false)
  const end = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [log, busy])

  const begin = React.useCallback(async () => {
    setLog([]); setSession(null); setEnded(false); setError(null); setBusy(true)
    try { const r = await http<Reply>(`/agents/${agentId}/try/start`, { method: 'POST' }); setSession(r.session); setLog([{ who: 'agent', text: r.reply, tools: r.tools }]); setEnded(r.ended) }
    catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy(false) }
  }, [agentId])
  React.useEffect(() => { if (open && !session && !busy && log.length === 0) void begin() }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t || !session || busy) return
    setText(''); setLog((l) => [...l, { who: 'you', text: t }]); setBusy(true); setError(null)
    try { const r = await http<Reply>(`/agents/${agentId}/try/say`, { method: 'POST', json: { session, text: t } }); setLog((l) => [...l, { who: 'agent', text: r.reply, tools: r.tools }]); setEnded(r.ended) }
    catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong.') } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} side title="Try the call" description="You play the caller. The agent answers with its real instructions, tools and knowledge. Free, and nobody is called.">
      <div className="flex h-[70vh] flex-col">
        <div className="flex-1 space-y-2 overflow-y-auto pr-1">
          {log.map((m, i) => (
            <div key={i} className={m.who === 'agent' ? 'max-w-[88%]' : 'ml-auto max-w-[88%]'}>
              <div className={m.who === 'agent' ? 'rounded-2xl bg-muted px-3 py-2 text-sm' : 'rounded-2xl bg-accent px-3 py-2 text-sm text-accent-fg'}>{m.text || '…'}</div>
              {m.tools && m.tools.length > 0 && <div className="mt-1 flex items-center gap-1 text-xs text-soft"><Wrench size={11} />Used: {m.tools.join(', ')}</div>}
            </div>))}
          {busy && <div className="max-w-[40%] rounded-2xl bg-muted px-3 py-2 text-sm text-soft">…</div>}
          {error && <p role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
          {ended && <p className="text-center text-sm text-soft">The agent ended the call.</p>}
          <div ref={end} />
        </div>
        <form onSubmit={send} className="flex gap-2 pt-3">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={ended ? 'The call has ended. Start again.' : 'Say something as the caller'} disabled={!session || ended} aria-label="What the caller says" maxLength={500} />
          <Button variant="primary" size="icon" aria-label="Send" disabled={!session || busy || ended}><Send size={15} /></Button>
          <Button type="button" variant="secondary" size="icon" aria-label="Start over" onClick={begin} disabled={busy}><RotateCcw size={15} /></Button>
        </form>
      </div>
    </Dialog>
  )
}
