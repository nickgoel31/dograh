import * as React from 'react'
import { KycDialog, useKyc } from '@/components/KycDialog'
import { BringNumber } from '@/components/BringNumber'
import { Plus, Settings2, ShieldCheck, ShieldQuestion } from 'lucide-react'
import { toast } from 'sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Card, Dialog, Field, Input, Select, Switch, Textarea } from '@/components/ui'
import { EmptyState, PageHeader, StatusBadge, TableSkeleton } from '@/components/shared'
import { http } from '@/lib/api/http'
import type { components } from '@/lib/api/schema'
import { useData } from '@/store/data'
import { useUI } from '@/store/ui'
import { money } from '@/lib/utils'

type N = components['schemas']['NumberOut']
type Offer = components['schemas']['OfferOut']
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const say = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.')

type Hours = { enabled: boolean; tz: string; start: string; end: string; days: boolean[]; closed: string }
const toHours = (h: N['hours']): Hours => {
  const w = (h as { windows?: { days: number[]; start: string; end: string }[] } | null)?.windows?.[0]
  return {
    enabled: !!(h as { enabled?: boolean } | null)?.enabled, tz: (h as { tz?: string } | null)?.tz ?? 'Asia/Kolkata',
    start: w?.start ?? '09:00', end: w?.end ?? '18:00', days: DAYS.map((_, i) => (w ? w.days.includes(i) : i < 5)),
    closed: (h as { closed_message?: string } | null)?.closed_message ?? '',
  }
}

export default function RealNumbers() {
  const mode = useUI((s) => s.mode)
  const qc = useQueryClient()
  const agents = useData((s) => s.agents)
  const { data, isPending } = useQuery({ queryKey: ['numbers', mode], queryFn: () => http<N[]>('/numbers') })
  const [buy, setBuy] = React.useState(false)
  const [bring, setBring] = React.useState(false)
  const [kycOpen, setKycOpen] = React.useState(false)
  const [sel, setSel] = React.useState<N | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['numbers'] })
  const list = data ?? []

  return (
    <>
      <PageHeader title="Phone Numbers" subtitle="The numbers people call to reach your agents." actions={<><Button onClick={() => setKycOpen(true)}><ShieldCheck size={15} />Verify identity</Button><Button onClick={() => setBring(true)}>Bring your own</Button><Button variant="primary" onClick={() => setBuy(true)}><Plus size={16} />Get a number</Button></>} />
      <Card className="overflow-hidden">
        {isPending ? <TableSkeleton rows={4} /> : list.length === 0 ? (
          <div className="p-6"><EmptyState emoji="📞" title="No numbers yet" text={mode === 'test' ? 'Practice numbers are free and never ring a real phone.' : 'Get a number so real people can call your agent.'} action={<Button variant="primary" size="lg" onClick={() => setBuy(true)}>Get a number</Button>} /></div>
        ) : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b bg-muted/50 text-left text-xs text-soft"><tr>{['Number', 'Answered by', 'Status', 'Spam check', 'Per month', ''].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody>{list.map((n) => (
              <tr key={n.id} className="border-b last:border-0">
                <td className="px-4 py-3"><div className="num font-medium">{n.number}</div><div className="text-xs text-soft">{n.country} · {n.type}{n.sandbox && ' · practice'}</div></td>
                <td className="px-4 py-3">{n.agent_name ?? <span className="text-soft">Nobody yet</span>}</td>
                <td className="px-4 py-3"><StatusBadge status={n.status as never} /></td>
                <td className="px-4 py-3"><span className="inline-flex items-center gap-1 text-soft" title="We don't check this yet"><ShieldQuestion size={14} />Not monitored yet</span></td>
                <td className="num px-4 py-3">{n.monthly ? money(n.monthly) : '—'}</td>
                <td className="px-4 py-3 text-right"><Button size="sm" onClick={() => setSel(n)}><Settings2 size={14} />Settings</Button></td>
              </tr>))}</tbody></table></div>
        )}
      </Card>
      <BuyDialog open={buy} onClose={() => setBuy(false)} onBought={refresh} onKyc={() => setKycOpen(true)} />
      <KycDialog open={kycOpen} onClose={() => setKycOpen(false)} />
      <BringNumber open={bring} onClose={() => setBring(false)} onDone={refresh} />
      {sel && <SettingsDialog key={sel.id} n={sel} agents={agents} onClose={() => setSel(null)} onSaved={refresh} />}
    </>
  )
}

function BuyDialog({ open, onClose, onBought, onKyc }: { open: boolean; onClose: () => void; onBought: () => void; onKyc: () => void }) {
  const kyc = useKyc(open)
  const needsKyc = (offers0: Offer[] | null) => !!offers0?.some((o) => o.kyc_required)
  const [country, setCountry] = React.useState('IN')
  const [kind, setKind] = React.useState('local')
  const [offers, setOffers] = React.useState<Offer[] | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const search = React.useCallback(() => {
    setOffers(null)
    http<Offer[]>(`/numbers/available?country=${country}&kind=${kind}`).then(setOffers).catch((e) => { say(e); setOffers([]) })
  }, [country, kind])
  React.useEffect(() => { if (open) search() }, [open, search])
  const needsKycNow = needsKyc(offers)
  const buyIt = async (number: string) => {
    setBusy(number)
    try { await http('/numbers', { method: 'POST', json: { number, kind } }); toast.success('Number added!'); onBought(); onClose() } catch (e) { say(e) } finally { setBusy(null) }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} wide title="Get a phone number" description="Pick a new number. Already have one with Twilio or Plivo? Use “Bring your own” instead.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Country"><Select value={country} onChange={(e) => setCountry(e.target.value)}><option value="IN">India</option><option value="US">United States</option><option value="GB">United Kingdom</option></Select></Field>
        <Field label="Type"><Select value={kind} onChange={(e) => setKind(e.target.value)}><option value="local">Local</option><option value="toll_free">Toll-free</option></Select></Field>
      </div>
      {needsKycNow && (
        <div className={`mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${kyc.data?.status === 'approved' ? 'border-ok/25 bg-ok/10 text-ok' : kyc.data?.status === 'rejected' ? 'border-bad/25 bg-bad/10 text-bad' : 'border-warn/25 bg-warn/10 text-warn'}`}>
          <span className="flex items-center gap-2"><ShieldCheck size={16} />{kyc.data?.status === 'approved' ? 'Identity verified. You can buy numbers in India.' : kyc.data?.status === 'submitted' ? 'Your verification is under review. You can buy as soon as it is approved.' : kyc.data?.status === 'rejected' ? `Your verification needs changes: ${kyc.data.note}` : 'Numbers in India need identity verification (KYC) first.'}</span>
          {kyc.data?.status !== 'approved' && <Button size="sm" onClick={onKyc}>{kyc.data?.status === 'submitted' ? 'Update details' : kyc.data?.status === 'rejected' ? 'Fix and resend' : 'Verify identity'}</Button>}
        </div>
      )}
      <div className="mt-4 space-y-2">
        {offers === null ? <p className="text-sm text-soft">Looking for numbers…</p> : offers.length === 0 ? <p className="text-sm text-soft">No numbers found. Try another type or country.</p> :
          offers.map((o) => {
            const blocked = o.kyc_required && kyc.data?.status !== 'approved'
            return (
              <div key={o.number} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3.5">
                <div className="min-w-0">
                  <div className="num text-[15px] font-semibold">{o.number}<span className="ml-2 text-xs font-normal text-soft">{o.region}</span></div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[12.5px] text-soft">
                    <span><b className="num text-ink">{o.monthly > 0 ? `${money(o.monthly)}` : 'Rent set by your plan'}</b>{o.monthly > 0 ? ' / month rent' : ''}</span>
                    <span><b className="num text-ink">{money(o.per_minute)}</b> / minute for calls</span>
                    <span>billed per minute, rounded up</span>
                  </div>
                </div>
                <Button size="sm" variant="primary" disabled={!!busy || blocked} title={blocked ? 'Verify your identity first' : undefined} onClick={() => buyIt(o.number)}>{busy === o.number ? 'Adding…' : 'Get this number'}</Button>
              </div>
            )
          })}
      </div>
    </Dialog>
  )
}

function SettingsDialog({ n, agents, onClose, onSaved }: { n: N; agents: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const [agent, setAgent] = React.useState(n.agent_id ?? '')
  const [h, setH] = React.useState(toHours(n.hours))
  const [fallback, setFallback] = React.useState(n.fallback ?? '')
  const [busy, setBusy] = React.useState(false)
  const save = async () => {
    setBusy(true)
    try {
      if ((n.agent_id ?? '') !== agent) await http(`/numbers/${n.id}/assign`, { method: 'POST', json: { agent_id: agent || null } })
      const hours = { enabled: h.enabled, tz: h.tz, windows: h.enabled ? [{ days: h.days.flatMap((on, i) => (on ? [i] : [])), start: h.start, end: h.end }] : [], closed_message: h.closed }
      await http(`/numbers/${n.id}`, { method: 'PATCH', json: { hours, ...(fallback.trim() ? { fallback: fallback.replace(/[\s-]/g, '') } : { clear_fallback: true }) } })
      toast.success('Saved!'); onSaved(); onClose()
    } catch (e) { say(e) } finally { setBusy(false) }
  }
  const release = async () => {
    if (!window.confirm('Release this number? People who call it will no longer reach your agent.')) return
    try { await http(`/numbers/${n.id}`, { method: 'DELETE' }); toast.success('Number released'); onSaved(); onClose() } catch (e) { say(e) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} side title={n.number} description="Settings for this number">
      <div className="space-y-6">
        <Field label="Answered by"><Select value={agent} onChange={(e) => setAgent(e.target.value)}><option value="">Nobody yet</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
        <div>
          <div className="mb-2 flex items-center justify-between"><span className="text-[13px] font-medium">Business hours</span><Switch checked={h.enabled} onChange={(v) => setH({ ...h, enabled: v })} label="Use business hours" /></div>
          {h.enabled && <div className="space-y-3">
            <div className="flex flex-wrap gap-2">{DAYS.map((d, i) => <button key={d} type="button" aria-pressed={h.days[i]} onClick={() => setH({ ...h, days: h.days.map((x, j) => (j === i ? !x : x)) })} className={`rounded-md border px-2.5 py-1 text-sm ${h.days[i] ? 'border-accent bg-accent-soft text-accent' : 'text-soft'}`}>{d}</button>)}</div>
            <div className="grid grid-cols-2 gap-3"><Field label="Opens"><Input type="time" value={h.start} onChange={(e) => setH({ ...h, start: e.target.value })} /></Field><Field label="Closes"><Input type="time" value={h.end} onChange={(e) => setH({ ...h, end: e.target.value })} /></Field></div>
            <Field label="Time zone"><Select value={h.tz} onChange={(e) => setH({ ...h, tz: e.target.value })}>{['Asia/Kolkata', 'UTC', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney'].map((z) => <option key={z}>{z}</option>)}</Select></Field>
            <Field label="What callers hear when you're closed"><Textarea value={h.closed} onChange={(e) => setH({ ...h, closed: e.target.value })} placeholder="We're closed right now. Please call back during our opening hours." /></Field>
          </div>}
        </div>
        <Field label="If the agent can’t help, call a human on"><Input value={fallback} onChange={(e) => setFallback(e.target.value)} placeholder="+919876543210" /></Field>
        <div className="flex gap-2"><Button variant="primary" className="flex-1" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button><Button variant="ghost" className="text-bad" onClick={release}>Release number</Button></div>
      </div>
    </Dialog>
  )
}
