import * as React from 'react'
import { Mic, MicOff, Send, Volume2 } from 'lucide-react'
import { Button, Dialog, Input } from './ui'
import { VoiceOrb, speak, stopSpeaking } from './shared'
import { useData } from '@/store/data'
import { useUI } from '@/store/ui'
import { cn } from '@/lib/utils'

type Msg = { who: 'agent' | 'you'; text: string }
const replies = [
  'Happy to help with that! Could I have your name first?',
  'Great, thank you. I have a free slot tomorrow at 11 AM. Would that work for you?',
  'Perfect, you are all booked in. I will send you a text reminder. Anything else I can do?',
  'No problem at all. Have a lovely day!',
]

// Browser speech recognition (Chrome/Edge/Safari). Falls back to typing when missing.
const SR: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null

export function VoicePlayground({ agentId, compact }: { agentId?: string; compact?: boolean }) {
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
        <VoiceOrb state={state} size={compact ? 140 : 170} />
        <div className="text-sm text-soft" aria-live="polite">{label}</div>
        <Button variant={state === 'listening' ? 'danger' : 'primary'} size="lg" onClick={listen} disabled={!SR} aria-label="Talk">
          {state === 'listening' ? <MicOff size={18} /> : <Mic size={18} />}{state === 'listening' ? 'Stop' : 'Talk'}
        </Button>
        {!SR && <p className="max-w-[200px] text-center text-xs text-soft">Your browser can't listen, so type below instead. The agent still talks back.</p>}
        <label className="flex cursor-pointer items-center gap-2 text-xs text-soft"><input type="checkbox" checked={voiceOn} onChange={(e) => { setVoiceOn(e.target.checked); if (!e.target.checked) stopSpeaking() }} /><Volume2 size={13} />Agent speaks out loud</label>
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
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Or type what the caller says…" aria-label="Type a message" />
          <Button variant="primary" size="icon" aria-label="Send"><Send size={16} /></Button>
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
