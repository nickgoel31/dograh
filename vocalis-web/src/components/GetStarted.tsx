import * as React from 'react'
import * as DialogP from '@radix-ui/react-dialog'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useQuery } from '@tanstack/react-query'
import { Check, Loader2, Mic, Phone, Play, Rocket, Sparkles, Wallet, X } from '@/components/icons'
import { Button, Chip, Field, Input, Textarea } from '@/components/ui'
import { AgentAvatar } from '@/components/AgentAvatar'
import { VoicePlayground } from '@/components/Playground'
import { MeshBadge } from '@/layout/Shell'
import { http } from '@/lib/api/http'
import { API_URL, USE_MOCKS } from '@/lib/api/env'
import { agentsApi, toAgent } from '@/lib/api/agents'
import { useMe } from '@/lib/useMe'
import { useData } from '@/store/data'
import { useUI } from '@/store/ui'
import { cn, money } from '@/lib/utils'

/** The setup guide: a big dialog that takes someone from nothing to a working agent in two or three minutes. It remembers where they stopped. */
type Form = { business: string; industry: string; what: string; template: string; tone: string; voiceId: string }
type Saved = { step: number; form: Form; agentId?: string; finished?: boolean; autoShown?: boolean }
type Template = { key: string; name: string; emoji: string; color: string; role: string; tone: string; blurb: string }
type Voice = { id: string; name: string; language: string; gender: string | null; provider: string; available: boolean; has_sample: boolean; style: string | null }

const EMPTY: Form = { business: '', industry: '', what: '', template: '', tone: 'Friendly', voiceId: '' }
const KEY = (id: string) => `swarvo-setup:${id}`
const OLD_SEEN = (id: string) => `swarvo-welcome:${id}`
export const loadSetup = (id: string): Saved | null => { try { const r = localStorage.getItem(KEY(id)); return r ? (JSON.parse(r) as Saved) : null } catch { return null } }
const saveSetup = (id: string, s: Saved) => { try { localStorage.setItem(KEY(id), JSON.stringify(s)) } catch { /* it just starts over next time */ } }

const STEPS = [
  { t: 'Welcome', d: 'What we will do' },
  { t: 'Your business', d: 'Who the agent speaks for' },
  { t: 'Its job', d: 'What it should handle' },
  { t: 'Voice & tone', d: 'How it sounds' },
  { t: 'Try it', d: 'Talk to your agent' },
]
const INDUSTRIES: { k: string; what: string }[] = [
  { k: 'Dental clinic', what: 'We run a dental clinic. Callers want to book, move or cancel appointments, and ask about prices, treatments and opening hours.' },
  { k: 'Salon & spa', what: 'We run a salon. Callers want to book services, ask about prices and offers, and change their appointments.' },
  { k: 'Restaurant', what: 'We run a restaurant. Callers want to book a table, ask about the menu, timings and delivery.' },
  { k: 'Real estate', what: 'We are a real estate agency. Callers ask about properties, prices and site visits. Take their name, number and what they are looking for.' },
  { k: 'Online store', what: 'We run an online store. Callers ask about orders, delivery, returns and products.' },
  { k: 'Doctor / clinic', what: 'We run a medical clinic. Callers book appointments, ask about doctors, timings and fees.' },
  { k: 'Something else', what: '' },
]
const TONES = ['Friendly', 'Professional', 'Playful']
const short = (v: number, n: number) => `${v + 1} of ${n}`

/** Shown to a new account once, and any time from the Home page or the search bar. */
export function GetStarted() {
  const me = useMe().data
  const userId = me?.user.id ?? ''
  const nav = useNavigate()
  const guide = useUI((s) => s.guide)
  const setUI = useUI((s) => s.set)
  const agents = useData((s) => s.agents)
  const agentsLoaded = useData((s) => s.agentsLoaded)
  const upsert = useData((s) => s.upsertAgent)
  const [open, setOpen] = React.useState(false)
  const [step, setStep] = React.useState(0)
  const [form, setForm] = React.useState<Form>(EMPTY)
  const [agentId, setAgentId] = React.useState<string | undefined>()
  const [busy, setBusy] = React.useState(false)
  const [playing, setPlaying] = React.useState<string | null>(null)
  const audio = React.useRef<HTMLAudioElement | null>(null)
  const loaded = React.useRef(false)
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => { const t = setTimeout(() => setReady(true), 1500); return () => clearTimeout(t) }, []) // let the page and the balance in the header load first

  const welcome = useQuery({ queryKey: ['welcome'], queryFn: () => http<{ bonus: number; currency: string; minutes_available: number }>('/billing/welcome'), enabled: !USE_MOCKS && !!userId && ready, staleTime: Infinity })
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => http<Template[]>('/agents/templates'), enabled: !USE_MOCKS && open, staleTime: Infinity })
  const voices = useQuery({ queryKey: ['voices', 'setup'], queryFn: () => http<Voice[]>('/voices'), enabled: !USE_MOCKS && open, staleTime: 60_000 })

  // Pick up where the person stopped, and open by itself the first time (an account with no agents that has not seen it yet).
  React.useEffect(() => {
    if (!userId || loaded.current) return
    const s = loadSetup(userId)
    if (s) { setStep(Math.min(s.step, STEPS.length - 1)); setForm({ ...EMPTY, ...s.form }); setAgentId(s.agentId) }
    loaded.current = true
  }, [userId])
  React.useEffect(() => {
    if (!userId || !agentsLoaded || !welcome.data || !loaded.current) return
    const s = loadSetup(userId)
    let oldSeen = false
    try { oldSeen = localStorage.getItem(OLD_SEEN(userId)) === '1' } catch { oldSeen = true }
    if (!s?.autoShown && !s?.finished && !oldSeen && agents.length === 0) {
      saveSetup(userId, { ...(s ?? { step: 0, form: EMPTY }), autoShown: true })
      setOpen(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, agentsLoaded, welcome.data])
  React.useEffect(() => { if (guide) { setOpen(true); setUI({ guide: false }) } }, [guide, setUI])

  const persist = (p: Partial<Saved>) => { if (userId) saveSetup(userId, { ...(loadSetup(userId) ?? {}), step, form, agentId, ...p }) }
  React.useEffect(() => { if (open && userId && loaded.current) persist({}) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [step, form, agentId, open])
  const set = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }))
  const stopAudio = () => { audio.current?.pause(); audio.current = null; setPlaying(null) }
  const close = () => { stopAudio(); setOpen(false) }

  const picks = React.useMemo(() => {
    const ok = (voices.data ?? []).filter((v) => v.available && v.provider === 'Studio' && /hindi|english \(india\)/i.test(v.language))
    const f = ok.filter((v) => v.gender === 'Female').slice(0, 4), m = ok.filter((v) => v.gender === 'Male').slice(0, 4)
    return [...f, ...m].sort((a, b) => a.name.localeCompare(b.name))
  }, [voices.data])
  const play = (v: Voice) => {
    if (playing === v.id) return stopAudio()
    stopAudio()
    if (!v.has_sample) return
    const a = new Audio(`${API_URL}/voices/${v.id}/sample`)
    audio.current = a; setPlaying(v.id)
    a.onended = () => setPlaying((p) => (p === v.id ? null : p))
    void a.play().catch(() => setPlaying(null))
  }

  const canNext = [true, form.business.trim().length >= 2 && form.what.trim().length >= 10, !!form.template, !!form.voiceId, true][step]
  const create = async () => {
    setBusy(true)
    try {
      let id = agentId
      const body = { business: form.business.trim().slice(0, 160), what_you_do: form.what.trim(), tone: form.tone, script: '' }
      if (!id) {
        const t = templates.data?.find((x) => x.key === form.template)
        const made = await agentsApi.create({ name: `${form.business.trim().slice(0, 50)} ${t?.name ? t.name.toLowerCase() : 'agent'}`.slice(0, 120), template: form.template || undefined, ...body })
        id = made.id; setAgentId(id)
      }
      const cur = toAgent(await agentsApi.get(id))
      const out = await agentsApi.patch(id, { voiceId: form.voiceId }, cur.version)
      upsert(toAgent(out, cur))
      setStep(4)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'We could not create your agent. Please try again.') } finally { setBusy(false) }
  }
  const next = () => { stopAudio(); if (step === 3) void create(); else setStep(step + 1) }
  const finish = (to?: string) => { persist({ finished: true }); close(); if (to) nav(to) }
  const publish = async () => {
    if (!agentId) return
    setBusy(true)
    try { upsert(toAgent(await agentsApi.publish(agentId))); toast.success('Your agent is live'); finish(`/numbers`) } catch (e) { toast.error(e instanceof Error ? e.message : 'We could not put it live yet. Open the agent to see what is missing.') } finally { setBusy(false) }
  }

  const bonus = welcome.data && welcome.data.bonus > 0 ? welcome.data : null
  return (
    <DialogP.Root open={open} onOpenChange={(o) => { if (!o) close() }}>
      <DialogP.Portal>
        <DialogP.Overlay className="fixed inset-0 z-50 bg-[hsl(228_40%_4%/.6)] backdrop-blur-[8px]" />
        <DialogP.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-50 grid h-[min(680px,94dvh)] w-[min(960px,96vw)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-3xl border border-line/80 bg-surface shadow-pop animate-fade-in md:grid-cols-[270px_1fr]">
          {/* left: where you are */}
          <aside className="relative hidden flex-col justify-between overflow-hidden bg-ink p-7 text-surface md:flex">
            <div className="pointer-events-none absolute -left-16 -top-20 h-64 w-64 rounded-full bg-[#22d3ee]/30 blur-3xl" aria-hidden />
            <div className="pointer-events-none absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-[#8b5cf6]/35 blur-3xl" aria-hidden />
            <div className="relative">
              <MeshBadge className="h-10 w-10 rounded-xl"><Sparkles size={18} /></MeshBadge>
              <h2 className="mt-5 text-[22px] font-semibold leading-tight tracking-tight">Your first agent in about 3 minutes</h2>
              <ol className="mt-7 space-y-4">
                {STEPS.map((s, i) => (
                  <li key={s.t} className="flex items-center gap-3">
                    <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition', i < step ? 'bg-white text-ink' : i === step ? 'bg-white/20 ring-1 ring-white/60' : 'bg-white/10 text-white/60')}>{i < step ? <Check size={14} /> : i + 1}</span>
                    <span className={cn('text-sm transition', i === step ? 'font-semibold' : 'text-white/65')}>{s.t}<span className="block text-xs font-normal text-white/50">{s.d}</span></span>
                  </li>))}
              </ol>
            </div>
            <p className="relative text-xs text-white/55">You can leave at any time. We save where you stopped.</p>
          </aside>

          {/* right: the step */}
          <section className="flex min-h-0 flex-col">
            <div className="flex items-center justify-between gap-3 px-6 pb-2 pt-5 md:px-8">
              <div className="flex-1">
                <div className="text-xs font-medium text-soft md:hidden">Step {short(step, STEPS.length)}</div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-ink transition-all duration-500" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>
              </div>
              <DialogP.Close className="rounded-lg p-1.5 text-soft transition hover:bg-muted hover:text-ink" aria-label="Close"><X size={18} /></DialogP.Close>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4 pt-3 md:px-8">
              {step === 0 && (
                <div>
                  <DialogP.Title className="text-[26px] font-semibold tracking-[-0.02em]">{bonus ? `Welcome! ${money(bonus.bonus)} is on us` : 'Welcome to Swarvo AI'}</DialogP.Title>
                  <p className="mt-2 max-w-lg text-[15px] text-soft">{bonus ? `We added ${money(bonus.bonus)} to your wallet, about ${Math.floor(bonus.minutes_available).toLocaleString('en-IN')} minutes of calls. No card needed. ` : ''}Let's build an agent that answers your calls. Answer a few quick questions and you can talk to it right away.</p>
                  <div className="mt-6 grid gap-3 sm:grid-cols-3">
                    {[{ i: <Sparkles size={18} />, t: 'Tell us about you', d: 'Your business and what callers ask.' }, { i: <Mic size={18} />, t: 'Pick a voice', d: 'Hear it before you choose.' }, { i: <Rocket size={18} />, t: 'Talk to it', d: 'Then go live when you are ready.' }].map((c) => (
                      <div key={c.t} className="rounded-2xl border bg-surface p-4"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">{c.i}</span><div className="mt-3 text-sm font-semibold">{c.t}</div><div className="mt-0.5 text-xs text-soft">{c.d}</div></div>))}
                  </div>
                  {bonus && <div className="mt-5 flex items-center gap-2 rounded-xl bg-muted px-3.5 py-2.5 text-sm text-soft"><Wallet size={16} />Practice calls and testing in the browser never reach real callers.</div>}
                </div>)}

              {step === 1 && (
                <div>
                  <DialogP.Title className="text-[24px] font-semibold tracking-[-0.02em]">Tell us about your business</DialogP.Title>
                  <p className="mt-1.5 text-sm text-soft">Your agent uses this to greet callers and answer questions.</p>
                  <Field label="Business name" className="mt-5"><Input autoFocus placeholder="e.g. Sunrise Dental" value={form.business} maxLength={80} onChange={(e) => set({ business: e.target.value })} /></Field>
                  <div className="mt-4"><div className="mb-2 text-[13px] font-medium">What kind of business?</div>
                    <div className="flex flex-wrap gap-2">{INDUSTRIES.map((i) => <Chip key={i.k} active={form.industry === i.k} onClick={() => set({ industry: i.k, what: i.what && (!form.what.trim() || INDUSTRIES.some((x) => x.what === form.what)) ? i.what : form.what })}>{i.k}</Chip>)}</div></div>
                  <Field label="What do you do, and what do callers ask?" className="mt-4" hint={<span className="text-xs text-soft">A couple of sentences is enough.</span>}><Textarea className="min-h-[110px]" placeholder="We run a dental clinic in Pune. Callers book appointments and ask about prices and timings." value={form.what} maxLength={1500} onChange={(e) => set({ what: e.target.value })} /></Field>
                </div>)}

              {step === 2 && (
                <div>
                  <DialogP.Title className="text-[24px] font-semibold tracking-[-0.02em]">What should your agent handle?</DialogP.Title>
                  <p className="mt-1.5 text-sm text-soft">Pick the closest one. You can change everything later.</p>
                  {templates.isPending ? <div className="mt-6 flex items-center gap-2 text-sm text-soft"><Loader2 size={16} className="animate-spin" />Loading…</div> : (
                    <div className="mt-5 grid gap-3 sm:grid-cols-2">{(templates.data ?? []).map((t) => (
                      <button key={t.key} onClick={() => set({ template: t.key, tone: form.tone || t.tone })} aria-pressed={form.template === t.key}
                        className={cn('flex items-start gap-3 rounded-2xl border bg-surface p-4 text-left transition', form.template === t.key ? 'border-ink ring-1 ring-ink' : 'hover:border-soft/50')}>
                        <AgentAvatar id={t.key} className="h-10 w-10 shrink-0"><span className="text-base">{t.emoji}</span></AgentAvatar>
                        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{t.name}</span><span className="mt-0.5 block text-xs text-soft">{t.blurb}</span></span>
                        {form.template === t.key && <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-surface"><Check size={13} /></span>}
                      </button>))}</div>)}
                </div>)}

              {step === 3 && (
                <div>
                  <DialogP.Title className="text-[24px] font-semibold tracking-[-0.02em]">Choose a voice and a tone</DialogP.Title>
                  <p className="mt-1.5 text-sm text-soft">Press play to hear each voice.</p>
                  {voices.isPending ? <div className="mt-6 flex items-center gap-2 text-sm text-soft"><Loader2 size={16} className="animate-spin" />Loading voices…</div> : (
                    <div className="mt-5 grid gap-3 sm:grid-cols-2">{picks.map((v) => (
                      <div key={v.id} role="button" tabIndex={0} onClick={() => set({ voiceId: v.id })} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') set({ voiceId: v.id }) }} aria-pressed={form.voiceId === v.id}
                        className={cn('flex cursor-pointer items-center gap-3 rounded-2xl border bg-surface p-3 transition', form.voiceId === v.id ? 'border-ink ring-1 ring-ink' : 'hover:border-soft/50')}>
                        <AgentAvatar id={v.id} className="h-10 w-10 shrink-0" />
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{v.name}</span><span className="block truncate text-xs text-soft">{[v.language, v.gender].filter(Boolean).join(' · ')}</span></span>
                        {v.has_sample && <button type="button" aria-label={`Play ${v.name}`} onClick={(e) => { e.stopPropagation(); play(v) }} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition hover:bg-muted">{playing === v.id ? <Loader2 size={14} className="animate-spin" /> : <Play size={13} />}</button>}
                        {form.voiceId === v.id && <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-surface"><Check size={13} /></span>}
                      </div>))}
                      {picks.length === 0 && <p className="text-sm text-soft sm:col-span-2">No voices are ready yet. Ask support, or skip and pick one later from the Voices page.</p>}</div>)}
                  <div className="mt-5"><div className="mb-2 text-[13px] font-medium">How should it sound?</div><div className="flex flex-wrap gap-2">{TONES.map((t) => <Chip key={t} active={form.tone === t} onClick={() => set({ tone: t })}>{t}</Chip>)}</div></div>
                </div>)}

              {step === 4 && (
                <div>
                  <DialogP.Title className="text-[24px] font-semibold tracking-[-0.02em]">Say hello to your agent</DialogP.Title>
                  <p className="mt-1.5 text-sm text-soft">Press Talk and speak. This is a private practice call. It never reaches real callers.</p>
                  <div className="mt-4">{agentId ? <VoicePlayground agentId={agentId} compact /> : null}</div>
                </div>)}
            </div>

            <div className="flex items-center justify-between gap-2 border-t px-6 py-4 md:px-8">
              <Button variant="ghost" onClick={close}>{step === 4 ? 'Finish later' : 'Not now'}</Button>
              <div className="flex gap-2">
                {step > 0 && step < 4 && <Button onClick={() => setStep(step - 1)} disabled={busy}>Back</Button>}
                {step < 4 && <Button variant="primary" disabled={!canNext || busy} onClick={next}>{busy ? 'Creating…' : step === 0 ? 'Let’s go' : step === 3 ? 'Create my agent' : 'Continue'}</Button>}
                {step === 4 && <>
                  <Button onClick={() => finish(agentId ? `/agents/${agentId}` : '/agents')}>Fine-tune it</Button>
                  <Button variant="primary" disabled={busy} onClick={publish}><Phone size={16} />{busy ? 'Going live…' : 'Go live & get a number'}</Button></>}
              </div>
            </div>
          </section>
        </DialogP.Content>
      </DialogP.Portal>
    </DialogP.Root>
  )
}
