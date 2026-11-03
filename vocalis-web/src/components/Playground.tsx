import * as React from 'react'
import { Mic, MicOff, Send, Volume2 } from '@/components/icons'
import { Button, Dialog, Input } from './ui'
import { VoiceOrb, speak, stopSpeaking } from './shared'
import { useData } from '@/store/data'
import { useUI } from '@/store/ui'
import { cn } from '@/lib/utils'
import { USE_MOCKS } from '@/lib/api/env'
import { useAgentCall } from '@/lib/call'

type Msg = { who: 'agent' | 'you'; text: string }
const replies = [
  'Happy to help with that! Could I have your name first?',
  'Great, thank you. I have a free slot tomorrow at 11 AM. Would that work for you?',
  'Perfect, you are all booked in. I will send you a text reminder. Anything else I can do?',
  'No problem at all. Have a lovely day!',
]

// Browser speech recognition (Chrome/Edge/Safari). Falls back to typing when missing.
const SR: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null

/** Real practice call: live audio with the agent's test copy. */
function RealCall({ agentId, compact }: { agentId: string; compact?: boolean }) {
  const call = useAgentCall(agentId)
  const end = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [call.lines])
  const live = call.status === 'live', busy = call.status === 'connecting'
  const orb = busy ? 'thinking' : live ? 'listening' : 'idle'
  const label = busy ? 'Connecting…' : live ? 'You are on a call. Just talk.' : call.status === 'ended' ? 'Call ended' : 'Press Talk and say hello'
  return (
    <div className={cn('grid gap-4', !compact && 'md:grid-cols-[260px_1fr]')}>
      <div className="relative flex flex-col items-center justify-center gap-4 overflow-hidden rounded-2xl border bg-surface px-4 py-8">
        <div className="pointer-events-none absolute -left-10 -top-12 h-40 w-40 rounded-full bg-[#22d3ee]/20 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-12 -right-10 h-44 w-44 rounded-full bg-[#8b5cf6]/20 blur-3xl" aria-hidden />
        <VoiceOrb state={orb} size={compact ? 140 : 170} />
        <div className="text-sm text-soft" aria-live="polite">{label}</div>
        {live || busy ? (
          <div className="flex gap-2">
            <Button variant="danger" size="lg" onClick={call.end}><MicOff size={18} />End call</Button>
            <Button size="lg" onClick={() => call.setMuted(!call.muted)} disabled={!live} aria-pressed={call.muted}>{call.muted ? 'Unmute' : 'Mute'}</Button>
          </div>
        ) : (
          <Button variant="primary" size="lg" onClick={call.start}><Mic size={18} />{call.status === 'idle' ? 'Talk' : 'Talk again'}</Button>
        )}
        <p className="max-w-[200px] text-center text-xs text-soft">Practice calls are free and never reach real callers.</p>
      </div>
      <div className="flex min-h-[300px] flex-col rounded-2xl border bg-surface">
        <div className="flex-1 space-y-2.5 overflow-y-auto p-4" style={{ maxHeight: compact ? 220 : 320 }} aria-live="polite">
          {call.error && <p role="alert" className="rounded-lg bg-bad/10 p-3 text-sm text-bad">{call.error}</p>}
          {call.lines.length === 0 && !call.error && <p className="text-sm text-soft">What you and the agent say will show up here.</p>}
          {call.lines.map((m) => (
            <div key={m.id} className={cn('flex', m.who === 'you' && 'justify-end')}>
              <div className={cn('max-w-[85%] rounded-2xl px-3.5 py-2 text-sm', m.who === 'you' ? 'bg-ink text-surface' : 'bg-muted')}>{m.text}</div>
            </div>
          ))}
          <div ref={end} />
        </div>
      </div>
    </div>
  )
}

export function VoicePlayground({ agentId, compact }: { agentId?: string; compact?: boolean }) {
  const agents = useData((s) => s.agents)
  const resolved = agents.find((a) => a.id === agentId) ?? agents[0]
  if (!USE_MOCKS && resolved) return <RealCall agentId={resolved.id} compact={compact} />
  return <DemoPlayground agentId={agentId} compact={compact} />
}

function DemoPlayground({ agentId, compact }: { agentId?: string; compact?: boolean }) {
  const agents = useData((s) => s.agents)
  const agent = agents.find((a) => a.id === agentId) ?? agents[0]
  const [msgs, setMsgs] = React.useState<Msg[]>([{ who: 'agent', text: `Hi, you've reached ${agent.business}. How can I help you today?` }])
  const [state, setState] = React.useState<'idle' | 'listening' | 'speaking' | 'thinking'>('idle')
  const [text, setText] = React.useState('')
  const [voiceOn, setVoiceOn] = React.useState(true)
  const idx = React.useRef(0)
  const rec = React.useRef<any>(null)
  const end = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])
  React.useEffect(() => {
    if (voiceOn) { setState('speaking'); speak(msgs[0].text, { onEnd: () => setState('idle') }) }
    return () => { stopSpeaking(); rec.current?.stop?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const send = (t: string) => {
    if (!t.trim()) return
    setMsgs((m) => [...m, { who: 'you', text: t }])
    setText(''); setState('thinking')
    setTimeout(() => {
      const r = replies[idx.current++ % replies.length]
      setMsgs((m) => [...m, { who: 'agent', text: r }])
      if (voiceOn) { setState('speaking'); speak(r, { onEnd: () => setState('idle') }) } else { setState('speaking'); setTimeout(() => setState('idle'), 1500) }
    }, 900)
  }
  const listen = () => {
    if (!SR) return
    if (state === 'listening') { rec.current?.stop(); return }
    stopSpeaking()
    const r = new SR(); rec.current = r
    r.lang = 'en-IN'; r.interimResults = false
    r.onresult = (e: any) => send(e.results[0][0].transcript)
    r.onend = () => setState((s) => (s === 'listening' ? 'idle' : s))
    r.onerror = () => setState('idle')
    r.start(); setState('listening')
  }
  const label = { idle: 'Tap the mic and say hello', listening: 'Listening…', speaking: 'Speaking…', thinking: 'Thinking…' }[state]

  return (
    <div className={cn('grid gap-6', !compact && 'md:grid-cols-[220px_1fr]')}>
      <div className="flex flex-col items-center justify-center gap-4 py-2">
        <div className="relative"><VoiceOrb state={state} size={compact ? 140 : 170} /></div>
        <div className="relative text-sm text-soft" aria-live="polite">{label}</div>
        <Button variant={state === 'listening' ? 'danger' : 'primary'} size="lg" className="relative rounded-full px-7" onClick={listen} disabled={!SR} aria-label="Talk">
          {state === 'listening' ? <MicOff size={18} /> : <Mic size={18} />}{state === 'listening' ? 'Stop' : 'Talk'}
        </Button>
        {!SR && <p className="max-w-[200px] text-center text-xs text-soft">Your browser can't listen, so type below instead. The agent still talks back.</p>}
        <label className="relative flex cursor-pointer items-center gap-2 text-xs text-soft"><input type="checkbox" checked={voiceOn} onChange={(e) => { setVoiceOn(e.target.checked); if (!e.target.checked) stopSpeaking() }} /><Volume2 size={13} />Agent speaks out loud</label>
      </div>
      <div className="flex min-h-[280px] flex-col rounded-xl border bg-muted/40">
        <div className="flex-1 space-y-2.5 overflow-y-auto p-4" style={{ maxHeight: compact ? 220 : 320 }} aria-live="polite">
          {msgs.map((m, i) => (
            <div key={i} className={cn('flex', m.who === 'you' && 'justify-end')}>
              <div className={cn('max-w-[85%] rounded-2xl px-3.5 py-2 text-sm', m.who === 'you' ? 'bg-accent text-accent-fg' : 'border bg-surface')}>{m.text}</div>
            </div>
          ))}
          <div ref={end} />
        </div>
        <form className="flex gap-2 border-t p-3" onSubmit={(e) => { e.preventDefault(); send(text) }}>
          <Input className="rounded-full" value={text} onChange={(e) => setText(e.target.value)} placeholder="Or type what the caller says…" aria-label="Type a message" />
          <Button variant="primary" size="icon" className="shrink-0 rounded-full" aria-label="Send"><Send size={16} /></Button>
        </form>
      </div>
    </div>
  )
}

export function PlaygroundModal() {
  const id = useUI((s) => s.playground)
  const set = useUI((s) => s.set)
  const agent = useData((s) => s.agents.find((a) => a.id === id))
  return (
    <Dialog open={!!id} onOpenChange={(o) => { if (!o) { stopSpeaking(); set({ playground: null }) } }} wide
      title={agent ? `Talking to ${agent.name}` : 'Talk to your agent'} description="This is a practice call in your browser. It's free.">
      {id && <VoicePlayground agentId={id} />}
    </Dialog>
  )
}
