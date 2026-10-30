import * as React from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CallFlowEditor, defaultFlow, type FlowData } from '@/components/CallFlow'
import { AlertTriangle, Check, History, Mic, Play, Rocket } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, Chip, Field, Input, Select, Slider, Switch, Tab, TabPanel, Tabs, TabsList, Textarea } from '@/components/ui'
import { AdvancedOnly, EmptyState, Friendly, PageHeader, SimpleAdvanced, StatusBadge, UnsavedBar, speak } from '@/components/shared'
import { VoicePlayground } from '@/components/Playground'
import { useData } from '@/store/data'
import { USE_MOCKS } from '@/lib/api/env'
import { agentsApi, toAgent } from '@/lib/api/agents'
import { useUI } from '@/store/ui'
import { api } from '@/lib/api'
import { useAsync } from '@/components/shared'
import { knowledge, numbers } from '@/mock/misc'
import { cn } from '@/lib/utils'
import type { Agent } from '@/mock/types'

type Draft = Agent & { speed: number; emotion: string; model: string; kb: string[]; tools: string[]; patience: number; interrupt: number; chatty: number; maxMin: number; voicemail: string; tested: boolean; flow: FlowData }
const toolList = [
  ['transfer', 'Transfer to a human', 'Pass tricky calls to a real person'], ['sms', 'Send a text message', 'Confirm bookings by SMS'], ['email', 'Send an email', 'Email a summary after the call'],
  ['calendar', 'Check the calendar', 'See free time slots'], ['book', 'Book appointments', 'Add events to your calendar'], ['dtmf', 'Press keypad numbers', 'Navigate phone menus'], ['end', 'End the call', 'Hang up politely when done'],
]
const versions = [
  { v: 5, when: 'Today, 9:12 AM', who: 'Aarav', note: 'Friendlier greeting', prompt: 'Greet the caller warmly by name.\nKeep answers short.\nOffer to book an appointment.' },
  { v: 4, when: 'Yesterday', who: 'Meera', note: 'Added cancellation rules', prompt: 'Greet the caller politely.\nKeep answers short.\nExplain the cancellation rules.' },
  { v: 3, when: '3 days ago', who: 'Aarav', note: 'Shorter answers', prompt: 'Greet the caller politely.\nKeep answers short.' },
  { v: 2, when: 'Last week', who: 'Dev', note: 'First live version', prompt: 'Greet the caller politely.\nAnswer any question in detail.' },
]
const Q = ({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) => <Card className="p-6"><h3 className="font-semibold">{title}</h3>{hint && <p className="mb-4 mt-0.5 text-[13px] text-soft">{hint}</p>}<div className={hint ? '' : 'mt-4'}>{children}</div></Card>

export default function AgentDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const agent = useData((s) => s.agents.find((a) => a.id === id))
  const updateAgent = useData((s) => s.updateAgent)
  const voices = useAsync(() => api.voices(), []).data ?? []
  const upsertAgent = useData((s) => s.upsertAgent)
  // The list omits the prompt and edit version; load them when an agent is opened.
  React.useEffect(() => {
    if (USE_MOCKS || !id) return
    agentsApi.get(id).then((a) => upsertAgent(toAgent(a, useData.getState().agents.find((x) => x.id === id)))).catch(() => {})
  }, [id, upsertAgent])
  const setUI = useUI((s) => s.set)
  const base = React.useMemo<Draft | null>(() => agent ? ({ ...agent, speed: 50, emotion: 'Warm', model: 'gpt-4o-mini', kb: ['k1', 'k4'], tools: ['calendar', 'book', 'end'], patience: 60, interrupt: 50, chatty: 40, maxMin: 10, voicemail: 'leave', tested: false, flow: defaultFlow() }) : null, [agent?.id])
  const [saved, setSaved] = React.useState<Draft | null>(base)
  const [d, setD] = React.useState<Draft | null>(base)
  const [diff, setDiff] = React.useState<number | null>(null)
  React.useEffect(() => { setSaved(base); setD(base) }, [base])
  if (!agent || !d || !saved) return <EmptyState emoji="🔍" title="We couldn't find that agent" text="It may have been deleted. Head back to see all your agents." action={<Button variant="primary" size="lg" onClick={() => nav('/agents')}>See all agents</Button>} />
  const dirty = JSON.stringify(d) !== JSON.stringify(saved)
  const up = (p: Partial<Draft>) => setD({ ...d, ...p })
  const voice = voices.find((v) => v.id === d.voiceId) ?? voices[0] ?? { id: '', name: 'Default', lang: '', gender: '', age: '', accent: '', style: '', provider: '' }
  const tab = sp.get('tab') ?? 'personality'
  const save = () => { updateAgent(agent.id, { name: d.name, voiceId: d.voiceId, brain: d.brain, tone: d.tone, business: d.business, whatYouDo: d.whatYouDo, prompt: d.prompt }); setSaved(d); toast.success('Saved!') }

  const brainCards = [['fast', '⚡ Fast', 'Replies very quickly. Great for simple jobs.', 'Best for: FAQs'], ['balanced', '⚖️ Balanced', 'A good mix of speed and smarts.', 'Best for: most businesses'], ['smartest', '🧠 Smartest', 'Thinks harder. A little slower.', 'Best for: tricky conversations']] as const
  const checks = [
    { ok: !!d.prompt.trim(), t: 'Your agent knows what to say', fix: 'Add instructions in Personality' },
    { ok: !!d.voiceId, t: 'A voice is picked', fix: 'Pick a voice' },
    { ok: d.kb.length > 0, t: 'It has knowledge to use', fix: 'Add knowledge' },
    { ok: d.tested, t: 'You tried a test call', fix: 'Try it in the Test tab' },
    { ok: agent.numbers.length > 0, t: 'A phone number is connected', fix: 'Attach a number in Phone' },
  ]

  return (
    <>
      <PageHeader title={d.name} subtitle={d.whatYouDo} actions={<>
        <StatusBadge status={agent.status} />
        <Button onClick={() => setUI({ playground: agent.id })}><Mic size={15} />Talk</Button>
        <Button variant="primary" onClick={() => setSp({ tab: 'publish' })}><Rocket size={15} />Go live</Button></>} />
      <Tabs value={tab} onValueChange={(t) => setSp({ tab: t })}>
        <TabsList>{['personality', 'voice', 'brain', 'knowledge', 'tools', 'flow', 'behavior', 'phone', 'test', 'versions', 'publish'].map((t) => <Tab key={t} value={t} className="capitalize">{t === 'flow' ? 'Call flow' : t}</Tab>)}</TabsList>

        <TabPanel value="personality"><SimpleAdvanced
          simple={<Q title="Who is your agent?" hint="Just fill in the blanks. We write the instructions for you.">
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Agent name"><Input value={d.name} onChange={(e) => up({ name: e.target.value })} /></Field><Field label="Business name"><Input value={d.business} onChange={(e) => up({ business: e.target.value })} /></Field></div>
            <Field label="What do you do?" className="mt-4"><Textarea value={d.whatYouDo} onChange={(e) => up({ whatYouDo: e.target.value })} /></Field>
            <div className="mt-4"><div className="mb-2 text-[13px] font-medium">How should it sound?</div><div className="flex gap-2">{['Friendly', 'Professional', 'Playful'].map((t) => <Chip key={t} active={d.tone === t} onClick={() => up({ tone: t })}>{t}</Chip>)}</div></div></Q>}
          advanced={<Q title="Raw prompt" hint="The exact instructions the AI follows. Click a chip to insert a variable.">
            <div className="mb-3 flex flex-wrap gap-2">{['{{caller_name}}', '{{business_name}}', '{{current_time}}', '{{caller_phone}}'].map((v) => <button key={v} onClick={() => up({ prompt: d.prompt + ' ' + v })} className="rounded-md bg-accent-soft px-2 py-1 font-mono text-xs text-accent hover:brightness-95">{v}</button>)}</div>
            <Textarea className="min-h-[280px] font-mono text-[13px]" value={d.prompt} onChange={(e) => up({ prompt: e.target.value })} aria-label="Prompt" /></Q>} /></TabPanel>

        <TabPanel value="voice"><Q title="Pick a voice" hint="Press play to hear each one.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{voices.slice(0, 9).map((v) => (
            <div key={v.id} className={cn('flex items-center gap-3 rounded-xl border p-3', d.voiceId === v.id && 'border-accent bg-accent-soft')}>
              <Button size="icon" variant="secondary" className="rounded-full" aria-label={`Play ${v.name}`} onClick={() => speak(`Hello, I'm ${v.name}. How can I help you today?`, { female: v.gender === 'Female' })}><Play size={14} /></Button>
              <button className="flex-1 text-left" onClick={() => up({ voiceId: v.id })}><div className="font-medium">{v.name}</div><div className="text-xs text-soft">{v.lang} · {v.style}</div></button>{d.voiceId === v.id && <Check size={16} className="text-accent" />}</div>))}</div>
          <div className="mt-6 grid gap-6 sm:grid-cols-3">
            <Field label="Language"><Select defaultValue={voice.lang}>{[...new Set(voices.map((v) => v.lang))].map((l) => <option key={l}>{l}</option>)}</Select></Field>
            <Field label="Speaking speed" hint={<span className="text-xs text-soft">{d.speed < 40 ? 'Slow' : d.speed > 60 ? 'Fast' : 'Normal'}</span>}><Slider value={d.speed} onChange={(v) => up({ speed: v })} label="Speed" /></Field>
            <Field label="Mood"><Select value={d.emotion} onChange={(e) => up({ emotion: e.target.value })}>{['Warm', 'Calm', 'Cheerful', 'Serious'].map((l) => <option key={l}>{l}</option>)}</Select></Field></div></Q></TabPanel>

        <TabPanel value="brain"><SimpleAdvanced
          simple={<div className="grid gap-4 md:grid-cols-3">{brainCards.map(([k, t, p, b]) => <button key={k} onClick={() => up({ brain: k })} className={cn('rounded-xl border bg-surface p-5 text-left shadow-card transition hover:border-accent', d.brain === k && 'border-accent ring-2 ring-accent/20')}><div className="text-lg font-semibold">{t}</div><p className="mt-1 text-soft">{p}</p><Badge tone="accent" className="mt-3">{b}</Badge></button>)}</div>}
          advanced={<Q title="Model" hint="Which language model writes the replies."><Field label="Model"><Select value={d.model} onChange={(e) => up({ model: e.target.value })}>{['gpt-4o-mini', 'gpt-4o', 'claude-haiku-5-5', 'claude-sonnet-5-5', 'gemini-2.5-flash'].map((m) => <option key={m}>{m}</option>)}</Select></Field>
            <div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="Temperature"><Slider value={30} onChange={() => undefined} /></Field><Field label="Max reply tokens"><Input defaultValue="220" type="number" /></Field></div></Q>} /></TabPanel>

        <TabPanel value="knowledge"><Q title="What does your agent know?" hint="Tick the sources it can use when answering.">
          <div className="space-y-2">{knowledge.filter((k) => k.status === 'ready').map((k) => <label key={k.id} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 hover:bg-muted"><input type="checkbox" checked={d.kb.includes(k.id)} onChange={() => up({ kb: d.kb.includes(k.id) ? d.kb.filter((x) => x !== k.id) : [...d.kb, k.id] })} /><span className="flex-1 font-medium">{k.title}</span><Badge>{k.kind}</Badge></label>)}</div></Q></TabPanel>

        <TabPanel value="tools"><Q title="What can your agent do?" hint="Switch on the abilities you want.">
          <div className="divide-y">{toolList.map(([k, t, p]) => <div key={k} className="flex items-center justify-between py-3"><div><div className="font-medium">{t}</div><div className="text-[13px] text-soft">{p}</div></div><Switch label={t} checked={d.tools.includes(k)} onChange={(v) => up({ tools: v ? [...d.tools, k] : d.tools.filter((x) => x !== k) })} /></div>)}</div></Q></TabPanel>

        <TabPanel value="flow"><Q title="Call flow" hint="Plan how a call moves from hello to goodbye. Click a step to edit it."><CallFlowEditor value={d.flow} onChange={(flow) => up({ flow })} /></Q></TabPanel>

        <TabPanel value="behavior"><Q title="How should it behave?">
          <div className="grid gap-6 sm:grid-cols-2">
            <Field label="How patient it is" hint={<span className="text-xs text-soft">Waits longer for callers to finish</span>}><Slider value={d.patience} onChange={(v) => up({ patience: v })} /></Field>
            <Field label={<Friendly label="How easily callers can interrupt" tech="VAD sensitivity" /> as unknown as string}><Slider value={d.interrupt} onChange={(v) => up({ interrupt: v })} /></Field>
            <Field label="How chatty it is"><Slider value={d.chatty} onChange={(v) => up({ chatty: v })} /></Field>
            <Field label="Longest call (minutes)"><Input type="number" value={d.maxMin} onChange={(e) => up({ maxMin: +e.target.value })} /></Field>
            <Field label="If nobody picks up"><Select value={d.voicemail} onChange={(e) => up({ voicemail: e.target.value })}><option value="leave">Leave a short voicemail</option><option value="hang">Hang up</option><option value="retry">Try again later</option></Select></Field></div>
          <AdvancedOnly><div className="mt-6 grid gap-4 border-t pt-6 sm:grid-cols-3"><Field label="VAD threshold"><Input defaultValue="0.55" /></Field><Field label="Silence timeout (ms)"><Input defaultValue="700" /></Field><Field label="Backchannel"><Select><option>On</option><option>Off</option></Select></Field></div></AdvancedOnly></Q></TabPanel>

        <TabPanel value="phone"><Q title="Phone numbers" hint="Calls to these numbers go to this agent.">
          <div className="space-y-2">{numbers.map((n) => { const on = agent.numbers.includes(n.id); return <div key={n.id} className="flex items-center justify-between rounded-lg border p-3"><div><div className="num font-medium">{n.number}</div><div className="text-xs text-soft">{n.country} · {n.type}</div></div><Button size="sm" variant={on ? 'secondary' : 'primary'} onClick={() => { updateAgent(agent.id, { numbers: on ? agent.numbers.filter((x) => x !== n.id) : [...agent.numbers, n.id] }); toast.success(on ? 'Number removed' : 'Number attached') }}>{on ? 'Remove' : 'Attach'}</Button></div> })}</div></Q></TabPanel>

        <TabPanel value="test"><Q title="Try it out"><VoicePlayground agentId={agent.id} /><div className="mt-4 text-right"><Button onClick={() => { up({ tested: true }); toast.success('Nice! Marked as tested.') }}>I tried it — looks good</Button></div></Q></TabPanel>

        <TabPanel value="versions"><Q title="Version history" hint="Go back to an earlier version any time.">
          <div className="space-y-2">{versions.map((v) => <div key={v.v} className="rounded-lg border p-3"><div className="flex flex-wrap items-center gap-3"><History size={16} className="text-soft" /><div className="flex-1"><span className="font-medium">Version {v.v}</span> <span className="text-soft">— {v.note}</span><div className="text-xs text-soft">{v.when} · {v.who}</div></div>
            <Button size="sm" variant="ghost" onClick={() => setDiff(diff === v.v ? null : v.v)}>{diff === v.v ? 'Hide changes' : 'See changes'}</Button><Button size="sm" onClick={() => { up({ prompt: v.prompt }); toast.success(`Restored version ${v.v}. Save to keep it.`) }}>Restore</Button></div>
            {diff === v.v && <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">{(() => { const a = new Set(v.prompt.split('\n')), b = new Set(d.prompt.split('\n')); return [...new Set([...b, ...a])].map((l, i) => <div key={i} className={cn(a.has(l) && !b.has(l) && 'bg-ok/15 text-ok', b.has(l) && !a.has(l) && 'bg-bad/15 text-bad')}>{a.has(l) && !b.has(l) ? '+ ' : b.has(l) && !a.has(l) ? '− ' : '  '}{l}</div>) })()}</pre>}</div>)}</div></Q></TabPanel>

        <TabPanel value="publish"><Q title="Ready to go live?" hint="Green means ready. Orange means it will still work, but could be better.">
          <ul className="space-y-2">{checks.map((c) => <li key={c.t} className={cn('flex items-center gap-3 rounded-lg p-3', c.ok ? 'bg-ok/10' : 'bg-warn/10')}>{c.ok ? <Check size={18} className="text-ok" /> : <AlertTriangle size={18} className="text-warn" />}<span className="flex-1 font-medium">{c.t}</span>{!c.ok && <span className="text-[13px] text-warn">{c.fix}</span>}</li>)}</ul>
          <div className="mt-6 flex items-center gap-3"><Button variant="primary" size="lg" disabled={agent.status === 'live'} onClick={() => { updateAgent(agent.id, { status: 'live' }); toast.success('🎉 Your agent is live!') }}><Rocket size={18} />{agent.status === 'live' ? 'Already live' : 'Go live'}</Button>{agent.status !== 'live' && checks.some((c) => !c.ok) && <span className="text-sm text-soft">You can still go live with orange items.</span>}</div></Q></TabPanel>
      </Tabs>
      <UnsavedBar show={dirty} onSave={save} onDiscard={() => setD(saved)} />
    </>
  )
}
