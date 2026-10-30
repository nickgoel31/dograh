import * as React from 'react'
import { AlertTriangle, Download } from 'lucide-react'
import { toast } from 'sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import { Button, Card, Field, Input, Switch } from '@/components/ui'
import { PageHeader, TableSkeleton } from '@/components/shared'
import { http } from '@/lib/api/http'
import { API_URL } from '@/lib/api/env'
import { useUI } from '@/store/ui'
import type { components } from '@/lib/api/schema'

type Summary = components['schemas']['SummaryOut']
type Invoice = components['schemas']['InvoiceOut']
type Usage = { currency: string; by_day: { day: string; minutes: number; value: number }[]; by_agent: { name: string; minutes: number; value: number }[] }
const say = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
const fmt = (n: number, cur: string) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(n)

declare global { interface Window { Razorpay?: new (o: Record<string, unknown>) => { open: () => void } } }
const loadCheckout = () => new Promise<void>((res, rej) => {
  if (window.Razorpay) return res()
  const s = document.createElement('script')
  s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = () => res(); s.onerror = () => rej(new Error('We could not load the payment window. Check your connection.'))
  document.head.appendChild(s)
})

export default function RealBilling() {
  const qc = useQueryClient()
  const mode = useUI((s) => s.mode)
  const workspaceId = useUI((s) => s.workspaceId)
  const sum = useQuery({ queryKey: ['billing', 'summary', mode], queryFn: () => http<Summary>('/billing/summary'), retry: false })
  const usage = useQuery({ queryKey: ['billing', 'usage'], queryFn: () => http<Usage>('/billing/usage?days=30'), retry: false })
  const inv = useQuery({ queryKey: ['billing', 'invoices'], queryFn: () => http<Invoice[]>('/billing/invoices'), retry: false })
  const refresh = () => qc.invalidateQueries({ queryKey: ['billing'] })
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
        key: t.key, order_id: t.order_id, amount: Math.round(t.amount * 100), currency: t.currency, name: 'Add money',
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

  return (
    <>
      <PageHeader title="Billing & Usage" subtitle={`One simple price: ${fmt(s.price_per_min, s.currency)} per minute, everything included.`} />
      {s.free_mode && <Card className="mb-4 border-warn/40 bg-warn/10 p-4 text-sm text-warn">You're in Test mode, so nothing here is charged. The numbers below are for Live.</Card>}
      {s.limit_state !== 'ok' && (
        <Card className="mb-4 flex items-center gap-3 border-warn/40 bg-warn/10 p-4 text-warn" role="alert"><AlertTriangle size={18} />
          {s.limit_state === 'limit' ? "You've reached your monthly spending limit, so new calls are paused. Raise the limit to carry on." : "You've used over 80% of your monthly spending limit."}</Card>)}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5"><div className="text-sm text-soft">Balance</div><div className="num mt-1 text-2xl font-semibold">{fmt(s.balance, s.currency)}</div><div className="mt-1 text-xs text-soft">{s.minutes_available > 0 ? `${s.minutes_available} free/prepaid minutes left` : s.low_balance ? 'Running low: add money to keep taking calls' : ' '}</div></Card>
        <Card className="p-5"><div className="text-sm text-soft">This month</div><div className="num mt-1 text-2xl font-semibold">{fmt(s.month_usage_value, s.currency)}</div><div className="mt-1 text-xs text-soft">{s.month_minutes} minutes</div></Card>
        <Card className="p-5">
          <div className="text-sm text-soft">Add money</div>
          <div className="mt-2 flex gap-2"><Input type="number" min={100} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" /><Button variant="primary" disabled={!s.payments_enabled || s.free_mode} onClick={pay}>Add</Button></div>
          {!s.payments_enabled && <div className="mt-1 text-xs text-soft">Adding money isn't switched on yet.</div>}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="font-semibold">Spending limit</h3><p className="mb-3 text-[13px] text-soft">Calls pause when you reach this each month. You get a warning at 80%.</p>
          <div className="flex gap-2"><Input type="number" min={0} placeholder="No limit" value={limit} onChange={(e) => setLimit(e.target.value)} aria-label="Monthly spending limit" />
            <Button onClick={() => (limit ? save({ spend_limit: Number(limit) }) : save({ clear_spend_limit: true }))}>Save</Button></div>
          <div className="mt-4 flex items-center justify-between"><div><div className="text-sm font-medium">Top-up reminder</div><div className="text-xs text-soft">Automatic charging isn't available yet. We'll just remind you when your balance is low.</div></div>
            <Switch checked={s.settings.auto_topup_enabled} onChange={(v) => save({ auto_topup_enabled: v })} label="Top-up reminder" /></div>
        </Card>
        <Card className="p-5">
          <h3 className="font-semibold">Invoice details</h3><p className="mb-3 text-[13px] text-soft">Printed on your tax invoices.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Business name"><Input value={prof.billing_name} onChange={(e) => setProf({ ...prof, billing_name: e.target.value })} /></Field>
            <Field label="GSTIN"><Input value={prof.billing_gstin} onChange={(e) => setProf({ ...prof, billing_gstin: e.target.value.toUpperCase() })} /></Field>
            <Field label="State code (e.g. 29)"><Input value={prof.billing_state} maxLength={2} onChange={(e) => setProf({ ...prof, billing_state: e.target.value })} /></Field>
            <Field label="Address"><Input value={prof.billing_address} onChange={(e) => setProf({ ...prof, billing_address: e.target.value })} /></Field>
          </div>
          <Button className="mt-3" onClick={() => save(prof)}>Save details</Button>
        </Card>
      </div>

      <Card className="mt-4 p-5">
        <h3 className="font-semibold">Usage, last 30 days</h3>
        {usage.data && usage.data.by_day.length > 0 ? (
          <div className="mt-3 h-56"><ResponsiveContainer><BarChart data={usage.data.by_day}><CartesianGrid vertical={false} strokeOpacity={0.15} /><XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} fontSize={11} /><YAxis fontSize={11} width={40} /><RTooltip formatter={(v) => fmt(Number(v), s.currency)} /><Bar dataKey="value" name="Usage" fill="currentColor" className="text-accent" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
        ) : <p className="mt-2 text-sm text-soft">No calls yet. Usage will show up here.</p>}
        {usage.data && usage.data.by_agent.length > 0 && <table className="mt-4 w-full text-sm"><tbody>{usage.data.by_agent.map((a) => <tr key={a.name} className="border-t"><td className="py-2">{a.name}</td><td className="num py-2 text-right text-soft">{a.minutes} min</td><td className="num py-2 text-right">{fmt(a.value, s.currency)}</td></tr>)}</tbody></table>}
      </Card>

      <Card className="mt-4 overflow-hidden">
        <div className="p-5 pb-3"><h3 className="font-semibold">Invoices</h3></div>
        {inv.data && inv.data.length > 0 ? (
          <table className="w-full text-sm"><thead className="border-y bg-muted/50 text-left text-xs text-soft"><tr>{['Invoice', 'Month', 'Minutes', 'Tax', 'Total', ''].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>{inv.data.map((i) => <tr key={i.number} className="border-b last:border-0"><td className="px-4 py-3 font-medium">{i.number}</td><td className="px-4 py-3">{i.period}</td><td className="num px-4 py-3">{i.minutes}</td><td className="num px-4 py-3">{fmt(i.tax, i.currency)}</td><td className="num px-4 py-3">{fmt(i.total, i.currency)}</td>
              <td className="px-4 py-3 text-right"><Button size="sm" onClick={() => pdf(i.number)}><Download size={14} />PDF</Button></td></tr>)}</tbody></table>
        ) : <p className="px-5 pb-5 text-sm text-soft">Your first invoice appears after your first full month of calls.</p>}
      </Card>
    </>
  )
}
