import * as React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft, ArrowRight, BookOpen, Bot, Building2, Check, Gauge, Heart, Home, Mic, Pencil, Scale, ShoppingBag, Sparkles, Wallet, Wand2, Wrench, type LucideIcon,
} from '@/components/icons'
import { AgentAvatar } from '@/components/AgentAvatar'
import { Glyph } from '@/components/Glyph'
import { Badge, Button, Card, Chip, Dialog, Field, Input, Select, Textarea } from '@/components/ui'
import { PageHeader } from '@/components/shared'
import { useData } from '@/store/data'
import { useUI } from '@/store/ui'
import { USE_MOCKS } from '@/lib/api/env'
import { agentsApi, toAgent } from '@/lib/api/agents'
import { http } from '@/lib/api/http'
import { cn } from '@/lib/utils'
import type { components } from '@/lib/api/schema'
import type { Agent } from '@/mock/types'

type Tpl = components['schemas']['TemplateOut']

const INDUSTRY_ICON: Record<string, LucideIcon> = {
  General: Bot, Healthcare: Heart, 'Salon & Wellness': Sparkles, 'Real Estate': Home, 'Restaurants & Food': ShoppingBag, 'Hotels & Travel': Building2,
  Education: BookOpen, 'Retail & E-commerce': ShoppingBag, 'Finance & Collections': Wallet, 'Home Services': Wrench, Automotive: Gauge, 'Legal & Professional': Scale,
}
const iconFor = (industry?: string) => INDUSTRY_ICON[industry ?? 'General'] ?? Bot

/** Used when the app runs on sample data only. */
const SAMPLE: Tpl[] = [
  { key: 'receptionist', name: 'Front Desk', emoji: '📞', color: '#6356f1', role: 'answer calls and take messages', tone: 'Friendly', blurb: 'Greets callers and answers questions.', industry: 'General', business: 'Your business', what_you_do: 'We are a small business.', script: '1. Greet the caller.\n2. Find out what they need.\n3. Take a message if you cannot help.' },
]

function useTemplates() {
  return useQuery({ queryKey: ['templates-full'], queryFn: () => (USE_MOCKS ? Promise.resolve(SAMPLE) : agentsApi.templates()), staleTime: Infinity })
}

/* ------------------------------------------------------------------ templates gallery */
export function TemplatesPage() {
  const nav = useNavigate()
  const { data: all = [], isLoading } = useTemplates()
  const [q, setQ] = React.useState('')
  const [industry, setIndustry] = React.useState('All')
  const [open, setOpen] = React.useState<Tpl | null>(null)
  const industries = React.useMemo(() => ['All', ...Array.from(new Set(all.map((t) => t.industry ?? 'General')))], [all])
  const shown = all.filter((t) => (industry === 'All' || (t.industry ?? 'General') === industry) && `${t.name} ${t.blurb} ${t.role} ${t.industry}`.toLowerCase().includes(q.toLowerCase()))
  const groups = industries.filter((i) => i !== 'All').map((i) => ({ i, items: shown.filter((t) => (t.industry ?? 'General') === i) })).filter((g) => g.items.length)
  const use = (t: Tpl) => nav('/agents/new?template=' + t.key)

  return (
    <>
      <PageHeader title="Template gallery" subtitle="Pick your industry and start from an agent that already knows how the call should go. Change anything later." />
      <div className="mb-3 flex h-10 w-full max-w-sm items-center gap-2 rounded-full border bg-surface px-3.5 text-sm text-soft transition focus-within:border-soft/50">
        <input className="w-full bg-transparent text-ink outline-none placeholder:text-soft/70" placeholder="Search templates" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search templates" />
      </div>
      <div className="mb-8 flex flex-wrap gap-2">
        {industries.map((i) => <Chip key={i} active={industry === i} onClick={() => setIndustry(i)}>{i}</Chip>)}
      </div>
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-44 rounded-2xl" />)}</div>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center text-soft">No templates match. Try another word, or <button className="text-accent hover:underline" onClick={() => nav('/agents/new')}>describe your own agent</button>.</div>
      ) : (
        <div className="space-y-10">
          {groups.map(({ i, items }) => {
            const I = iconFor(i)
            return (
              <section key={i}>
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><I size={16} className="text-accent" />{i}<span className="font-normal text-soft">{items.length}</span></div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((t) => (
                    <Card key={t.key} className="group flex flex-col rounded-2xl p-5 shadow-none transition hover:border-accent/40 hover:bg-muted/30">
                      <div className="flex items-start gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: t.color + '1f', color: t.color }}><I size={20} /></span>
                        <div className="min-w-0"><h3 className="font-semibold leading-tight">{t.name}</h3><p className="mt-0.5 text-[13px] text-soft">{t.blurb}</p></div>
                      </div>
                      <p className="mt-4 flex-1 text-[13px] leading-relaxed text-soft"><span className="text-ink">Does:</span> {t.role}.</p>
                      <div className="mt-3 flex items-center gap-2"><Badge tone="accent">{t.tone}</Badge><span className="text-xs text-soft">{(t.script ?? '').split('\n').filter(Boolean).length} step call flow</span></div>
                      <div className="mt-4 flex items-center gap-2 border-t pt-3">
                        <Button size="sm" variant="ghost" onClick={() => setOpen(t)}>Preview</Button>
                        <Button size="sm" variant="primary" className="ml-auto" onClick={() => use(t)}>Use template<ArrowRight size={14} /></Button>
                      </div>
                    </Card>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={open?.name ?? ''} description={open ? `${open.industry} · ${open.tone} tone` : ''} wide>
        {open && (
          <div className="space-y-4">
            <div><div className="mb-1 text-xs font-medium uppercase tracking-wide text-soft">What it does</div><p className="text-sm">{open.role}</p></div>
            <div><div className="mb-1 text-xs font-medium uppercase tracking-wide text-soft">Example business</div><p className="text-sm">{open.business}. {open.what_you_do}</p></div>
            <div><div className="mb-1 text-xs font-medium uppercase tracking-wide text-soft">How the call goes</div><pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-muted/60 p-4 font-sans text-[13px] leading-relaxed">{open.script}</pre></div>
            <div className="flex justify-end"><Button variant="primary" onClick={() => use(open)}>Use this template<ArrowRight size={14} /></Button></div>
          </div>
        )}
      </Dialog>
    </>
  )
}

/* ------------------------------------------------------------------ new agent */
type Stage = 'pick' | 'describe' | 'review' | 'done'
const USECASES: { key: string; t: string; d: string }[] = [
  { key: 'receptionist', t: 'Answer calls', d: 'Greet callers, answer questions, take messages' },
  { key: 'appointments', t: 'Book appointments', d: 'Fill your calendar without picking up the phone' },
  { key: 'leads', t: 'Qualify leads', d: 'Find out who is ready to buy' },
  { key: 'support', t: 'Customer support', d: 'Solve common problems, any hour' },
  { key: 'orders', t: 'Take orders', d: 'Collect food or retail orders and confirm the total' },
  { key: 'restaurant', t: 'Table reservations', d: 'Bookings, menu and opening hours' },
  { key: 'orderstatus', t: 'Order status and returns', d: 'Where is my order, and how do I return it' },
  { key: 'homeservices', t: 'Book service visits', d: 'Repairs, installs and technician visits' },
  { key: 'reminders', t: 'Payment reminders', d: 'Politely chase pending payments' },
  { key: 'loans', t: 'Loan and insurance enquiries', d: 'Collect details for an advisor' },
  { key: 'realestate', t: 'Property enquiries', d: 'Qualify buyers and book site visits' },
  { key: 'clinic', t: 'Patient calls', d: 'Appointments and clinic information' },
  { key: 'coaching', t: 'Admissions and courses', d: 'Fees, batches and counselling calls' },
  { key: 'hotel', t: 'Hotel and travel bookings', d: 'Rooms, rates and trip enquiries' },
  { key: 'carservice', t: 'Vehicle service and sales', d: 'Service slots and test drives' },
  { key: 'survey', t: 'Run surveys', d: 'Short feedback calls, one question at a time' },
  { key: 'legal', t: 'Professional intake', d: 'First enquiries for law and accounting firms' },
  { key: 'custom', t: 'Something else', d: 'Describe it in your own words' },
]
const LANGS = ['English', 'Hindi', 'Marathi', 'Gujarati', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Bengali', 'Punjabi']
const TONES = ['Friendly', 'Professional', 'Playful']

type Draft = { name: string; emoji: string; role: string; tone: string; business: string; what_you_do: string; script: string; generated: boolean }

export function NewAgentPage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const { addAgent, upsertAgent } = useData()
  const set = useUI((s) => s.set)
  const { data: tpls = [] } = useTemplates()
  const [stage, setStage] = React.useState<Stage>('pick')
  const [usecase, setUsecase] = React.useState('')
  const [desc, setDesc] = React.useState('')
  const [biz, setBiz] = React.useState('')
  const [lang, setLang] = React.useState('English')
  const [busy, setBusy] = React.useState(false)
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [agent, setAgent] = React.useState<Agent | null>(null)
  const tpl = tpls.find((t) => t.key === usecase)

  // Arriving from the template gallery: go straight to the details with that template chosen.
  React.useEffect(() => {
    const k = params.get('template')
    if (k && tpls.some((t) => t.key === k)) { setUsecase(k); setStage((s) => (s === 'pick' ? 'describe' : s)) }
  }, [params, tpls])

  const stepNo = { pick: 1, describe: 2, review: 3, done: 4 }[stage]

  const choose = (k: string) => { setUsecase(k); setStage('describe') }
  const example = () => { if (tpl) { setDesc(`${tpl.business}. ${tpl.what_you_do}`); if (!biz && tpl.business && tpl.business !== 'Your business') setBiz(tpl.business) } }

  const generate = async () => {
    setBusy(true)
    const notes = [biz.trim() && `Business name: ${biz.trim()}`, desc.trim()].filter(Boolean).join('\n')
    try {
      if (USE_MOCKS) {
        await new Promise((r) => setTimeout(r, 1200))
        setDraft({ name: 'Asha', emoji: tpl?.emoji ?? '🤖', role: tpl?.role ?? 'help callers', tone: 'Friendly', business: biz || 'My business', what_you_do: desc, script: tpl?.script ?? '', generated: false })
      } else {
        const d = await agentsApi.generate({ usecase: usecase || 'custom', description: notes, industry: tpl?.industry && tpl.industry !== 'General' ? tpl.industry : '', language: lang })
        setDraft({ ...d, business: biz.trim() || d.business })
      }
      setStage('review')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'We could not write your agent just now. Please try again.') }
    setBusy(false)
  }

  const create = async () => {
    if (!draft) return
    setBusy(true)
    try {
      if (USE_MOCKS) {
        const a: Agent = {
          id: 'a' + Date.now(), name: draft.name, emoji: draft.emoji, color: '#6356f1', role: draft.role, status: 'draft', callsToday: 0, successRate: 0, spark: [0, 0, 0, 0, 0, 0, 0, 0],
          voiceId: 'v3', brain: 'balanced', tone: draft.tone as Agent['tone'], business: draft.business, whatYouDo: draft.what_you_do, prompt: draft.script, numbers: [],
        }
        addAgent(a); setAgent(a); setStage('done'); setBusy(false); return
      }
      const created = await agentsApi.create({
        name: draft.name.trim() || 'My agent', template: tpl ? tpl.key : null, role: draft.role, business: draft.business, what_you_do: draft.what_you_do, script: draft.script, tone: draft.tone, emoji: draft.emoji,
      })
      // The chosen language also tells the agent to write it in its own script. A failure here is not worth stopping for.
      try { await http(`/agents/${created.id}`, { method: 'PATCH', json: { style: { languages: [lang] } } }) } catch { /* the agent works without it */ }
      const a = toAgent(await agentsApi.get(created.id))
      upsertAgent(a); setAgent(a); setStage('done')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'We could not create your agent. Please try again.') }
    setBusy(false)
  }

  const up = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d))
  const steps = ['Goal', 'Details', 'Review']

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Create a new agent" subtitle="Tell us what it should do. We write the first version, you check it, and it is ready to try." />
      {stage !== 'done' && (
        <ol className="mb-8 flex items-center gap-2 text-sm" aria-label={`Step ${stepNo} of 3`}>
          {steps.map((s, i) => (
            <React.Fragment key={s}>
              <li className={cn('flex items-center gap-2', stepNo >= i + 1 ? 'text-ink' : 'text-soft')}>
                <span className={cn('flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold', stepNo > i + 1 ? 'bg-accent text-accent-fg' : stepNo === i + 1 ? 'bg-ink text-bg' : 'bg-muted text-soft')}>{stepNo > i + 1 ? <Check size={13} /> : i + 1}</span>
                <span className="font-medium">{s}</span>
              </li>
              {i < steps.length - 1 && <span className={cn('h-px w-8 sm:w-14', stepNo > i + 1 ? 'bg-accent' : 'bg-line')} />}
            </React.Fragment>
          ))}
        </ol>
      )}
      <AnimatePresence mode="wait">
        <motion.div key={stage} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
          {stage === 'pick' && (
            <>
              <h2 className="mb-4 text-lg font-semibold">What should your agent do?</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {USECASES.map((u) => {
                  const t = tpls.find((x) => x.key === u.key)
                  const I = u.key === 'custom' ? Pencil : iconFor(t?.industry)
                  return (
                    <button key={u.key} onClick={() => choose(u.key)} className="group flex items-start gap-3 rounded-2xl border bg-surface p-4 text-left transition hover:border-accent/50 hover:bg-muted/30">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><I size={19} /></span>
                      <span className="min-w-0"><span className="block font-semibold leading-tight">{u.t}</span><span className="mt-0.5 block text-[13px] text-soft">{u.d}</span></span>
                    </button>
                  )
                })}
              </div>
              <button className="mt-6 text-sm text-accent hover:underline" onClick={() => nav('/agents/templates')}>Or browse templates by industry →</button>
            </>
          )}

          {stage === 'describe' && (
            <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
              <Card className="rounded-2xl p-6 shadow-none">
                <h2 className="text-lg font-semibold">Tell us about your business</h2>
                <p className="mt-1 text-soft">Write it like you would explain it to a new employee. Hours, services, prices, anything callers ask.</p>
                <div className="mt-5 space-y-4">
                  <Field label="Business name" hint="Optional"><Input value={biz} onChange={(e) => setBiz(e.target.value)} placeholder="Sunrise Dental Clinic" /></Field>
                  <Field label="What should the agent know and do?">
                    <Textarea className="min-h-[150px]" value={desc} onChange={(e) => setDesc(e.target.value)} aria-label="Describe your business"
                      placeholder="Example: We run a dental clinic in Pune. Open Monday to Saturday, 10 AM to 6 PM. Answer questions about services and book check-ups." />
                    {tpl && <button className="mt-1.5 text-[13px] text-accent hover:underline" onClick={example}>Use an example for this</button>}
                  </Field>
                  <Field label="Main language of your callers"><Select value={lang} onChange={(e) => setLang(e.target.value)}>{LANGS.map((l) => <option key={l}>{l}</option>)}</Select></Field>
                </div>
                <div className="mt-6 flex items-center justify-between">
                  <Button onClick={() => setStage('pick')} disabled={busy}><ArrowLeft size={15} />Back</Button>
                  <Button variant="primary" size="lg" onClick={generate} disabled={busy || (desc.trim().length < 10 && !tpl)}>
                    {busy ? <><Wand2 size={18} className="animate-spin" />Writing your agent…</> : <><Sparkles size={18} />Write my agent</>}
                  </Button>
                </div>
                {busy && <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-muted"><motion.div className="h-full bg-accent" initial={{ width: '5%' }} animate={{ width: '92%' }} transition={{ duration: 12, ease: 'easeOut' }} /></div>}
              </Card>
              <aside className="h-fit rounded-2xl border bg-muted/30 p-5 lg:sticky lg:top-6">
                <div className="flex items-center gap-2 text-sm font-semibold">{(() => { const I = usecase === 'custom' ? Pencil : iconFor(tpl?.industry); return <I size={16} className="text-accent" /> })()}{USECASES.find((u) => u.key === usecase)?.t ?? tpl?.name ?? 'Your agent'}</div>
                <p className="mt-2 text-[13px] leading-relaxed text-soft">{tpl ? `${tpl.blurb} We start from a proven call flow for this and shape it to your business.` : 'We write the call flow from what you tell us.'}</p>
                <div className="mt-4 text-xs font-medium uppercase tracking-wide text-soft">You will get</div>
                <ul className="mt-2 space-y-1.5 text-[13px]">
                  {['A name and personality', 'A step-by-step call script', 'Safe rules: it never guesses prices', 'Everything editable before you create it'].map((x) => <li key={x} className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-accent" />{x}</li>)}
                </ul>
              </aside>
            </div>
          )}

          {stage === 'review' && draft && (
            <Card className="rounded-2xl p-6 shadow-none">
              <div className="flex flex-wrap items-center gap-3">
                <AgentAvatar id={draft.name} className="h-12 w-12"><Glyph e={draft.emoji} size={22} /></AgentAvatar>
                <div className="min-w-0 flex-1"><h2 className="text-lg font-semibold">Here is your agent. Check it over.</h2><p className="text-[13px] text-soft">Change anything. You can edit all of this again after it is created.</p></div>
                <Badge tone={draft.generated ? 'accent' : 'gray'}>{draft.generated ? 'Written by AI' : 'Built from a template'}</Badge>
              </div>
              {!draft.generated && !USE_MOCKS && <p className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-[13px] text-soft">The AI writer could not be reached, so we used the closest template and your own words. You can still edit everything below.</p>}
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="Agent name"><Input value={draft.name} onChange={(e) => up({ name: e.target.value })} /></Field>
                <Field label="Business name"><Input value={draft.business} onChange={(e) => up({ business: e.target.value })} /></Field>
                <Field label="Its job" className="sm:col-span-2"><Input value={draft.role} onChange={(e) => up({ role: e.target.value })} /></Field>
                <Field label="Tone" className="sm:col-span-2"><div className="flex gap-2">{TONES.map((t) => <Chip key={t} active={draft.tone === t} onClick={() => up({ tone: t })}>{t}</Chip>)}</div></Field>
                <Field label="About the business" className="sm:col-span-2"><Textarea className="min-h-[100px]" value={draft.what_you_do} onChange={(e) => up({ what_you_do: e.target.value })} /></Field>
                <Field label="Call script" hint="The order the call follows" className="sm:col-span-2"><Textarea className="min-h-[220px] font-mono text-[13px] leading-relaxed" value={draft.script} onChange={(e) => up({ script: e.target.value })} /></Field>
              </div>
              <div className="mt-6 flex items-center justify-between">
                <Button onClick={() => setStage('describe')} disabled={busy}><ArrowLeft size={15} />Back</Button>
                <div className="flex gap-2">
                  <Button onClick={generate} disabled={busy}><Wand2 size={15} />Rewrite</Button>
                  <Button variant="primary" size="lg" onClick={create} disabled={busy || !draft.name.trim()}>{busy ? 'Creating…' : <>Create agent<ArrowRight size={16} /></>}</Button>
                </div>
              </div>
            </Card>
          )}

          {stage === 'done' && agent && (
            <Card className="mx-auto max-w-xl rounded-2xl p-8 text-center shadow-none">
              <motion.div initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: 'spring' }} className="mx-auto w-fit"><AgentAvatar id={agent.id} className="h-20 w-20"><Glyph e={agent.emoji} size={34} /></AgentAvatar></motion.div>
              <h2 className="mt-4 text-xl font-semibold">Meet {agent.name}!</h2>
              <p className="mx-auto mt-1 max-w-md text-soft">{agent.role}. Saved as a draft, ready to try.</p>
              <div className="mt-3 flex justify-center gap-2"><Badge tone="accent">{agent.tone} tone</Badge><Badge>Draft</Badge></div>
              <Button variant="primary" size="lg" className="mt-6 h-14 px-8 text-base" onClick={() => set({ playground: agent.id })}><Mic size={20} />Talk to it now</Button>
              <div className="mt-4 flex flex-col items-center gap-1">
                <Button variant="ghost" onClick={() => nav('/agents/' + agent.id + '?tab=publish')}>Continue to the Go Live checklist →</Button>
                <Button variant="ghost" onClick={() => nav('/agents/' + agent.id)}>Fine-tune voice and settings</Button>
              </div>
            </Card>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
