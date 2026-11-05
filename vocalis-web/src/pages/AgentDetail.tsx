import * as React from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CallFlowEditor, defaultFlow, type FlowData } from '@/components/CallFlow'
import { AlertTriangle, Check, History, Mic, Play, Rocket } from '@/components/icons'
import { toast } from 'sonner'
import { Badge, Button, Card, Chip, Field, Input, Select, Slider, Switch, Tab, TabPanel, Tabs, TabsList, Textarea } from '@/components/ui'
import { AdvancedOnly, EmptyState, Friendly, PageHeader, SearchPill, SimpleAdvanced, StatusBadge, UnsavedBar, speak } from '@/components/shared'
import { AgentAvatar } from '@/components/AgentAvatar'
import { VoicePlayground } from '@/components/Playground'
import { useData } from '@/store/data'
import { USE_MOCKS } from '@/lib/api/env'
import { agentsApi, toAgent } from '@/lib/api/agents'
import { fromWorkflowDefinition, toWorkflowDefinition } from '@/lib/flowConvert'
import { AttachPicker } from '@/components/AttachPicker'
import { AgentPhone } from '@/pages/AgentPhone'
import { HumanFeel } from '@/pages/AgentFeel'
import { QAEditor } from '@/components/QAEditor'
import { TryAgent } from '@/components/TryAgent'
import { BrainModel } from '@/pages/BrainModel'
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

/** Search and choose among hundreds of voices. Voices that aren't set up yet are shown but can't be picked. */
export function VoicePick({ voices, value, onPick }: { voices: import('@/mock/types').Voice[]; value: string; onPick: (id: string) => void }) {
  const [q, setQ] = React.useState('')
  const [lang, setLang] = React.useState('')
  const [gender, setGender] = React.useState('')
  const [shown, setShown] = React.useState(24)
  const langs = [...new Set(voices.map((v) => v.lang))].sort()
  const list = voices.filter((v) => (!lang || v.lang === lang) && (!gender || v.gender === gender) && (!q || `${v.name} ${v.style} ${v.description ?? ''}`.toLowerCase().includes(q.toLowerCase())))
  const reset = () => setShown(24)
  const pill = (on: boolean) => cn('shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] transition', on ? 'border-ink bg-ink text-surface' : 'bg-surface text-soft hover:border-soft/50 hover:text-ink')
  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchPill value={q} onChange={(v) => { setQ(v); reset() }} placeholder="Search voices" className="sm:max-w-xs" />
        <div className="flex gap-2">{['', 'Female', 'Male'].map((g) => <button key={g || 'any'} onClick={() => { setGender(g); reset() }} className={pill(gender === g)}>{g || 'Any'}</button>)}</div>
      </div>
      {langs.length > 1 && (
        <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Language">
          <button onClick={() => { setLang(''); reset() }} className={pill(!lang)}>All languages</button>
          {langs.map((l) => <button key={l} onClick={() => { setLang(l); reset() }} className={pill(lang === l)}>{l}</button>)}
        </div>
      )}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{list.slice(0, shown).map((v) => {
        const on = value === v.id
        const off = v.available === false
        return (
          <button key={v.id} disabled={off} onClick={() => onPick(v.id)} title={v.description} aria-pressed={on}
            className={cn('flex min-h-[64px] items-center gap-3 rounded-2xl border bg-surface p-3 text-left transition', on ? 'border-ink ring-1 ring-ink' : 'hover:border-soft/50', off && 'cursor-not-allowed opacity-50')}>
            <AgentAvatar id={v.id} className="h-10 w-10" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium">{v.name}</span>
              <span className="block truncate text-xs text-soft">{[v.lang, v.gender].filter(Boolean).join(' · ')}</span>
              {v.style && <span className="mt-1 block truncate text-xs text-soft/80">{v.style}</span>}
            </span>
            {off ? <Badge tone="accent">Soon</Badge> : on && <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-surface"><Check size={13} /></span>}
          </button>)
      })}
        {list.length === 0 && <p className="col-span-full py-6 text-center text-sm text-soft">No voices match. Try other words.</p>}
      </div>
      {list.length > shown && <Button variant="ghost" className="mt-3 w-full sm:w-auto" onClick={() => setShown(shown + 24)}>Show more ({list.length - shown} left)</Button>}
    </div>
  )
}

export default function AgentDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const agent = useData((s) => s.agents.find((a) => a.id === id))
  const updateAgent = useData((s) => s.updateAgent)
  const voices = useAsync(() => api.voices(), []).data ?? []
  const advanced = useUI((s) => s.view) === 'advanced'
  const [tryOpen, setTryOpen] = React.useState(false)
  const upsertAgent = useData((s) => s.upsertAgent)
  // The list omits the prompt and edit version; load them when an agent is opened.
  React.useEffect(() => {
    if (USE_MOCKS || !id) return
    agentsApi.get(id).then((a) => upsertAgent(toAgent(a, useData.getState().agents.find((x) => x.id === id)))).catch(() => {})
  }, [id, upsertAgent])
  const setUI = useUI((s) => s.set)
  // Real mode: the call flow and version history come from the server.
  const [loadedFlow, setLoadedFlow] = React.useState<FlowData | null>(null)
  const [realVersions, setRealVersions] = React.useState<Awaited<ReturnType<typeof agentsApi.versions>> | null>(null)
  const loadVersions = React.useCallback(() => { if (!USE_MOCKS && id) agentsApi.versions(id).then(setRealVersions).catch(() => {}) }, [id])
  React.useEffect(() => {
    if (USE_MOCKS || !id) return
    agentsApi.flow(id).then((f) => setLoadedFlow(fromWorkflowDefinition(f.definition as never) as unknown as FlowData)).catch(() => {})
    loadVersions()
  }, [id, loadVersions])
  const base = React.useMemo<Draft | null>(() => agent ? ({ ...agent, speed: 50, emotion: 'Warm', model: 'gpt-4o-mini', kb: ['k1', 'k4'], tools: ['calendar', 'book', 'end'], patience: 60, interrupt: 50, chatty: 40, maxMin: 10, voicemail: 'leave', tested: false, flow: loadedFlow ?? defaultFlow() }) : null, [agent?.id, loadedFlow])
  const [saved, setSaved] = React.useState<Draft | null>(base)
  const [d, setD] = React.useState<Draft | null>(base)
  const [diff, setDiff] = React.useState<number | null>(null)
  React.useEffect(() => { setSaved(base); setD(base) }, [base])
  // Opening the Call flow tab shows the latest instructions, tools and knowledge, unless there are unsaved flow edits.
  const flowTab = sp.get('tab') === 'flow'
  React.useEffect(() => {
    if (USE_MOCKS || !flowTab || !agent || (d && saved && JSON.stringify(d.flow) !== JSON.stringify(saved.flow))) return
    agentsApi.flow(agent.id).then((fl) => setLoadedFlow(fromWorkflowDefinition(fl.definition as never) as unknown as FlowData)).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowTab])
  if (!agent || !d || !saved) return <EmptyState emoji="🔍" title="We couldn't find that agent" text="It may have been deleted. Head back to see all your agents." action={<Button variant="primary" size="lg" onClick={() => nav('/agents')}>See all agents</Button>} />
  const dirty = JSON.stringify(d) !== JSON.stringify(saved)
  const up = (p: Partial<Draft>) => setD((x) => (x ? { ...x, ...p } : x))
  const voice = voices.find((v) => v.id === d.voiceId) ?? voices[0] ?? { id: '', name: 'Default', lang: '', gender: '', age: '', accent: '', style: '', provider: '' }
  const tab = sp.get('tab') ?? 'flow'
  const save = async () => {
    if (!USE_MOCKS && JSON.stringify(d.flow) !== JSON.stringify(saved.flow)) {
      try {
        await agentsApi.saveFlow(agent.id, toWorkflowDefinition(d.flow as never), agent.version)
        upsertAgent(toAgent(await agentsApi.get(agent.id), agent))
        loadVersions()
      } catch (e) { toast.error(e instanceof Error ? e.message : 'We could not save your call flow.'); return }
    }
    updateAgent(agent.id, { name: d.name, voiceId: d.voiceId, brain: d.brain, tone: d.tone, business: d.business, whatYouDo: d.whatYouDo, script: d.script, prompt: d.prompt }); setSaved(d); toast.success('Saved!')
  }

  const versionList = USE_MOCKS ? versions : (realVersions ?? []).map((v) => ({
    v: v.number,
    when: new Date(v.published_at ?? v.created_at ?? Date.now()).toLocaleString(),
    who: v.status === 'draft' ? 'Not live yet' : v.status === 'published' ? 'Current' : 'Earlier',
    note: v.status === 'draft' ? 'Working draft' : v.status === 'published' ? 'Published version' : 'Earlier version',
    prompt: v.prompt,
  }))
  const restore = async (v: { v: number; prompt: string }) => {
    if (USE_MOCKS) { up({ prompt: v.prompt }); toast.success(`Restored version ${v.v}. Save to keep it.`); return }
    try {
      const a = await agentsApi.restoreVersion(agent.id, v.v)
      upsertAgent(toAgent(a, agent))
      setLoadedFlow(fromWorkflowDefinition((await agentsApi.flow(agent.id)).definition as never) as unknown as FlowData)
      loadVersions()
      toast.success(`Restored version ${v.v} as your working draft. Go live when you're ready.`)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'We could not restore that version.') }
  }

  const brainCards = [['fast', 'Fast', 'Replies very quickly. Great for simple jobs.', 'Best for: FAQs'], ['balanced', 'Balanced', 'A good mix of speed and smarts.', 'Best for: most businesses'], ['smartest', 'Smartest', 'Thinks harder. A little slower.', 'Best for: tricky conversations']] as const
  const checks = [
    { ok: !!d.prompt.trim(), t: 'Your agent knows what to say', fix: 'Add instructions in Personality' },
    { ok: !!d.voiceId, t: 'A voice is picked', fix: 'Pick a voice' },
    { ok: d.kb.length > 0, t: 'It has knowledge to use', fix: 'Add knowledge' },
    { ok: d.tested, t: 'You tried a test call', fix: 'Try it in the Test tab' },
    { ok: agent.numbers.length > 0, t: 'A phone number is connected', fix: 'Attach a number in Phone' },
  ]

  return (
    <>
      {tab !== 'flow' && (<>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0"><div className="flex items-center gap-2.5"><h1 className="truncate text-2xl font-bold tracking-tight">{d.name}</h1><StatusBadge status={agent.status} /></div>{d.whatYouDo && <p className="mt-1 max-w-2xl truncate text-[13.5px] text-soft">{d.whatYouDo}</p>}</div>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!dirty} onClick={save}>Save</Button>
          <Button onClick={() => setUI({ playground: agent.id })}><Mic size={15} />Preview</Button>
          <Button variant="primary" onClick={() => setSp({ tab: 'publish' })}><Rocket size={15} />Publish</Button>
        </div>
      </div>
      <div className="mb-5 inline-flex rounded-xl bg-muted p-1" role="tablist" aria-label="Agent view">
        {[['flow', 'Flow'], ['config', 'Configuration']].map(([k, label]) => {
          const on = k === 'flow' ? tab === 'flow' : tab !== 'flow'
          return <button key={k} role="tab" aria-selected={on} onClick={() => setSp({ tab: k === 'flow' ? 'flow' : tab === 'flow' ? 'personality' : tab })} className={cn('rounded-lg px-4 py-1.5 text-sm font-medium transition', on ? 'bg-surface text-ink shadow-card' : 'text-soft hover:text-ink')}>{label}</button>
        })}
      </div>
      </>)}
      <Tabs value={tab} onValueChange={(t) => setSp({ tab: t })}>
        {tab !== 'flow' && <TabsList>{['personality', 'voice', 'brain', 'knowledge', 'qa', 'tools', 'behavior', 'phone', 'test', 'versions', 'publish'].filter((t) => (t !== 'brain' || voice.brainLevels !== false) && (advanced || !['behavior', 'versions'].includes(t) || t === tab)).map((t) => <Tab key={t} value={t} className="capitalize">{t === 'qa' ? 'Q&A' : t}</Tab>)}</TabsList>}

        <TabPanel value="personality"><SimpleAdvanced
          simple={<Q title="Who is your agent?" hint="Just fill in the blanks. We write the instructions for you.">
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Agent name"><Input value={d.name} onChange={(e) => up({ name: e.target.value })} /></Field><Field label="Business name"><Input value={d.business} onChange={(e) => up({ business: e.target.value })} /></Field></div>
            <Field label="What do you do?" className="mt-4"><Textarea value={d.whatYouDo} onChange={(e) => up({ whatYouDo: e.target.value })} /></Field>
            <Field label="Script (optional)" hint={<span className="text-xs text-soft">What the agent should say and in what order. It follows it, but stays natural.</span>} className="mt-4"><Textarea className="min-h-[140px]" placeholder={"1. Greet the caller and ask how you can help.\n2. Ask for their name and phone number.\n3. Offer the next free appointment and confirm it."} value={d.script ?? ''} onChange={(e) => up({ script: e.target.value })} /></Field>
            <div className="mt-4"><div className="mb-2 text-[13px] font-medium">How should it sound?</div><div className="flex gap-2">{['Friendly', 'Professional', 'Playful'].map((t) => <Chip key={t} active={d.tone === t} onClick={() => up({ tone: t })}>{t}</Chip>)}</div></div></Q>}
          advanced={<Q title="Raw prompt" hint="The exact instructions the AI follows. Click a chip to insert a variable.">
            <div className="mb-3 flex flex-wrap gap-2">{['{{caller_name}}', '{{business_name}}', '{{current_time}}', '{{caller_phone}}'].map((v) => <button key={v} onClick={() => up({ prompt: d.prompt + ' ' + v })} className="rounded-md bg-accent-soft px-2 py-1 font-mono text-xs text-accent hover:brightness-95">{v}</button>)}</div>
            <Textarea className="min-h-[280px] font-mono text-[13px]" value={d.prompt} onChange={(e) => up({ prompt: e.target.value })} aria-label="Prompt" /></Q>} /></TabPanel>

        <TabPanel value="voice"><Q title="Pick a voice" hint="Press play to hear each one.">
          <VoicePick voices={voices} value={d.voiceId} onPick={(id) => up({ voiceId: id })} />
          {!USE_MOCKS && <HumanFeel agent={agent} studio={voice.brainLevels !== false} />}
          {USE_MOCKS && <>
          <div className="mt-6 grid gap-6 sm:grid-cols-3">
            <Field label="Language"><Select defaultValue={voice.lang}>{[...new Set(voices.map((v) => v.lang))].map((l) => <option key={l}>{l}</option>)}</Select></Field>
            <Field label="Speaking speed" hint={<span className="text-xs text-soft">{d.speed < 40 ? 'Slow' : d.speed > 60 ? 'Fast' : 'Normal'}</span>}><Slider value={d.speed} onChange={(v) => up({ speed: v })} label="Speed" /></Field>
            <Field label="Mood"><Select value={d.emotion} onChange={(e) => up({ emotion: e.target.value })}>{['Warm', 'Calm', 'Cheerful', 'Serious'].map((l) => <option key={l}>{l}</option>)}</Select></Field></div></>}</Q></TabPanel>

        <TabPanel value="brain"><SimpleAdvanced
          simple={<div className="grid gap-4 md:grid-cols-3">{brainCards.map(([k, t, p, b]) => <button key={k} onClick={() => up({ brain: k })} className={cn('rounded-xl border bg-surface p-5 text-left shadow-card transition hover:border-accent', d.brain === k && 'border-accent ring-2 ring-accent/20')}><div className="text-lg font-semibold">{t}</div><p className="mt-1 text-soft">{p}</p><Badge tone="accent" className="mt-3">{b}</Badge></button>)}</div>}
          advanced={USE_MOCKS ? <Q title="Model" hint="Which language model writes the replies."><Field label="Model"><Select value={d.model} onChange={(e) => up({ model: e.target.value })}>{['gpt-4o-mini', 'gpt-4o', 'claude-haiku-5-5', 'claude-sonnet-5-5', 'gemini-2.5-flash'].map((m) => <option key={m}>{m}</option>)}</Select></Field>
            <div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="Temperature"><Slider value={30} onChange={() => undefined} /></Field><Field label="Max reply tokens"><Input defaultValue="220" type="number" /></Field></div></Q> : <></>} />{!USE_MOCKS && voice.brainLevels !== false && <BrainModel agent={agent} />}</TabPanel>

        <TabPanel value="knowledge">{USE_MOCKS ? (<><Q title="What does your agent know?" hint="Tick the sources it can use when answering.">
          <div className="space-y-2">{knowledge.filter((k) => k.status === 'ready').map((k) => <label key={k.id} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 hover:bg-muted"><input type="checkbox" checked={d.kb.includes(k.id)} onChange={() => up({ kb: d.kb.includes(k.id) ? d.kb.filter((x) => x !== k.id) : [...d.kb, k.id] })} /><span className="flex-1 font-medium">{k.title}</span><Badge>{k.kind}</Badge></label>)}</div></Q></>) : <Q title="What does your agent know?" hint="Tick the sources it can use when answering."><AttachPicker kind="knowledge" agentId={agent.id} /></Q>}</TabPanel>

        <TabPanel value="tools">{USE_MOCKS ? (<><Q title="What can your agent do?" hint="Switch on the abilities you want.">
          <div className="divide-y">{toolList.map(([k, t, p]) => <div key={k} className="flex items-center justify-between py-3"><div><div className="font-medium">{t}</div><div className="text-[13px] text-soft">{p}</div></div><Switch label={t} checked={d.tools.includes(k)} onChange={(v) => up({ tools: v ? [...d.tools, k] : d.tools.filter((x) => x !== k) })} /></div>)}</div></Q></>) : <Q title="What can your agent do?" hint="Tick the tools it may use during a call."><AttachPicker kind="tools" agentId={agent.id} /></Q>}</TabPanel>

        <TabPanel value="flow"><CallFlowEditor header={
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-surface px-3 py-2">
        <div className="flex min-w-0 items-center gap-2"><h1 className="truncate text-[15px] font-bold">{d.name}</h1><StatusBadge status={agent.status} /></div>
        <div className="inline-flex rounded-lg bg-muted p-0.5" role="tablist" aria-label="Agent view">
          {[['flow', 'Flow'], ['config', 'Configuration']].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={k === 'flow'} onClick={() => setSp({ tab: k === 'flow' ? 'flow' : 'personality' })} className={cn('rounded-md px-3 py-1 text-[13px] font-medium transition', k === 'flow' ? 'bg-surface text-ink shadow-card' : 'text-soft hover:text-ink')}>{label}</button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" disabled={!dirty} onClick={save}>Save</Button>
          <Button size="sm" onClick={() => setUI({ playground: agent.id })}><Mic size={14} />Preview</Button>
          <Button size="sm" variant="primary" onClick={() => setSp({ tab: 'publish' })}><Rocket size={14} />Publish</Button>
        </div>
      </div>
      } value={d.flow} onChange={(flow) => up({ flow })} onSimulate={USE_MOCKS ? undefined : async () => { if (dirty) await save(); setTryOpen(true) }} />{!USE_MOCKS && <TryAgent agentId={agent.id} open={tryOpen} onOpenChange={setTryOpen} />}</TabPanel>

        <TabPanel value="qa"><QAEditor agent={agent} /></TabPanel>

        <TabPanel value="behavior"><Q title="How should it behave?">
          <div className="grid gap-6 sm:grid-cols-2">
            <Field label="How patient it is" hint={<span className="text-xs text-soft">Waits longer for callers to finish</span>}><Slider value={d.patience} onChange={(v) => up({ patience: v })} /></Field>
            <Field label={<Friendly label="How easily callers can interrupt" tech="VAD sensitivity" /> as unknown as string}><Slider value={d.interrupt} onChange={(v) => up({ interrupt: v })} /></Field>
            <Field label="How chatty it is"><Slider value={d.chatty} onChange={(v) => up({ chatty: v })} /></Field>
            <Field label="Longest call (minutes)"><Input type="number" value={d.maxMin} onChange={(e) => up({ maxMin: +e.target.value })} /></Field>
            <Field label="If nobody picks up"><Select value={d.voicemail} onChange={(e) => up({ voicemail: e.target.value })}><option value="leave">Leave a short voicemail</option><option value="hang">Hang up</option><option value="retry">Try again later</option></Select></Field></div>
          <AdvancedOnly><div className="mt-6 grid gap-4 border-t pt-6 sm:grid-cols-3"><Field label="VAD threshold"><Input defaultValue="0.55" /></Field><Field label="Silence timeout (ms)"><Input defaultValue="700" /></Field><Field label="Backchannel"><Select><option>On</option><option>Off</option></Select></Field></div></AdvancedOnly></Q></TabPanel>

        <TabPanel value="phone">{USE_MOCKS ? (<><Q title="Phone numbers" hint="Calls to these numbers go to this agent.">
          <div className="space-y-2">{numbers.map((n) => { const on = agent.numbers.includes(n.id); return <div key={n.id} className="flex items-center justify-between rounded-lg border p-3"><div><div className="num font-medium">{n.number}</div><div className="text-xs text-soft">{n.country} · {n.type}</div></div><Button size="sm" variant={on ? 'secondary' : 'primary'} onClick={() => { updateAgent(agent.id, { numbers: on ? agent.numbers.filter((x) => x !== n.id) : [...agent.numbers, n.id] }); toast.success(on ? 'Number removed' : 'Number attached') }}>{on ? 'Remove' : 'Attach'}</Button></div> })}</div></Q></>) : <AgentPhone agentId={agent.id} live={agent.status === 'live'} />}</TabPanel>

        <TabPanel value="test"><Q title="Try it out"><VoicePlayground agentId={agent.id} /><div className="mt-4 text-right"><Button onClick={() => { up({ tested: true }); toast.success('Nice! Marked as tested.') }}>I tried it — looks good</Button></div></Q></TabPanel>

        <TabPanel value="versions"><Q title="Version history" hint="Go back to an earlier version any time.">
          <div className="space-y-2">{versionList.map((v) => <div key={v.v} className="rounded-lg border p-3"><div className="flex flex-wrap items-center gap-3"><History size={16} className="text-soft" /><div className="flex-1"><span className="font-medium">Version {v.v}</span> <span className="text-soft">— {v.note}</span><div className="text-xs text-soft">{v.when} · {v.who}</div></div>
            <Button size="sm" variant="ghost" onClick={() => setDiff(diff === v.v ? null : v.v)}>{diff === v.v ? 'Hide changes' : 'See changes'}</Button><Button size="sm" onClick={() => restore(v)}>Restore</Button></div>
            {diff === v.v && <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">{(() => { const a = new Set(v.prompt.split('\n')), b = new Set(d.prompt.split('\n')); return [...new Set([...b, ...a])].map((l, i) => <div key={i} className={cn(a.has(l) && !b.has(l) && 'bg-ok/15 text-ok', b.has(l) && !a.has(l) && 'bg-bad/15 text-bad')}>{a.has(l) && !b.has(l) ? '+ ' : b.has(l) && !a.has(l) ? '− ' : '  '}{l}</div>) })()}</pre>}</div>)}</div></Q></TabPanel>

        <TabPanel value="publish"><Q title="Ready to go live?" hint="Green means ready. Orange means it will still work, but could be better.">
          <ul className="space-y-2">{checks.map((c) => <li key={c.t} className={cn('flex items-center gap-3 rounded-lg p-3', c.ok ? 'bg-ok/10' : 'bg-warn/10')}>{c.ok ? <Check size={18} className="text-ok" /> : <AlertTriangle size={18} className="text-warn" />}<span className="flex-1 font-medium">{c.t}</span>{!c.ok && <span className="text-[13px] text-warn">{c.fix}</span>}</li>)}</ul>
          <div className="mt-6 flex items-center gap-3"><Button variant="primary" size="lg" disabled={agent.status === 'live'} onClick={() => { updateAgent(agent.id, { status: 'live' }); toast.success('Your agent is live!') }}><Rocket size={18} />{agent.status === 'live' ? 'Already live' : 'Go live'}</Button>{agent.status !== 'live' && checks.some((c) => !c.ok) && <span className="text-sm text-soft">You can still go live with orange items.</span>}</div></Q></TabPanel>
      </Tabs>
      <UnsavedBar show={dirty} onSave={save} onDiscard={() => setD(saved)} />
    </>
  )
}
