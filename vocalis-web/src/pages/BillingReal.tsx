import * as React from 'react'
import type { LucideIcon } from '@/components/icons'
import { AlertTriangle, ArrowUpRight, Building2, Check, CheckCircle2, Clock, Download, Gauge, Lock, Phone, ReceiptText, ShieldCheck, Sparkles, TrendingDown, Wallet, Zap } from '@/components/icons'
import { toast } from 'sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import { Badge, Button, Card, Chip, Field, Input, Switch, Tab, TabPanel, Tabs, TabsList } from '@/components/ui'
import { AgentAvatar } from '@/components/AgentAvatar'
import { PageHeader, TableSkeleton } from '@/components/shared'
import { http } from '@/lib/api/http'
import { API_URL } from '@/lib/api/env'
import { useUI } from '@/store/ui'
import { cn } from '@/lib/utils'
import type { components } from '@/lib/api/schema'

type Summary = components['schemas']['SummaryOut']
type Invoice = components['schemas']['InvoiceOut']
type Usage = { currency: string; by_day: { day: string; minutes: number; value: number }[]; by_agent: { name: string; minutes: number; value: number }[]; practice?: { minutes: number; value: number } }
type Payment = { order_id: string; amount: number; currency: string; status: string; at: string | null }
const say = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
const fmt = (n: number, cur: string, d = 2) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur, maximumFractionDigits: d }).format(n)
const PRESETS = [500, 1000, 2000, 5000, 10000]

/* ---------- price slabs: the price follows the minutes your wallet holds ---------- */
type Row = { from: number; to: number; rate: number; unlock: number }
/** `unlock` is the wallet balance that fills the slab's first minute at the slab's own price (e.g. 1,000 min x 6.00 = 6,000). */
const toRows = (slabs: unknown): Row[] =>
  (slabs as { up_to: number; rate: number }[]).map((x, i, all) => {
    const from = i === 0 ? 0 : all[i - 1].up_to
    return { from, to: x.up_to, rate: x.rate, unlock: from * x.rate }
  })
const rowFor = (balance: number, rows: Row[]) => {
  for (let i = rows.length - 1; i >= 0; i--) if (balance >= rows[i].unlock - 1e-9) return i
  return 0
}

declare global { interface Window { Razorpay?: new (o: Record<string, unknown>) => { open: () => void } } }
const loadCheckout = () => new Promise<void>((res, rej) => {
  if (window.Razorpay) return res()
  const s = document.createElement('script')
  s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = () => res(); s.onerror = () => rej(new Error('We could not load the payment window. Check your connection and try again.'))
  document.head.appendChild(s)
})

/* ---------- building blocks ---------- */
function Panel({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <Card className={cn('overflow-hidden rounded-2xl', className)} {...p}>{children}</Card>
}

/** Big money with a quiet currency symbol and quiet paise. */
function Money({ value, currency, className }: { value: number; currency: string; className?: string }) {
  const parts = new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).formatToParts(value)
  return (
    <span className={cn('num inline-flex items-baseline', className)}>
      {parts.map((p, i) => p.type === 'currency'
        ? <span key={i} className="mr-1 text-[.62em] font-medium opacity-50">{p.value}</span>
        : p.type === 'decimal' || p.type === 'fraction'
          ? <span key={i} className="text-[.55em] font-medium opacity-50">{p.value}</span>
          : <span key={i}>{p.value}</span>)}
    </span>
  )
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <Panel className="p-5">
      <div className="text-[13px] text-soft">{label}</div>
      <div className="num mt-2 text-[26px] font-semibold leading-none tracking-tight">{value}</div>
      {hint && <div className="mt-2 text-xs text-soft">{hint}</div>}
    </Panel>
  )
}

function Empty({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-6 pb-10 pt-6 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted/70 text-soft ring-1 ring-inset ring-line/70"><Icon size={18} /></span>
      <p className="max-w-xs text-[13px] leading-relaxed text-soft">{text}</p>
    </div>
  )
}

function SpendTip({ active, payload, label, currency }: { active?: boolean; payload?: { value?: number | string }[]; label?: string | number; currency: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass rounded-xl border border-line/80 px-3 py-2 shadow-pop">
      <div className="text-[11px] font-medium uppercase tracking-wider text-soft">{String(label ?? '')}</div>
      <div className="num mt-0.5 text-sm font-semibold">{fmt(Number(payload[0].value ?? 0), currency)}</div>
    </div>
  )
}

/** Every slab as a ladder: where you are, what you've passed, and what a bigger wallet unlocks. */
function Ladder({ rows, curIdx, currency }: { rows: Row[]; curIdx: number; currency: string }) {
  const maxRate = Math.max(...rows.map((r) => r.rate))
  return (
    <div className="overflow-hidden rounded-xl border border-line/70 bg-muted/20">
      <div className="flex items-center justify-between border-b border-line/70 bg-muted/40 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-soft"><span>Minutes in your wallet</span><span>Price per minute</span></div>
      {rows.map((r, i) => {
        const here = i === curIdx, passed = i < curIdx
        return (
          <div key={r.to} className={cn('relative flex items-center gap-3 px-3.5 py-2.5 text-sm transition-colors', i > 0 && 'border-t border-line/50', here ? 'bg-gradient-to-r from-accent/20 via-accent/[0.08] to-transparent' : 'hover:bg-muted/40', i > curIdx && 'opacity-80')}>
            {here && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-accent shadow-glow" />}
            <span className={cn('flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px]', here ? 'bg-accent text-accent-fg shadow-glow' : passed ? 'bg-accent/15 text-accent' : 'bg-muted text-soft ring-1 ring-inset ring-line/70')}>
              {here || passed ? <Check size={12} strokeWidth={3} /> : <Lock size={10} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className={cn('num leading-tight', here ? 'font-semibold text-accent' : 'font-medium')}>{r.from.toLocaleString('en-IN')} – {r.to.toLocaleString('en-IN')} min</div>
              <div className="mt-0.5 text-[11px] text-soft">{here ? "You're here" : passed ? 'Passed' : r.unlock > 0 ? `Unlocks at ${fmt(r.unlock, currency, 0)} in your wallet` : 'Starting price'}</div>
            </div>
            <span className="hidden h-1 w-12 overflow-hidden rounded-full bg-line sm:block"><span className={cn('block h-full rounded-full', here ? 'bg-accent' : 'bg-soft/40')} style={{ width: `${(r.rate / maxRate) * 100}%` }} /></span>
            <span className={cn('num w-14 text-right', here ? 'text-[15px] font-bold text-accent' : 'font-semibold')}>{fmt(r.rate, currency)}</span>
          </div>
        )
      })}
    </div>
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

  if (sum.error) return <Panel className="p-6 text-sm">{sum.error instanceof Error ? sum.error.message : 'We could not load billing.'}</Panel>
  if (!s) return <TableSkeleton rows={4} />

  const save = (body: Record<string, unknown>, ok = 'Saved!') => http('/billing/settings', { method: 'PATCH', json: body }).then(() => { toast.success(ok); refresh() }).catch(say)
  const pay = async () => {
    try {
      const t = await http<components['schemas']['TopupOut']>('/billing/topups', { method: 'POST', json: { amount: Number(amount) } })
      await loadCheckout()
      new window.Razorpay!({
        key: t.key, order_id: t.order_id, amount: Math.round(t.amount * 100), currency: t.currency, name: 'Add money', theme: { color: '#0b5c4c' },
        modal: { ondismiss: () => { void http('/billing/topups/cancel', { method: 'POST', json: { order_id: t.order_id } }).then(() => refresh()).catch(() => undefined) } },
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
  const statusTone = (st: string) => (st === 'paid' || st === 'captured' ? 'green' : st === 'failed' ? 'red' : st === 'created' ? 'orange' : 'gray')
  const statusLabel = (st: string) => ({ created: 'waiting for payment', canceled: 'cancelled', expired: 'expired', paid: 'paid' } as Record<string, string>)[st] ?? st

  // Where the wallet sits on the price ladder, and what a top-up would do to it.
  const raw = toRows(s.slabs)
  const rows: Row[] = raw.length ? raw : [{ from: 0, to: Infinity, rate: s.price_per_min, unlock: 0 }]
  const curIdx = rowFor(s.balance, rows)
  const cur = rows[curIdx]
  const nxt = rows[curIdx + 1]
  const toNext = nxt ? Math.max(0, nxt.unlock - s.balance) : 0
  const climb = nxt ? Math.min(1, Math.max(0, (s.balance - cur.unlock) / (nxt.unlock - cur.unlock))) : 1
  const amt = Number(amount) || 0
  const bonusMin = Math.max(0, s.minutes_available - (s.price_per_min > 0 ? s.balance / s.price_per_min : 0)) // free / carried-over minutes
  const afterIdx = rowFor(s.balance + amt, rows)
  const afterRow = rows[afterIdx]
  const afterMin = Math.floor(bonusMin + (s.balance + amt) / afterRow.rate)
  const unlocks = amt >= 100 && afterIdx > curIdx

  const TH = 'px-5 py-2.5 text-left text-xs font-medium text-soft'
  return (
    <>
      <PageHeader title="Billing & Usage" subtitle="Add money, see what you spent, and download invoices." />
      {s.limit_state !== 'ok' && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm text-warn" role="alert">
          <AlertTriangle size={17} className="shrink-0" />
          <span className="font-medium">{s.limit_state === 'limit' ? "You've reached your monthly spending limit, so new calls are paused. Raise the limit to carry on." : "You've used over 80% of your monthly spending limit."}</span>
        </div>)}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        {/* ---------- balance ---------- */}
        <Panel className="relative flex flex-col p-6 sm:p-7">
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[#22d3ee]/25 blur-3xl" aria-hidden />
          <div className="pointer-events-none absolute -bottom-24 -right-4 h-56 w-56 rounded-full bg-[#7c3aed]/20 blur-3xl" aria-hidden />
          <div className="relative flex items-center justify-between gap-3">
            <span className="text-sm text-soft">Available balance</span>
            <span className="num rounded-full border bg-surface px-3 py-1 text-xs font-medium">{fmt(s.price_per_min, s.currency)} / min</span>
          </div>
          <div className="relative mt-4"><Money value={s.balance} currency={s.currency} className="text-[46px] font-semibold leading-none tracking-tight sm:text-[56px]" /></div>
          <p className="relative mt-3 text-[14px] text-soft">
            {s.minutes_available > 0 ? <><b className="num text-ink">{Math.floor(s.minutes_available).toLocaleString('en-IN')}</b> minutes left to use</> : s.low_balance ? 'Running low. Add money to keep taking calls.' : `About ${Math.floor(s.balance / s.price_per_min)} minutes of calls`}
          </p>

          <div className="relative mt-auto pt-8">
            <div className="flex items-center justify-between text-xs text-soft">
              <span>{nxt ? 'Next price drop' : 'Best self-serve price'}</span>
              <span className="num">{nxt ? `${fmt(cur.rate, s.currency)} → ${fmt(nxt.rate, s.currency)} / min` : `${fmt(cur.rate, s.currency)} / min`}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-[linear-gradient(90deg,#22d3ee,#6366f1,#8b5cf6)] transition-all duration-700" style={{ width: `${Math.max(4, Math.round(climb * 100))}%` }} /></div>
            <p className="mt-2 text-[13px] text-soft">{nxt ? <>Add <b className="num text-ink">{fmt(toNext, s.currency)}</b> more to pay <b className="num text-ink">{fmt(nxt.rate, s.currency)}</b> a minute.</> : "You're on our lowest self-serve price."}</p>
          </div>
        </Panel>

        {/* ---------- add money ---------- */}
        <Panel className="flex flex-col p-6 sm:p-7">
          <h3 className="text-[15px] font-semibold">Add money</h3>
          <div className="mt-4 flex flex-wrap gap-2">{PRESETS.map((p) => <Chip key={p} active={amt === p} onClick={() => setAmount(String(p))}>{fmt(p, s.currency, 0)}</Chip>)}</div>
          <div className="relative mt-4">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg text-soft">₹</span>
            <Input type="number" min={100} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount to add" className="num h-12 pl-8 text-lg font-medium" />
          </div>
          <Button variant="primary" size="lg" className="mt-3 w-full" disabled={!canPay || amt < 100} onClick={pay}>Add {amt >= 100 ? fmt(amt, s.currency, 0) : 'money'}</Button>
          {amt >= 100 && (
            <p className="mt-3 text-[13px] text-soft">
              Your wallet will hold about <b className="num text-ink">{afterMin.toLocaleString('en-IN')} minutes</b> at <b className="num text-ink">{fmt(afterRow.rate, s.currency)}</b> / min.
              {unlocks && <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-ok/10 px-2 py-0.5 text-[11px] font-semibold text-ok"><Zap size={10} />Price drops</span>}
            </p>)}
          {!s.payments_enabled && <p className="mt-3 text-xs text-soft">Online payments are being switched on. They will appear here shortly.</p>}
          <p className="mt-auto flex items-center gap-1.5 pt-5 text-xs text-soft"><ShieldCheck size={13} />Pay by card, UPI or net banking. You get a GST invoice for every top-up.</p>
        </Panel>
      </div>

      {/* ---------- how pricing works, tucked away ---------- */}
      <details className="group mt-4 rounded-2xl border bg-surface">
        <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4 text-sm font-medium"><span>How pricing works</span><span className="text-xs font-normal text-soft group-open:hidden">Show price steps</span></summary>
        <div className="border-t px-6 pb-6 pt-5">
          <p className="max-w-2xl text-[13px] leading-relaxed text-soft">One price covers the AI, the voice, the phone line, recordings and analytics. The more money your wallet holds, the lower your price per minute, and a price you have reached is kept. Calls are billed per minute, rounded up (61 seconds is 2 minutes), and a call that never connects is free. Practice calls cost the same. Phone number rent is billed separately.</p>
          <div className="mt-4 max-w-xl"><Ladder rows={rows} curIdx={curIdx} currency={s.currency} /></div>
          <p className="mt-2.5 text-xs text-soft">More than {s.contact_sales_above.toLocaleString('en-IN')} minutes in your wallet? Talk to us for enterprise pricing.</p>
        </div>
      </details>

      {/* ---------- usage ---------- */}
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Stat label="Spent this month" value={fmt(s.month_usage_value, s.currency)} hint={s.spend_limit ? `${limitPct}% of your ${fmt(s.spend_limit, s.currency, 0)} limit` : 'No monthly limit set'} />
        <Stat label="Minutes this month" value={s.month_minutes} hint="Calls answered or made" />
        <Stat label="Average per minute" value={s.month_minutes ? fmt(s.month_usage_value / s.month_minutes, s.currency) : '—'} hint="Matches your price when everything is included" />
      </div>
      {!!u?.practice?.minutes && <p className="mt-3 text-[13px] text-soft">Practice calls from your browser are included: {u.practice.minutes} min, {fmt(u.practice.value, s.currency)} in the last {days} days. They are billed like real calls.</p>}

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Panel className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="text-[15px] font-semibold">Spend over time</h3><p className="num mt-0.5 text-[13px] text-soft">{fmt(totalVal, s.currency)} across {Math.round(totalMin * 10) / 10} minutes</p></div>
            <div className="flex gap-2">{[7, 30, 90].map((d) => <Chip key={d} active={days === d} onClick={() => setDays(d)}>{d} days</Chip>)}</div>
          </div>
          {u && u.by_day.length > 0 ? (
            <div className="mt-5 h-64"><ResponsiveContainer><AreaChart data={u.by_day} margin={{ top: 6, right: 4, left: -8, bottom: 0 }}><defs><linearGradient id="spend" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.3} /><stop offset="80%" stopColor="hsl(var(--accent))" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid vertical={false} strokeDasharray="3 5" strokeOpacity={0.16} /><XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} fontSize={11} tickLine={false} axisLine={false} tickMargin={8} /><YAxis fontSize={11} width={48} tickLine={false} axisLine={false} />
              <RTooltip cursor={{ stroke: 'hsl(var(--accent))', strokeOpacity: 0.3, strokeDasharray: '4 4' }} content={<SpendTip currency={s.currency} />} /><Area dataKey="value" name="Spend" type="monotone" stroke="hsl(var(--accent))" strokeWidth={2} fill="url(#spend)" /></AreaChart></ResponsiveContainer></div>
          ) : <Empty icon={Gauge} text="No calls in this period yet. Spending will show up here." />}
        </Panel>
        <Panel className="p-5 sm:p-6">
          <h3 className="text-[15px] font-semibold">By agent</h3>
          {u && u.by_agent.length > 0 ? <div className="mt-5 space-y-4">{u.by_agent.map((a) => { const pct = totalVal ? Math.round((a.value / totalVal) * 100) : 0
            return <div key={a.name}>
              <div className="flex items-center gap-3">
                <AgentAvatar id={a.name} className="h-8 w-8" />
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{a.name}</div><div className="num text-xs text-soft">{a.minutes} min</div></div>
                <div className="text-right"><div className="num text-sm font-semibold">{fmt(a.value, s.currency)}</div><div className="num text-xs text-soft">{pct}%</div></div>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-accent/70 transition-all duration-700" style={{ width: `${Math.max(pct, 3)}%` }} /></div></div> })}</div>
            : <Empty icon={Sparkles} text="Nothing yet. Your busiest agents will rank here." />}
        </Panel>
      </div>

      {/* ---------- everything else, one tab at a time ---------- */}
      <Tabs defaultValue="payments" className="mt-10">
        <TabsList>{[['payments', 'Payments'], ['invoices', 'Invoices'], ['limits', 'Limit & auto top-up'], ['details', 'Invoice details']].map(([v, l]) => <Tab key={v} value={v}>{l}</Tab>)}</TabsList>

        <TabPanel value="payments">
          <Panel>
            {pays.data && pays.data.length > 0 ? (
              <table className="w-full text-sm"><thead className="border-b"><tr>{['Date', 'Reference', 'Amount', 'Status'].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
                <tbody>{pays.data.map((p) => <tr key={p.order_id} className="border-b last:border-0 hover:bg-muted/30"><td className="px-5 py-3.5">{p.at ? new Date(p.at).toLocaleDateString() : '—'}</td><td className="px-5 py-3.5 font-mono text-xs text-soft">{p.order_id.slice(-10)}</td>
                  <td className="num px-5 py-3.5 font-semibold">{fmt(p.amount, p.currency)}</td><td className="px-5 py-3.5"><Badge tone={statusTone(p.status)}><span className="h-1.5 w-1.5 rounded-full bg-current" />{statusLabel(p.status)}</Badge></td></tr>)}</tbody></table>
            ) : <Empty icon={Wallet} text="Money you add will be listed here." />}
          </Panel>
        </TabPanel>

        <TabPanel value="invoices">
          <Panel>
            {inv.data && inv.data.length > 0 ? (
              <table className="w-full text-sm"><thead className="border-b"><tr>{['Invoice', 'Month', 'Minutes', 'Tax', 'Total', ''].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
                <tbody>{inv.data.map((i) => <tr key={i.number} className="border-b last:border-0 hover:bg-muted/30"><td className="px-5 py-3.5 font-medium">{i.number}</td><td className="px-5 py-3.5 text-soft">{i.period}</td><td className="num px-5 py-3.5">{i.minutes}</td><td className="num px-5 py-3.5 text-soft">{fmt(i.tax, s.currency)}</td><td className="num px-5 py-3.5 font-semibold">{fmt(i.total, s.currency)}</td>
                  <td className="px-5 py-3.5 text-right"><Button size="sm" onClick={() => pdf(i.number)}><Download size={14} />PDF</Button></td></tr>)}</tbody></table>
            ) : <Empty icon={ReceiptText} text="Your first invoice appears after your first full month of calls." />}
          </Panel>
        </TabPanel>

        <TabPanel value="limits">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel className="p-5 sm:p-6">
              <h3 className="text-[15px] font-semibold">Monthly spending limit</h3>
              <p className="mt-1 text-[13px] text-soft">Calls pause when you reach this each month. You get a warning at 80%.</p>
              <div className="mt-4 flex gap-2.5">
                <div className="relative flex-1"><span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-soft">₹</span>
                  <Input type="number" min={0} placeholder="No limit" value={limit} onChange={(e) => setLimit(e.target.value)} aria-label="Monthly spending limit" className="num h-10 pl-8" /></div>
                <Button variant="primary" onClick={() => (limit ? save({ spend_limit: Number(limit) }) : save({ clear_spend_limit: true }))}>Save</Button></div>
              {s.spend_limit ? <div className="mt-5"><div className="h-2 overflow-hidden rounded-full bg-muted"><div className={cn('h-full rounded-full transition-all duration-700', limitPct >= 80 ? 'bg-warn' : 'bg-accent')} style={{ width: `${limitPct}%` }} /></div>
                <div className="num mt-1.5 flex justify-between text-xs text-soft"><span>{fmt(s.month_usage_value, s.currency)} of {fmt(s.spend_limit, s.currency, 0)} used this month</span><span>{limitPct}%</span></div></div> : null}
            </Panel>
            <Panel className="p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div><h3 className="text-[15px] font-semibold">Auto top-up</h3><p className="mt-1 text-[13px] leading-relaxed text-soft">When your balance drops below your reminder level, we email you a one-tap payment link for your top-up amount.</p></div>
                <Switch checked={s.settings.auto_topup_enabled} onChange={(v) => save({ auto_topup_enabled: v })} label="Auto top-up" />
              </div>
            </Panel>
          </div>
        </TabPanel>

        <TabPanel value="details">
          <Panel className="max-w-2xl p-5 sm:p-6">
            <h3 className="text-[15px] font-semibold">Invoice details</h3>
            <p className="mt-1 text-[13px] text-soft">Printed on your GST tax invoices.</p>
            <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
              <Field label="Business name"><Input value={prof.billing_name} onChange={(e) => setProf({ ...prof, billing_name: e.target.value })} /></Field>
              <Field label="GSTIN"><Input className="num uppercase" value={prof.billing_gstin} onChange={(e) => setProf({ ...prof, billing_gstin: e.target.value.toUpperCase() })} /></Field>
              <Field label="State code (e.g. 29)"><Input className="num" value={prof.billing_state} maxLength={2} onChange={(e) => setProf({ ...prof, billing_state: e.target.value })} /></Field>
              <Field label="Address"><Input value={prof.billing_address} onChange={(e) => setProf({ ...prof, billing_address: e.target.value })} /></Field>
            </div>
            <Button variant="primary" className="mt-5" onClick={() => save(prof)}>Save details</Button>
          </Panel>
        </TabPanel>
      </Tabs>
      <p className="mt-8 flex items-center gap-1.5 text-xs text-soft"><ArrowUpRight size={12} />Questions about a charge? Write to us from the Help page.</p>
    </>
  )
}
