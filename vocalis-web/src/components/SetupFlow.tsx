import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, Globe, Loader2, Mic, Pencil, Phone, Play, Plug, Sparkles, X, type LucideIcon } from '@/components/icons'
import { Badge, Button, Chip, Input, Textarea } from '@/components/ui'
import { MeshBadge } from '@/layout/Shell'
import { http } from '@/lib/api/http'
import { API_URL } from '@/lib/api/env'
import { agentsApi, toAgent } from '@/lib/api/agents'
import { useData } from '@/store/data'
import { useUI } from '@/store/ui'
import { cn } from '@/lib/utils'

/** Guided setup in the home chat: website > what the business does > what the agent should do > everything set up in one go. */
type Suggest = { key: string; title?: string; why: string }
type Profile = { business: string; summary: string; industry: string; services: string[]; hours: string | null; location: string | null; phone: string | null; email: string | null; languages: string[]; faqs: { q: string; a: string }[]; suggested: Suggest[] }
type Research = { url: string | null; pages: { url: string; title: string }[]; profile: Profile; text: string; by_ai: boolean }
type State = { website: string | null; website_docs: { id: string; url: string | null }[]; knowledge_count: number; agents: { id: string; name: string; role: string; status: string }[]; recommended: Suggest[] }
type Voice = { id: string; name: string; language: string; engine?: string; reason?: string; alternatives?: { id: string; name: string; language: string }[] }
type Plan = { agent: { name: string; emoji: string; role: string; tone: string; business: string; what_you_do: string; script: string; generated: boolean }; languages: string[]; voice: Voice | null; tools: { key: string; why: string; connected: boolean }[]; knowledge: { website: string | null; faqs: number; has_profile: boolean } }
type Num = { id: string; number: string; agent_id: string | null; agent_name: string | null }
type Task = { id: string; label: string; status: 'wait' | 'run' | 'ok' | 'fail' | 'skip'; note?: string }
type Step = 'boot' | 'website' | 'describe' | 'reading' | 'profile' | 'usecase' | 'language' | 'planning' | 'plan' | 'running' | 'done'

const LANGS = ['English', 'Hindi', 'Marathi', 'Gujarati', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Bengali', 'Punjabi']
const COMMON: Suggest[] = [
  { key: 'receptionist', title: 'Answer calls', why: 'Greet callers, answer questions, take messages' }, { key: 'appointments', title: 'Book appointments', why: 'Fill your calendar without picking up the phone' },
  { key: 'leads', title: 'Qualify leads', why: 'Find out who is ready to buy' }, { key: 'support', title: 'Customer support', why: 'Solve common problems, any hour' },
  { key: 'orders', title: 'Take orders', why: 'Collect orders and confirm the total' }, { key: 'survey', title: 'Run surveys', why: 'Short feedback calls' },
]
const TITLES: Record<string, string> = { receptionist: 'Front desk', appointments: 'Bookings', leads: 'Sales qualifier', support: 'Support', orders: 'Order taker', survey: 'Survey', reminders: 'Payment reminders', clinic: 'Clinic assistant', dental: 'Dental desk', salon: 'Salon concierge', realestate: 'Property assistant', restaurant: 'Restaurant host', coaching: 'Admissions counsellor', hotel: 'Hotel reservations', homeservices: 'Service dispatcher', loans: 'Loan enquiries', insurance: 'Insurance desk', carservice: 'Service centre', cardealer: 'Showroom assistant', legal: 'Law office intake', accounting: 'Accounts desk', orderstatus: 'Order status', fitness: 'Gym front desk', travel: 'Travel planner', school: 'School office', pharmacy: 'Pharmacy helper', diagnostics: 'Lab booking', rentals: 'Rental desk', cleaning: 'Cleaning bookings', catering: 'Catering enquiries', storehelp: 'Store assistant' }
const title = (s: Suggest) => s.title ?? TITLES[s.key] ?? s.key
const host = (u: string | null) => { try { return new URL(u ?? '').hostname.replace(/^www\./, '') } catch { return u ?? '' } }
const KEEP = (ws: string) => `swarvo-profile:${ws || 'default'}`
const loadProfile = (ws: string): Research | null => { try { return JSON.parse(localStorage.getItem(KEEP(ws)) || 'null') } catch { return null } }
const saveProfile = (ws: string, r: Research) => { try { localStorage.setItem(KEEP(ws), JSON.stringify(r)) } catch { /* private window: it is simply asked again next time */ } }
const say = (e: unknown, fallback = 'Something went wrong. Please try again.') => (e instanceof Error ? e.message : fallback)

function Ai({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 animate-fade-in">
      <MeshBadge className="mt-0.5 h-7 w-7 shrink-0 rounded-lg"><Sparkles size={13} /></MeshBadge>
      <div className="min-w-0 flex-1 pt-0.5 text-[14.5px] leading-relaxed">{children}</div>
    </div>
  )
}
const Me = ({ children }: { children: React.ReactNode }) => <div className="flex justify-end animate-fade-in"><div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-[14.5px]">{children}</div></div>
const Panel = ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={cn('ml-10 rounded-2xl border bg-surface p-4 animate-fade-in sm:p-5', className)}>{children}</div>
const Row = ({ icon: I, title, children, on = true }: { icon: LucideIcon; title: string; children?: React.ReactNode; on?: boolean }) => (
  <div className={cn('flex gap-3 border-t py-3.5 first:border-0 first:pt-0 last:pb-0', !on && 'opacity-50')}>
    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-soft"><I size={15} /></span>
    <div className="min-w-0 flex-1"><div className="text-[13.5px] font-semibold">{title}</div><div className="mt-1 text-[13px] text-soft">{children}</div></div>
  </div>
)

export default function SetupFlow({ onExit }: { onExit: () => void }) {
  const nav = useNavigate()
  const qc = useQueryClient()
  const ws = useUI((u) => u.workspaceId) ?? ''
  const setUI = useUI((u) => u.set)
  const [step, setStep] = React.useState<Step>('boot')
  const [log, setLog] = React.useState<{ who: 'ai' | 'me'; text: React.ReactNode }[]>([])
  const [st, setSt] = React.useState<State | null>(null)
  const [url, setUrl] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [res, setRes] = React.useState<Research | null>(null)
  const [edit, setEdit] = React.useState(false)
  const [job, setJob] = React.useState<Suggest | null>(null)
  const [own, setOwn] = React.useState('')
  const [langs, setLangs] = React.useState<string[]>([])
  const [plan, setPlan] = React.useState<Plan | null>(null)
  const [voice, setVoice] = React.useState<Voice | null>(null)
  const [nums, setNums] = React.useState<Num[]>([])
  const [numId, setNumId] = React.useState('')
  const [human, setHuman] = React.useState('')
  const [withKnowledge, setWithKnowledge] = React.useState(true)
  const [tasks, setTasks] = React.useState<Task[]>([])
  const [made, setMade] = React.useState<{ id: string; name: string } | null>(null)
  const [pct, setPct] = React.useState(0)
  const [busy, setBusy] = React.useState(false)
  const [heard, setHeard] = React.useState<string | null>(null)
  const audio = React.useRef<HTMLAudioElement | null>(null)
  const end = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [log, step, tasks])
  React.useEffect(() => () => { audio.current?.pause() }, [])

  const ai = (t: React.ReactNode) => setLog((l) => [...l, { who: 'ai', text: t }])
  const me = (t: React.ReactNode) => setLog((l) => [...l, { who: 'me', text: t }])

  // ---- 1. look at what is already set up
  React.useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const s = await http<State>('/assistant/setup/state')
        if (!live) return
        setSt(s)
        if (s.website) {
          setRes(loadProfile(ws))
          ai(<>I already know your business from <b>{host(s.website)}</b>, so I won't ask again.{s.agents.length > 0 && <> You have {s.agents.length === 1 ? 'one agent' : `${s.agents.length} agents`} so far.</>} Want another agent? Here is what I would add next. Or tell me something else.</>)
          setStep('usecase')
        } else {
          ai(<>Let's get an agent live for your business, step by step. <b>What's your website?</b> I'll read it, and learn what you do, so you don't have to type it all out.</>)
          setStep('website')
        }
      } catch (e) { if (live) { ai(say(e)); setStep('website') } }
    })()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- 2. read the website
  const research = async (u: string, n: string) => {
    setStep('reading'); setPct(8); setBusy(true)
    const tick = setInterval(() => setPct((p) => Math.min(92, p + 6)), 1200)
    try {
      const r = await http<Research>('/assistant/setup/research', { method: 'POST', json: { url: u, notes: n }, timeoutMs: 120000 })
      clearInterval(tick); setPct(100); setRes(r); saveProfile(ws, r)
      setLangs(r.profile.languages.slice(0, 2))
      ai(r.pages.length ? <>I read {r.pages.length === 1 ? 'your home page' : `${r.pages.length} pages`} of <b>{host(r.url)}</b>. Here is what I understood.</> : <>Thanks. Here is what I understood from what you wrote.</>)
      setStep('profile')
    } catch (e) {
      clearInterval(tick)
      ai(<>{say(e, "I couldn't read that.")} You can try another address, or tell me about your business in a few sentences.</>)
      setStep(u && !n ? 'website' : 'describe')
    } finally { setBusy(false) }
  }

  // ---- 3. choose the job and languages, then prepare the plan
  const chooseJob = (s: Suggest) => { setJob(s); me(title(s)); askLanguage() }
  const chooseOwn = () => { const t = own.trim(); if (t.length < 4) return; const s = { key: 'custom', title: t, why: '' }; setJob(s); me(t); askLanguage() }
  const askLanguage = () => {
    const have = (res?.profile.languages ?? []).slice(0, 2)
    setLangs(have.length ? have : ['English'])
    ai(<>Which language should callers hear? Pick one or two. Each is always written in its own script.</>)
    setStep('language')
  }
  const prepare = async (profile: Research | null, j: Suggest, chosen: string[]) => {
    setStep('planning'); setBusy(true); setPct(10)
    const tick = setInterval(() => setPct((p) => Math.min(92, p + 7)), 900)
    try {
      let r = profile
      if (!r && st?.website) { // knowledge exists, but the profile is not on this device: read the site again, quietly
        try { r = await http<Research>('/assistant/setup/research', { method: 'POST', json: { url: st.website, notes: '' }, timeoutMs: 120000 }); setRes(r); saveProfile(ws, r) } catch { r = null }
      }
      const p = await http<Plan>('/assistant/setup/plan', { method: 'POST', json: { usecase: j.key === 'custom' ? j.title : j.key, languages: chosen, profile: r?.profile ?? {}, website: r?.url ?? st?.website ?? null, wishes: j.key === 'custom' ? j.title : '' }, timeoutMs: 120000 })
      clearInterval(tick); setPct(100); setPlan(p); setVoice(p.voice)
      try { setNums(await http<Num[]>('/numbers')) } catch { setNums([]) }
      ai(<>Here is what I'll set up for <b>{p.agent.name}</b>. Check it over, change anything, then press the button.</>)
      setStep('plan')
    } catch (e) { clearInterval(tick); ai(<>{say(e)} Pick again when you're ready.</>); setStep('usecase') } finally { setBusy(false) }
  }

  // ---- 4. do it
  const patchTask = (id: string, p: Partial<Task>) => setTasks((t) => t.map((x) => (x.id === id ? { ...x, ...p } : x)))
  const run = async () => {
    if (!plan) return
    const needSite = !!(res?.url && withKnowledge && !st?.website)
    const list: Task[] = [
      ...(withKnowledge ? [{ id: 'kb', label: needSite ? 'Add your website and business notes to knowledge' : 'Use the knowledge you already have', status: 'wait' as const }] : []),
      { id: 'agent', label: `Create ${plan.agent.name}`, status: 'wait' },
      { id: 'voice', label: voice ? `Give it the ${voice.name} voice and set its languages` : 'Set its languages', status: 'wait' },
      ...(withKnowledge ? [{ id: 'attach', label: 'Teach the agent from that knowledge', status: 'wait' as const }] : []),
      ...(human.trim() ? [{ id: 'human', label: 'Set up handover to a person', status: 'wait' as const }] : []),
      ...(numId ? [{ id: 'number', label: 'Connect the phone number', status: 'wait' as const }] : []),
    ]
    setTasks(list); setStep('running'); setBusy(true)
    const docIds: string[] = []
    try {
      if (withKnowledge) {
        patchTask('kb', { status: 'run' })
        try {
          if (needSite) await http('/knowledge/url', { method: 'POST', json: { url: res!.url, refresh_hours: 24 } })
          if (res?.text && (needSite || !st?.website)) await http('/knowledge/text', { method: 'POST', json: { title: `${plan.agent.business || 'Business'} profile`.slice(0, 100), text: res.text } }).catch(() => undefined)
          if (res?.profile.faqs.length && (needSite || !st?.website)) await http('/knowledge/qa', { method: 'POST', json: { title: `${plan.agent.business || 'Business'} questions`.slice(0, 100), pairs: res.profile.faqs } }).catch(() => undefined)
          const docs = await http<{ id: string; title: string; kind: string }[]>('/knowledge')
          const names = [`${plan.agent.business || 'Business'} profile`, `${plan.agent.business || 'Business'} questions`]
          docs.filter((d) => d.kind === 'Website' || names.some((n) => d.title.startsWith(n.slice(0, 40)))).forEach((d) => docIds.push(d.id))
          patchTask('kb', { status: 'ok' })
        } catch (e) { patchTask('kb', { status: 'fail', note: say(e) }) }
      }
      patchTask('agent', { status: 'run' })
      let agent: { id: string; name: string }
      try {
        const a = plan.agent
        agent = await agentsApi.create({ name: a.name, template: job && job.key !== 'custom' ? job.key : null, role: a.role, business: a.business, what_you_do: a.what_you_do, script: a.script, tone: a.tone, emoji: a.emoji })
        patchTask('agent', { status: 'ok' }); setMade({ id: agent.id, name: agent.name })
        try { useData.getState().upsertAgent(toAgent(await agentsApi.get(agent.id))) } catch { /* the Agents page reloads on its own */ }
      } catch (e) { patchTask('agent', { status: 'fail', note: say(e) }); throw e }
      patchTask('voice', { status: 'run' })
      try { await http(`/agents/${agent.id}`, { method: 'PATCH', json: { ...(voice ? { voice_id: voice.id } : {}), style: { languages: plan.languages } } }); patchTask('voice', { status: 'ok' }) } catch (e) { patchTask('voice', { status: 'fail', note: say(e) }) }
      if (withKnowledge) {
        patchTask('attach', { status: 'run' })
        try { if (docIds.length) await http(`/knowledge/agent/${agent.id}`, { method: 'PUT', json: { document_ids: docIds } }); patchTask('attach', { status: docIds.length ? 'ok' : 'skip', note: docIds.length ? undefined : 'Nothing to attach yet' }) } catch (e) { patchTask('attach', { status: 'fail', note: say(e) }) }
      }
      if (human.trim()) { patchTask('human', { status: 'run' }); try { await http(`/tools/handover/${agent.id}`, { method: 'PUT', json: { number: human.trim() } }); patchTask('human', { status: 'ok' }) } catch (e) { patchTask('human', { status: 'fail', note: say(e) }) } }
      if (numId) { patchTask('number', { status: 'run' }); try { await http(`/numbers/${numId}/assign`, { method: 'POST', json: { agent_id: agent.id } }); patchTask('number', { status: 'ok' }) } catch (e) { patchTask('number', { status: 'fail', note: say(e) }) } }
      void qc.invalidateQueries()
      try { const s = await http<State>('/assistant/setup/state'); setSt(s) } catch { /* the next round asks again */ }
      ai(<>All set. <b>{agent.name}</b> is ready to try. It is saved as a draft, so nobody can reach it until you put it live.</>)
      setStep('done')
    } catch { ai(<>I stopped because the agent could not be created. Nothing else was changed. You can try again.</>); setStep('plan') } finally { setBusy(false) }
  }

  const hear = (id: string) => {
    audio.current?.pause()
    const a = new Audio(`${API_URL}/voices/${id}/sample`); audio.current = a; setHeard(id)
    a.onended = () => setHeard(null); a.onerror = () => setHeard(null)
    void a.play().catch(() => setHeard(null))
  }
  const goLive = async () => {
    if (!made) return
    setBusy(true)
    try { await agentsApi.publish(made.id); void qc.invalidateQueries(); ai(<><b>{made.name}</b> is live. Callers can reach it on any number you connected to it.</>) } catch (e) { ai(<>It isn't ready to go live yet: {say(e)} <button className="font-semibold text-accent underline underline-offset-2" onClick={() => nav(`/agents/${made.id}?tab=publish`)}>See what's missing</button></>) } finally { setBusy(false) }
  }
  const another = () => { setJob(null); setPlan(null); setMade(null); setTasks([]); setOwn(''); ai(<>Sure. What should the next agent do?</>); setStep('usecase') }
  const toggleLang = (l: string) => setLangs((c) => (c.includes(l) ? c.filter((x) => x !== l) : [...c, l].slice(-2)))

  const suggestions: Suggest[] = React.useMemo(() => {
    const own: Suggest[] = (st?.website ? st.recommended : (res?.profile.suggested ?? [])).map((s) => ({ ...s, title: title(s) }))
    const keys = new Set(own.map((s) => s.key))
    return [...own, ...COMMON.filter((c) => !keys.has(c.key))].slice(0, 8)
  }, [st, res])

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-11rem)] max-w-3xl flex-col">
      <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2 text-[13px] text-soft"><Sparkles size={14} />Guided setup</div>
        <button onClick={onExit} className="rounded-full border bg-surface px-3 py-1 text-xs text-soft transition hover:bg-muted hover:text-ink">Back to chat</button></div>
      <div className="flex-1 space-y-4 pb-24">
        {log.map((m, i) => (m.who === 'ai' ? <Ai key={i}>{m.text}</Ai> : <Me key={i}>{m.text}</Me>))}

        {step === 'boot' && <div className="ml-10 flex items-center gap-2 text-sm text-soft"><Loader2 size={14} className="animate-spin" />Looking at what you already have…</div>}

        {step === 'website' && (
          <Panel>
            <label className="text-[13px] font-medium" htmlFor="site">Your website</label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border bg-surface px-3 focus-within:border-soft/60"><Globe size={15} className="text-soft" />
                <input id="site" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && url.trim()) { me(url.trim()); void research(url.trim(), '') } }} placeholder="www.yourbusiness.com" className="h-11 w-full bg-transparent text-[15px] outline-none placeholder:text-soft/70" /></div>
              <Button variant="primary" size="lg" disabled={!url.trim()} onClick={() => { me(url.trim()); void research(url.trim(), '') }}>Read my website<ArrowRight size={16} /></Button>
            </div>
            <button onClick={() => { me("I don't have a website"); ai(<>No problem. Tell me about your business in a few sentences: what you do, where, your hours, and what callers usually ask.</>); setStep('describe') }} className="mt-3 text-[13px] text-soft underline underline-offset-2 hover:text-ink">I don't have a website</button>
          </Panel>
        )}

        {step === 'describe' && (
          <Panel>
            <Textarea autoFocus className="min-h-[130px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="We run a dental clinic in Pune. Open Monday to Saturday, 10 to 6. People call to book check-ups and ask about prices…" aria-label="About your business" />
            <div className="mt-3 flex justify-end"><Button variant="primary" disabled={notes.trim().length < 15} onClick={() => { me(notes.trim()); void research('', notes.trim()) }}>Continue<ArrowRight size={16} /></Button></div>
          </Panel>
        )}

        {(step === 'reading' || step === 'planning') && (
          <Panel>
            <div className="flex items-center gap-2 text-[13.5px] font-medium"><Loader2 size={15} className="animate-spin text-accent" />{step === 'reading' ? 'Reading your site and writing up what you do…' : 'Writing your agent, picking a voice and lining up the rest…'}</div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${pct}%` }} /></div>
            <p className="mt-2 text-xs text-soft">This usually takes under a minute.</p>
          </Panel>
        )}

        {step === 'profile' && res && (
          <Panel>
            <div className="flex flex-wrap items-center gap-2"><div className="text-[15px] font-semibold">{res.profile.business || 'Your business'}</div>{res.profile.industry !== 'General' && <Badge tone="accent">{res.profile.industry}</Badge>}{!res.by_ai && <Badge>Rough draft</Badge>}</div>
            {edit ? <Textarea className="mt-2 min-h-[100px]" value={res.profile.summary} onChange={(e) => setRes({ ...res, profile: { ...res.profile, summary: e.target.value } })} aria-label="Summary" /> : <p className="mt-1.5 text-[14px] text-soft">{res.profile.summary || 'I could not find much text on the site. Add a few lines about what you do.'}</p>}
            {res.profile.services.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{res.profile.services.map((s) => <Badge key={s}>{s}</Badge>)}</div>}
            <dl className="mt-3 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">{([['Hours', res.profile.hours], ['Where', res.profile.location], ['Phone', res.profile.phone], ['Email', res.profile.email]] as const).filter(([, v]) => v).map(([k, v]) => <div key={k} className="flex gap-2"><dt className="w-12 shrink-0 text-soft">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>)}</dl>
            <p className="mt-3 text-xs text-soft">{res.profile.faqs.length > 0 ? `I found ${res.profile.faqs.length} ${res.profile.faqs.length === 1 ? 'question' : 'questions'} callers are likely to ask, and will teach ${res.profile.faqs.length === 1 ? 'it' : 'them'} to your agent. ` : ''}{res.pages.length > 0 ? `Read: ${res.pages.map((p) => new URL(p.url).pathname || '/').join(', ')}` : ''}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => { setEdit(false); saveProfile(ws, res); me('Looks right'); ai(<>Great. <b>What should your agent do?</b> Pick one, or describe it in your own words.</>); setStep('usecase') }}>Looks right<ArrowRight size={15} /></Button>
              <Button variant="ghost" onClick={() => setEdit((v) => !v)}><Pencil size={14} />{edit ? 'Done editing' : 'Edit the summary'}</Button>
            </div>
          </Panel>
        )}

        {step === 'usecase' && (
          <Panel>
            <div className="grid gap-2 sm:grid-cols-2">
              {suggestions.map((s) => (
                <button key={s.key} onClick={() => chooseJob(s)} className="group rounded-xl border bg-surface p-3.5 text-left transition hover:border-accent/50 hover:bg-muted/40">
                  <div className="text-[13.5px] font-semibold">{title(s)}</div><div className="mt-0.5 text-xs leading-snug text-soft">{s.why}</div>
                </button>
              ))}
            </div>
            <div className="mt-3 flex gap-2"><Input value={own} onChange={(e) => setOwn(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') chooseOwn() }} placeholder="Or describe what it should do…" aria-label="What the agent should do" />
              <Button disabled={own.trim().length < 4} onClick={chooseOwn}>Use this</Button></div>
          </Panel>
        )}

        {step === 'language' && job && (
          <Panel>
            <div className="flex flex-wrap gap-2">{LANGS.map((l) => <Chip key={l} active={langs.includes(l)} onClick={() => toggleLang(l)}>{l}</Chip>)}</div>
            <p className="mt-2 text-xs text-soft">Up to two. Starts in the first one when it cannot tell what the caller speaks.</p>
            <div className="mt-4"><Button variant="primary" disabled={!langs.length || busy} onClick={() => { me(langs.join(' and ')); void prepare(res, job, langs) }}>Continue<ArrowRight size={15} /></Button></div>
          </Panel>
        )}

        {step === 'plan' && plan && (
          <Panel className="space-y-0">
            <Row icon={Sparkles} title="The agent">
              <div className="flex flex-wrap items-center gap-2"><Input className="h-9 w-48" value={plan.agent.name} onChange={(e) => setPlan({ ...plan, agent: { ...plan.agent, name: e.target.value } })} aria-label="Agent name" />{!plan.agent.generated && <Badge>From a template</Badge>}</div>
              <p className="mt-1.5">{plan.agent.role}.</p>
              <details className="mt-1.5"><summary className="cursor-pointer text-xs text-accent">See and edit the call script</summary>
                <Textarea className="mt-2 min-h-[180px] font-mono text-[12.5px]" value={plan.agent.script} onChange={(e) => setPlan({ ...plan, agent: { ...plan.agent, script: e.target.value } })} aria-label="Call script" /></details>
            </Row>
            <Row icon={Globe} title="Knowledge">
              <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={withKnowledge} onChange={(e) => setWithKnowledge(e.target.checked)} />
                {st?.website ? <>Use what I already know from {host(st.website)}</> : res?.url ? <>Add {host(res.url)}{plan.knowledge.faqs ? ` and ${plan.knowledge.faqs} common ${plan.knowledge.faqs === 1 ? 'question' : 'questions'}` : ''} so the agent can answer from it</> : plan.knowledge.has_profile ? <>Add what you told me about the business</> : <>Nothing to add yet</>}</label>
            </Row>
            <Row icon={Mic} title="Voice" on={!!voice}>
              {voice ? (<>
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-ink">{voice.name}</span><span>· {voice.language}</span>
                  <button onClick={() => hear(voice.id)} className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs text-ink transition hover:bg-muted">{heard === voice.id ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}Hear it</button></div>
                {plan.voice && voice.id === plan.voice.id && plan.voice.reason && <p className="mt-1">{plan.voice.reason}</p>}
                {plan.voice && plan.voice.alternatives && plan.voice.alternatives.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">Or try:{[plan.voice as Voice, ...plan.voice.alternatives].filter((v) => v.id !== voice.id).map((v) => <button key={v.id} onClick={() => setVoice(v as Voice)} className="rounded-full border px-2.5 py-1 text-ink transition hover:bg-muted">{v.name}</button>)}</div>}
              </>) : <>No voice is set up for this language yet. You can pick one on the agent's Voice tab after.</>}
            </Row>
            <Row icon={Plug} title="Tools it will want">
              <ul className="space-y-1">{plan.tools.map((t) => <li key={t.key} className="flex items-center gap-2"><span className={cn('flex h-4 w-4 items-center justify-center rounded-full', t.connected ? 'bg-ok/15 text-ok' : 'bg-muted text-soft')}>{t.connected ? <Check size={10} /> : <span className="h-1 w-1 rounded-full bg-soft" />}</span><span className="capitalize">{t.key.replace(/_/g, ' ')}</span><span className="text-xs">{t.connected ? 'connected' : t.why}</span></li>)}</ul>
              <p className="mt-1.5 text-xs">These need your own accounts, so you connect them on the <button className="text-accent underline underline-offset-2" onClick={() => nav('/tools')}>Tools page</button> when you're ready.</p>
            </Row>
            <Row icon={Phone} title="Phone number">
              {nums.length === 0 ? <>You don't have a number yet. After this, <button className="text-accent underline underline-offset-2" onClick={() => nav('/numbers')}>get one</button> (Indian numbers may need an ID check first), and the agent will answer it.</> : (
                <select value={numId} onChange={(e) => setNumId(e.target.value)} className="h-9 w-full max-w-xs rounded-xl border bg-surface px-3 text-sm text-ink" aria-label="Phone number">
                  <option value="">Connect a number later</option>{nums.map((n) => <option key={n.id} value={n.id}>{n.number}{n.agent_name ? ` (now answered by ${n.agent_name})` : ''}</option>)}</select>)}
            </Row>
            <Row icon={Phone} title="Hand over to a person (optional)">
              <Input className="h-9 max-w-xs" value={human} onChange={(e) => setHuman(e.target.value)} placeholder="+919876543210" aria-label="Number to pass calls to" />
              <p className="mt-1 text-xs">When a caller asks for a person, the agent rings this number.</p>
            </Row>
            <div className="mt-5 flex flex-wrap items-center gap-3 border-t pt-4"><Button variant="primary" size="lg" disabled={busy || !plan.agent.name.trim()} onClick={() => { me('Set it all up'); void run() }}><Check size={16} />Set it all up</Button><span className="text-xs text-soft">Nothing goes live until you say so.</span></div>
          </Panel>
        )}

        {(step === 'running' || step === 'done') && tasks.length > 0 && (
          <Panel>
            <ul className="space-y-2.5">{tasks.map((t) => (
              <li key={t.id} className="flex items-start gap-2.5 text-[13.5px]">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full">{t.status === 'run' ? <Loader2 size={15} className="animate-spin text-accent" /> : t.status === 'ok' ? <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ok/15 text-ok"><Check size={12} /></span> : t.status === 'fail' ? <span className="flex h-5 w-5 items-center justify-center rounded-full bg-bad/15 text-bad"><X size={12} /></span> : <span className="h-2 w-2 rounded-full bg-line" />}</span>
                <span className={cn(t.status === 'wait' && 'text-soft')}>{t.label}{t.note && <span className={cn('block text-xs', t.status === 'fail' ? 'text-bad' : 'text-soft')}>{t.note}</span>}</span>
              </li>))}</ul>
          </Panel>
        )}

        {step === 'done' && made && (
          <Panel>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => setUI({ playground: made.id })}><Mic size={15} />Talk to {made.name}</Button>
              <Button disabled={busy} onClick={() => void goLive()}>Put it live</Button>
              <Button variant="ghost" onClick={() => nav(`/agents/${made.id}`)}>Fine-tune it</Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-[13px]"><button onClick={another} className="text-accent underline underline-offset-2">Make another agent</button><button onClick={onExit} className="text-soft underline underline-offset-2">Back to chat</button></div>
          </Panel>
        )}
        <div ref={end} />
      </div>
    </div>
  )
}
