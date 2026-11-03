import * as React from 'react'
import { Glyph } from '@/components/Glyph'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Check, Mic, Rocket } from '@/components/icons'
import { toast } from 'sonner'
import { Button, Card, Field, Input, Textarea } from '@/components/ui'
import { VoicePick } from '@/pages/AgentDetail'
import { agentsApi, toAgent } from '@/lib/api/agents'
import { http } from '@/lib/api/http'
import { api } from '@/lib/api'
import { useData } from '@/store/data'
import { useUI } from '@/store/ui'
import { BRAND } from '@/config/brand'
import { cn } from '@/lib/utils'
import type { components } from '@/lib/api/schema'

const STEPS = ['Your business', 'Pick a style', 'Pick a voice', 'Try it', 'Go live']

export default function Onboarding() {
  const nav = useNavigate()
  const upsert = useData((s) => s.upsertAgent)
  const setUI = useUI((s) => s.set)
  const [step, setStep] = React.useState(0)
  const [biz, setBiz] = React.useState({ business: '', what: '' })
  const [tpl, setTpl] = React.useState<string>('receptionist')
  const [voiceId, setVoiceId] = React.useState('')
  const [agentId, setAgentId] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => http<components['schemas']['TemplateOut'][]>('/agents/templates') })
  const voices = useQuery({ queryKey: ['voices-onboarding'], queryFn: () => api.voices() })
  const say = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.')

  const create = async () => {
    setBusy(true)
    try {
      const t = templates.data?.find((x) => x.key === tpl)
      const a = await agentsApi.create({ name: t?.name ?? 'My agent', template: tpl, business: biz.business, what_you_do: biz.what, script: '' })
      const patched = voiceId ? await agentsApi.patch(a.id, { voiceId }, a.version) : a
      upsert(toAgent(patched)); setAgentId(a.id); setStep(3)
    } catch (e) { say(e) } finally { setBusy(false) }
  }
  const publish = async () => {
    if (!agentId) return
    setBusy(true)
    try { upsert(toAgent(await agentsApi.publish(agentId))); toast.success('Your agent is live!'); nav(`/agents/${agentId}`) } catch (e) { say(e) } finally { setBusy(false) }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Let's set up your first agent</h1>
        <p className="mt-2 text-soft">Five quick steps. Takes about three minutes.</p>
      </div>
      <ol className="mb-8 flex items-center justify-center gap-2 text-xs">{STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-2"><span className={cn('flex h-7 w-7 items-center justify-center rounded-full border font-semibold', i < step ? 'border-accent bg-accent text-accent-fg' : i === step ? 'border-accent text-accent' : 'text-soft')}>{i < step ? <Check size={14} /> : i + 1}</span>
          <span className={cn('hidden sm:inline', i === step ? 'font-medium text-ink' : 'text-soft')}>{s}</span>{i < STEPS.length - 1 && <span className="h-px w-5 bg-line" />}</li>))}</ol>

      <Card className="p-6 md:p-8">
        {step === 0 && (<div className="space-y-4">
          <Field label="What's your business called?"><Input value={biz.business} onChange={(e) => setBiz({ ...biz, business: e.target.value })} placeholder="e.g. Sunrise Dental" autoFocus /></Field>
          <Field label="What do you do, and how should the agent help callers?"><Textarea value={biz.what} onChange={(e) => setBiz({ ...biz, what: e.target.value })} placeholder="We are a dental clinic in Pune. The agent should answer questions and book appointments." /></Field>
        </div>)}
        {step === 1 && (<div className="grid gap-3 sm:grid-cols-2">{(templates.data ?? []).map((t) => (
          <button key={t.key} onClick={() => setTpl(t.key)} className={cn('rounded-xl border p-4 text-left transition hover:border-accent', tpl === t.key && 'border-accent bg-accent-soft')}>
            <div className="text-accent"><Glyph e={t.emoji} size={26} /></div><div className="mt-2 font-medium">{t.name}</div><div className="text-sm text-soft">{t.blurb}</div></button>))}</div>)}
        {step === 2 && <VoicePick voices={voices.data ?? []} value={voiceId} onPick={setVoiceId} />}
        {step === 3 && (<div className="py-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-accent"><Mic size={28} /></div>
          <h2 className="mt-4 text-xl font-semibold">Say hello to your agent</h2><p className="mt-1 text-soft">A free practice call from your browser. Nobody real is called.</p>
          <Button variant="primary" size="lg" className="mt-5" onClick={() => agentId && setUI({ playground: agentId })}><Mic size={18} />Start talking</Button></div>)}
        {step === 4 && (<div className="py-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-accent"><Rocket size={28} /></div>
          <h2 className="mt-4 text-xl font-semibold">Ready to take real calls?</h2><p className="mt-1 text-soft">Go live now. You can change anything later from the agent's page, and connect a phone number from Phone Numbers.</p>
          <Button variant="primary" size="lg" className="mt-5" disabled={busy} onClick={publish}><Rocket size={18} />Go live</Button></div>)}

        <div className="mt-8 flex items-center justify-between border-t pt-5">
          <Button variant="ghost" disabled={step === 0 || step === 3 || busy} onClick={() => setStep(step - 1)}><ArrowLeft size={16} />Back</Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => { sessionStorage.setItem('skip-welcome', '1'); nav('/') }}>Skip for now</Button>
            {step < 2 && <Button variant="primary" disabled={step === 0 && !biz.business.trim()} onClick={() => setStep(step + 1)}>Next<ArrowRight size={16} /></Button>}
            {step === 2 && <Button variant="primary" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create my agent'}<ArrowRight size={16} /></Button>}
            {step === 3 && <Button variant="primary" onClick={() => setStep(4)}>Next<ArrowRight size={16} /></Button>}
          </div>
        </div>
      </Card>
      <p className="mt-4 text-center text-xs text-soft">Welcome to {BRAND}.</p>
    </div>
  )
}
