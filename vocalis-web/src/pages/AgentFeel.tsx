import * as React from 'react'
import { Sparkles } from '@/components/icons'
import { toast } from 'sonner'
import { Button, Card, Chip, Field, Input, Slider, Switch, Textarea } from '@/components/ui'
import { AdvancedOnly } from '@/components/shared'
import { agentsApi, toAgent } from '@/lib/api/agents'
import { http } from '@/lib/api/http'
import { useData } from '@/store/data'
import type { Agent } from '@/mock/types'
import type { components } from '@/lib/api/schema'

type Style = { pace?: number; patience?: string; turns?: string; steadiness?: string; steering?: string; backchannel?: boolean; slow_filler?: boolean; fillers?: boolean; interruptions?: boolean; vocabulary?: string; max_minutes?: number; silence_seconds?: number; languages?: string[]; daily_call_cap?: number; monthly_spend_cap?: number }

const Choice = ({ label, hint, value, options, onChange, off }: { label: string; hint: string; value?: string; options: [string, string][]; onChange: (v: string) => void; off?: boolean }) => (
  <div className={off ? 'pointer-events-none opacity-50' : ''}><div className="text-[13px] font-medium">{label}</div><div className="mb-2 text-xs text-soft">{hint}</div>
    <div className="flex flex-wrap gap-2">{options.map(([k, l]) => <Chip key={k} active={value === k} onClick={() => onChange(k)}>{l}</Chip>)}</div></div>
)

/** How the agent sounds and behaves in a conversation: pace, patience, interruptions, fillers, call limits. */
export function HumanFeel({ agent, studio, swarvo = false }: { agent: Agent; studio: boolean; swarvo?: boolean }) {
  const upsert = useData((s) => s.upsertAgent)
  const [s, setS] = React.useState<Style>((agent.style as Style) ?? {})
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => setS((agent.style as Style) ?? {}), [agent.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Style) => setS({ ...s, ...p })
  const save = async () => {
    setBusy(true)
    try {
      const out = await http<components['schemas']['AgentOut']>(`/agents/${agent.id}`, { method: 'PATCH', json: { style: s }, headers: { 'If-Match': String(agent.version ?? 0) } })
      upsert(toAgent(out, agent)); toast.success('Saved. Go live again for real calls to use it.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'We could not save that.') } finally { setBusy(false) }
  }
  void agentsApi
  const pace = s.pace ?? 1.25
  return (
    <Card className="mt-6 p-6">
      <div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent"><Sparkles size={17} /></span>
        <div><h3 className="font-semibold">Make it sound human</h3><p className="text-[13px] text-soft">Small choices that change how natural the conversation feels.</p></div></div>
      {!studio && <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-soft">{swarvo ? 'With this voice, speaking pace, interruptions and call limits apply. Patience, delivery and steering are for Studio voices.' : 'Pace, patience, delivery and steering apply to Studio voices. With this voice, only interruptions and call limits apply.'}</p>}
      <div className={`mt-5 grid gap-6 md:grid-cols-2 ${studio || swarvo ? '' : 'opacity-50'}`}>
        <Field label="Speaking pace" hint={<span className="text-xs text-soft">{pace < 1.05 ? 'Slow and calm' : pace > 1.4 ? 'Quick' : 'Natural'}</span>}>
          <Slider value={Math.round((pace - 0.75) * 100)} min={0} max={100} onChange={(v) => set({ pace: Math.round((0.75 + v / 100) * 20) / 20 })} label="Speaking pace" /></Field>
        <Choice off={swarvo} label="How long it waits for you to finish" hint="Quick can cut people off. Patient suits people who pause to think." value={s.patience} onChange={(v) => set({ patience: v })} options={[['quick', 'Quick'], ['balanced', 'Balanced'], ['patient', 'Patient']]} />
        <Choice off={swarvo} label="Delivery" hint="Steady is consistent. Balanced is in between. Expressive sounds livelier." value={s.steadiness} onChange={(v) => set({ steadiness: v })} options={[['steady', 'Steady'], ['balanced', 'Balanced'], ['expressive', 'Expressive']]} />
        <Choice off={swarvo} label="Steering" hint="The voice changes its tone to fit the moment, like sounding gentle when a caller is upset. Low: only clear emotional moments. Medium: most replies. High: rich and frequent." value={s.steering ?? 'off'} onChange={(v) => set({ steering: v })} options={[['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]} />
        <Choice off={swarvo} label="Knowing when you've finished" hint="Smart listens to the meaning. Fast reacts to silence." value={s.turns} onChange={(v) => set({ turns: v })} options={[['smart', 'Smart'], ['fast', 'Fast']]} />
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="flex items-center justify-between rounded-lg border p-3"><div><div className="text-sm font-medium">Natural fillers</div><div className="text-xs text-soft">Short "mm-hm" and "okay" while thinking (Studio voices)</div></div><Switch checked={!!s.fillers} onChange={(v) => set({ fillers: v })} label="Natural fillers" /></div>
        <div className={`flex items-center justify-between rounded-lg border p-3 ${studio ? '' : 'pointer-events-none opacity-50'}`}><div><div className="text-sm font-medium">Short acknowledgements</div><div className="text-xs text-soft">A quiet "mm-hm" while the caller is still talking (Studio voices)</div></div><Switch label="Short acknowledgements" checked={!!s.backchannel} onChange={(v) => set({ backchannel: v })} /></div>
        <div className={`flex items-center justify-between rounded-lg border p-3 ${studio ? '' : 'pointer-events-none opacity-50'}`}><div><div className="text-sm font-medium">Filler when slow</div><div className="text-xs text-soft">Says a short phrase if the answer takes a moment (Studio voices)</div></div><Switch label="Filler when slow" checked={!!s.slow_filler} onChange={(v) => set({ slow_filler: v })} /></div>
        <div className="flex items-center justify-between rounded-lg border p-3"><div><div className="text-sm font-medium">Callers can interrupt</div><div className="text-xs text-soft">It stops talking when the caller speaks</div></div><Switch checked={s.interruptions ?? true} onChange={(v) => set({ interruptions: v })} label="Callers can interrupt" /></div>
      </div>
      <div className="mt-6"><div className="text-[13px] font-medium">Languages it can switch between</div><div className="mb-2 text-xs text-soft">It answers in the language the caller uses and can mix them, like Hinglish.</div>
        <div className="flex flex-wrap gap-2">{['English', 'Hindi', 'Hinglish', 'Marathi', 'Gujarati', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Bengali', 'Punjabi'].map((l) => (
          <Chip key={l} active={(s.languages ?? []).includes(l)} onClick={() => set({ languages: (s.languages ?? []).includes(l) ? (s.languages ?? []).filter((x) => x !== l) : [...(s.languages ?? []), l].slice(0, 6) })}>{l}</Chip>))}</div></div>
      <Field label="Words it should get right" className="mt-5" hint={<span className="text-xs text-soft">Names, places, products. Comma separated.</span>}><Textarea className="min-h-[60px]" value={s.vocabulary ?? ''} onChange={(e) => set({ vocabulary: e.target.value })} placeholder="Dr. Rao, Koregaon Park, Invisalign" /></Field>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Most calls per day" hint={<span className="text-xs text-soft">0 = no limit. Callers hear a polite message after this.</span>}><Input type="number" min={0} value={s.daily_call_cap ?? 0} onChange={(e) => set({ daily_call_cap: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></Field>
        <Field label="Most spend per month" hint={<span className="text-xs text-soft">0 = no limit. Counts this agent's calls only.</span>}><Input type="number" min={0} value={s.monthly_spend_cap ?? 0} onChange={(e) => set({ monthly_spend_cap: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></Field></div>
      <AdvancedOnly><div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Longest call (minutes)"><Input type="number" min={1} max={60} value={s.max_minutes ?? 15} onChange={(e) => set({ max_minutes: Number(e.target.value) })} /></Field>
        <Field label="Hang up after silence (seconds)"><Input type="number" min={5} max={60} value={s.silence_seconds ?? 10} onChange={(e) => set({ silence_seconds: Number(e.target.value) })} /></Field></div></AdvancedOnly>
      <Button variant="primary" className="mt-5" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
    </Card>
  )
}
