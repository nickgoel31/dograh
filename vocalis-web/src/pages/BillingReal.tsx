import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock, Download, Phone, ReceiptText, ShieldCheck, Sparkles, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import { Badge, Button, Card, Field, Input, Switch } from '@/components/ui'
import { PageHeader, TableSkeleton } from '@/components/shared'
import { http } from '@/lib/api/http'
import { API_URL } from '@/lib/api/env'
import { useUI } from '@/store/ui'
import { cn } from '@/lib/utils'
import type { components } from '@/lib/api/schema'

type Summary = components['schemas']['SummaryOut']
type Invoice = components['schemas']['InvoiceOut']
type Usage = { currency: string; by_day: { day: string; minutes: number; value: number }[]; by_agent: { name: string; minutes: number; value: number }[] }
type Payment = { order_id: string; amount: number; currency: string; status: string; at: string | null }
const say = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
const fmt = (n: number, cur: string, d = 2) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur, maximumFractionDigits: d }).format(n)
const PRESETS = [500, 1000, 2000, 5000, 10000]

declare global { interface Window { Razorpay?: new (o: Record<string, unknown>) => { open: () => void } } }
const loadCheckout = () => new Promise<void>((res, rej) => {
  if (window.Razorpay) return res()
  const s = document.createElement('script')
  s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = () => res(); s.onerror = () => rej(new Error('We could not load the payment window. Check your connection and try again.'))
  document.head.appendChild(s)
})

function Stat({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-sm text-soft"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent"><Icon size={16} /></span>{label}</div>
      <div className="num mt-3 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-soft">{hint}</div>}
    </Card>
  )
}

export default function RealBilling() {
  const qc = useQueryClient()
  const mode = useUI((s) => s.mode)
  const workspaceId = useUI((s) => s.workspaceId)
  const [days, setDays] = React.useState(30)
  const sum = useQuery({ queryKey: ['billing', 'summary', mode], queryFn: () => http<Summary>('/billing/summary'), retry: false })
  const usage = useQuery({ queryKey: ['billing', 'usage', days], queryFn: () => http<Usage>(`/billing/usage?days=${days}`), retry: false })
  const inv = useQuery({ queryKey: ['billing', 'invoices'], queryFn: () => http<Invoice[]>('/billing/invoices'), retry: false })
  const pays = useQuery({ queryKey: ['billing', 'payments'], queryFn: () => http<Payment[]>('/billing/payments'), retry: false })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['billing'] }); qc.invalidateQueries({ queryKey: ['wallet-chip'] }) }
  const [amount, setAmount] = React.useState('1000')
  const [limit, setLimit] = React.useState('')
  const [prof, setProf] = React.useState({ billing_name: '', billing_gstin: '', billing_state: '', billing_address: '' })
  const s = sum.data
  React.useEffect(() => {
    if (!s) return
    setLimit(s.spend_limit ? String(s.spend_limit) : '')
    setProf({ billing_name: s.settings.billing_name ?? '', billing_gstin: s.settings.billing_gstin ?? '', billing_state: s.settings.billing_state ?? '', billing_address: s.settings.billing_address ?? '' })
  }, [s?.settings.billing_name, s?.spend_limit]) // eslint-disable-line react-hooks/exhaustive-deps

  if (sum.error) return <Card className="p-6 text-sm">{sum.error instanceof Error ? sum.error.message : 'We could not load billing.'}</Card>
  if (!s) return <TableSkeleton rows={4} />

  const save = (body: Record<string, unknown>, ok = 'Saved!') => http('/billing/settings', { method: 'PATCH', json: body }).then(() => { toast.success(ok); refresh() }).catch(say)
  const pay = async () => {
    try {
      const t = await http<components['schemas']['TopupOut']>('/billing/topups', { method: 'POST', json: { amount: Number(amount) } })
      await loadCheckout()
      new window.Razorpay!({
        key: t.key, order_id: t.order_id, amount: Math.round(t.amount * 100), currency: t.currency, name: 'Add money', theme: { color: '#0b5c4c' },
        handler: (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
          http('/billing/topups/confirm', { method: 'POST', json: { order_id: r.razorpay_order_id, payment_id: r.razorpay_payment_id, signature: r.razorpay_signature } })
            .then(() => { toast.success('Money added!'); refresh() }).catch(say),
      }).open()
    } catch (e) { say(e) }
  }
  const pdf = async (n: string) => {
    const res = await fetch(`${API_URL}/billing/invoices/${n}/pdf`, { credentials: 'include', headers: { 'X-Environment': mode, ...(workspaceId ? { 'X-Workspace': workspaceId } : {}) } })
    if (!res.ok) return say(new Error('We could not download that invoice.'))
    const url = URL.createObjectURL(await res.blob())
    Object.assign(document.createElement('a'), { href: url, download: `${n}.pdf` }).click()
    URL.revokeObjectURL(url)
  }

  const u = usage.data
  const totalMin = u?.by_day.reduce((a, d) => a + d.minutes, 0) ?? 0
  const totalVal = u?.by_day.reduce((a, d) => a + d.value, 0) ?? 0
  const limitPct = s.spend_limit ? Math.min(100, Math.round((s.month_usage_value / s.spend_limit) * 100)) : 0
  const canPay = s.payments_enabled && !s.free_mode
  const statusTone = (st: string) => (st === 'paid' || st === 'captured' ? 'green' : st === 'failed' ? 'red' : 'orange')

  return (
    <>
      <PageHeader title="Billing & Usage" subtitle="Your balance, what you spent, and your invoices." />
      {s.limit_state !== 'ok' && (
        <Card className="mb-4 flex items-center gap-3 border-warn/40 bg-warn/10 p-4 text-warn" role="alert"><AlertTriangle size={18} />
          {s.limit_state === 'limit' ? "You've reached your monthly spending limit, so new calls are paused. Raise the limit to carry on." : "You've used over 80% of your monthly spending limit."}</Card>)}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-[#0b5c4c] to-[#134e4a] p-6 text-white">
          <div className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/10" /><div className="absolute -bottom-16 right-16 h-40 w-40 rounded-full bg-white/5" />
          <div className="relative">
            <div className="flex items-center gap-2 text-sm text-white/70"><Wallet size={16} />Available balance</div>
            <div className="num mt-2 text-4xl font-semibold tracking-tight">{fmt(s.balance, s.currency)}</div>
            <div className="mt-1 text-sm text-white/70">{s.minutes_available > 0 ? `${Math.floor(s.minutes_available)} minutes left to use` : s.low_balance ? 'Running low. Add money to keep taking calls.' : 'About ' + Math.floor(s.balance / s.price_per_min) + ' minutes of calls'}</div>
            <div className="mt-5 flex flex-wrap gap-2">{PRESETS.map((p) => (
              <button key={p} onClick={() => setAmount(String(p))} className={cn('rounded-full px-3.5 py-1.5 text-sm transition', Number(amount) === p ? 'bg-white text-[#0b5c4c]' : 'bg-white/15 hover:bg-white/25')}>{fmt(p, s.currency, 0)}</button>))}</div>
            <div className="mt-4 flex max-w-sm gap-2">
              <Input type="number" min={100} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount to add" className="border-white/20 bg-white/10 text-white placeholder:text-white/50" />
              <Button className="bg-white text-[#0b5c4c] hover:bg-white/90" disabled={!canPay || Number(amount) < 100} onClick={pay}>Add money</Button></div>
            {!s.payments_enabled && <div className="mt-2 text-xs text-white/70">Online payments are being switched on. They will appear here shortly.</div>}
            {s.payments_enabled && <div className="mt-3 flex items-center gap-1.5 text-xs text-white/60"><ShieldCheck size={13} />Secure payment by card, UPI or net banking. GST invoice for every top-up.</div>}
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="font-semibold">What you pay now</h3>
          <div className="num mt-2 text-3xl font-semibold tracking-tight">{fmt(s.price_per_min, s.currency)}<span className="text-base font-normal text-soft"> / minute</span></div>
          <p className="mt-1 text-[13px] text-soft">One price, nothing hidden. It includes:</p>
          <ul className="mt-3 space-y-2 text-sm">{['The AI that talks and thinks', 'The voice and speech recognition', 'The phone line for the call', 'Recordings, transcripts and analytics'].map((x) => <li key={x} className="flex items-center gap-2"><CheckCircle2 size={15} className="text-ok" />{x}</li>)}</ul>
          <div className="mt-4 overflow-hidden rounded-lg border text-sm"><div className="border-b bg-muted/50 px-3 py-1.5 text-xs font-medium text-soft">Price per minute by minutes used this month</div>
            {(s.slabs as unknown as { up_to: number; rate: number }[]).map((x, i, all) => {
              const from = i === 0 ? 0 : all[i - 1].up_to
              const here = s.price_per_min === x.rate && (i === 0 || s.next_rate_at === null || s.next_rate_at === x.up_to)
              return <div key={x.up_to} className={cn('flex justify-between px-3 py-1.5', here && 'bg-accent-soft font-semibold text-accent')}><span>{from.toLocaleString('en-IN')} – {x.up_to.toLocaleString('en-IN')} min</span><span className="num">{fmt(x.rate, s.currency)}</span></div>
            })}
            <div className="border-t px-3 py-1.5 text-xs text-soft">More than {s.contact_sales_above.toLocaleString('en-IN')} minutes a month? Talk to us for enterprise pricing.</div></div>
          {s.next_rate_at && <p className="mt-2 text-xs text-soft">{Math.max(0, Math.round(s.next_rate_at - s.month_minutes)).toLocaleString('en-IN')} more minutes this month and the price drops to {fmt(s.next_rate ?? 0, s.currency)}.</p>}
          <p className="mt-3 text-xs text-soft">Billed per minute, rounded up: a 61 second call is 2 minutes, and a call that never connects is free. Practice calls from the Talk button are charged at the same price. Monthly phone number rent is billed separately.</p>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={ReceiptText} label="Spent this month" value={fmt(s.month_usage_value, s.currency)} hint={s.spend_limit ? `${limitPct}% of your ${fmt(s.spend_limit, s.currency, 0)} limit` : 'No monthly limit set'} />
        <Stat icon={Clock} label="Minutes this month" value={s.month_minutes} hint="Calls answered or made" />
        <Stat icon={Sparkles} label="Average per call minute" value={s.month_minutes ? fmt(s.month_usage_value / s.month_minutes, s.currency) : '—'} hint="Matches your price when everything is included" />
        <Stat icon={Phone} label={`Last ${days} days`} value={fmt(totalVal, s.currency)} hint={`${Math.round(totalMin * 10) / 10} minutes`} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card className="p-5">
          <div className="flex items-center justify-between"><h3 className="font-semibold">Spend over time</h3>
            <div className="flex gap-1 rounded-lg bg-muted p-1 text-xs font-medium">{[7, 30, 90].map((d) => <button key={d} onClick={() => setDays(d)} className={cn('rounded-md px-2.5 py-1', days === d ? 'bg-surface shadow-card' : 'text-soft')}>{d}d</button>)}</div></div>
          {u && u.by_day.length > 0 ? (
            <div className="mt-4 h-60"><ResponsiveContainer><AreaChart data={u.by_day}><defs><linearGradient id="spend" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.35} /><stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid vertical={false} strokeOpacity={0.12} /><XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} fontSize={11} tickLine={false} axisLine={false} /><YAxis fontSize={11} width={44} tickLine={false} axisLine={false} />
              <RTooltip formatter={(v) => fmt(Number(v), s.currency)} /><Area dataKey="value" name="Spend" stroke="hsl(var(--accent))" strokeWidth={2} fill="url(#spend)" /></AreaChart></ResponsiveContainer></div>
          ) : <p className="mt-4 text-sm text-soft">No calls in this period yet. Spending will show up here.</p>}
        </Card>
        <Card className="p-5">
          <h3 className="font-semibold">By agent</h3>
          {u && u.by_agent.length > 0 ? <div className="mt-4 space-y-4">{u.by_agent.map((a) => { const pct = totalVal ? Math.round((a.value / totalVal) * 100) : 0
            return <div key={a.name}><div className="flex justify-between text-sm"><span className="font-medium">{a.name}</span><span className="num text-soft">{fmt(a.value, s.currency)} · {a.minutes} min</span></div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></div></div> })}</div>
            : <p className="mt-4 text-sm text-soft">Nothing yet.</p>}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="font-semibold">Spending limit</h3><p className="mb-3 text-[13px] text-soft">Calls pause when you reach this each month. You get a warning at 80%.</p>
          <div className="flex gap-2"><Input type="number" min={0} placeholder="No limit" value={limit} onChange={(e) => setLimit(e.target.value)} aria-label="Monthly spending limit" />
            <Button onClick={() => (limit ? save({ spend_limit: Number(limit) }) : save({ clear_spend_limit: true }))}>Save</Button></div>
          {s.spend_limit ? <div className="mt-4"><div className="h-2 overflow-hidden rounded-full bg-muted"><div className={cn('h-full rounded-full', limitPct >= 80 ? 'bg-warn' : 'bg-accent')} style={{ width: `${limitPct}%` }} /></div>
            <div className="mt-1 text-xs text-soft">{fmt(s.month_usage_value, s.currency)} of {fmt(s.spend_limit, s.currency, 0)} used this month</div></div> : null}
          <div className="mt-5 flex items-center justify-between"><div><div className="text-sm font-medium">Low-balance reminder</div><div className="text-xs text-soft">We'll remind you when your balance runs low. Automatic charging isn't available yet.</div></div>
            <Switch checked={s.settings.auto_topup_enabled} onChange={(v) => save({ auto_topup_enabled: v })} label="Low-balance reminder" /></div>
        </Card>
        <Card className="p-5">
          <h3 className="font-semibold">Invoice details</h3><p className="mb-3 text-[13px] text-soft">Printed on your GST tax invoices.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Business name"><Input value={prof.billing_name} onChange={(e) => setProf({ ...prof, billing_name: e.target.value })} /></Field>
            <Field label="GSTIN"><Input value={prof.billing_gstin} onChange={(e) => setProf({ ...prof, billing_gstin: e.target.value.toUpperCase() })} /></Field>
            <Field label="State code (e.g. 29)"><Input value={prof.billing_state} maxLength={2} onChange={(e) => setProf({ ...prof, billing_state: e.target.value })} /></Field>
            <Field label="Address"><Input value={prof.billing_address} onChange={(e) => setProf({ ...prof, billing_address: e.target.value })} /></Field>
          </div>
          <Button className="mt-3" onClick={() => save(prof)}>Save details</Button>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="p-5 pb-3"><h3 className="font-semibold">Payments</h3></div>
          {pays.data && pays.data.length > 0 ? (
            <table className="w-full text-sm"><thead className="border-y bg-muted/50 text-left text-xs text-soft"><tr>{['Date', 'Reference', 'Amount', 'Status'].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>{pays.data.map((p) => <tr key={p.order_id} className="border-b last:border-0"><td className="px-4 py-3">{p.at ? new Date(p.at).toLocaleDateString() : '—'}</td><td className="px-4 py-3 font-mono text-xs">{p.order_id.slice(-10)}</td>
                <td className="num px-4 py-3 font-medium">{fmt(p.amount, p.currency)}</td><td className="px-4 py-3"><Badge tone={statusTone(p.status)}>{p.status}</Badge></td></tr>)}</tbody></table>
          ) : <p className="px-5 pb-5 text-sm text-soft">Money you add will be listed here.</p>}
        </Card>
        <Card className="overflow-hidden">
          <div className="p-5 pb-3"><h3 className="font-semibold">Invoices</h3></div>
          {inv.data && inv.data.length > 0 ? (
            <table className="w-full text-sm"><thead className="border-y bg-muted/50 text-left text-xs text-soft"><tr>{['Invoice', 'Month', 'Minutes', 'Tax', 'Total', ''].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>{inv.data.map((i) => <tr key={i.number} className="border-b last:border-0"><td className="px-4 py-3 font-medium">{i.number}</td><td className="px-4 py-3">{i.period}</td><td className="num px-4 py-3">{i.minutes}</td><td className="num px-4 py-3">{fmt(i.tax, i.currency)}</td><td className="num px-4 py-3 font-medium">{fmt(i.total, i.currency)}</td>
                <td className="px-4 py-3 text-right"><Button size="sm" onClick={() => pdf(i.number)}><Download size={14} />PDF</Button></td></tr>)}</tbody></table>
          ) : <p className="px-5 pb-5 text-sm text-soft">Your first invoice appears after your first full month of calls.</p>}
        </Card>
      </div>
      <p className="mt-4 flex items-center gap-1.5 text-xs text-soft"><ArrowUpRight size={12} />Questions about a charge? Write to us from the Help page.</p>
    </>
  )
}
