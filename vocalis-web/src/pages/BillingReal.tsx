import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, ArrowUpRight, Building2, Check, CheckCircle2, Clock, Download, Gauge, Lock, Phone, ReceiptText, ShieldCheck, Sparkles, TrendingDown, Wallet, Zap } from 'lucide-react'
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
const HERO_BG = 'radial-gradient(900px 380px at 0% -10%, rgba(52,211,153,.34), transparent 60%), radial-gradient(700px 420px at 105% 115%, rgba(20,184,166,.40), transparent 55%), linear-gradient(135deg, #042f2a 0%, #0a4a40 46%, #0b5c4c 100%)'

/** A page card: a touch of depth, a hairline highlight, a soft top wash. */
function Panel({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <Card className={cn('relative overflow-hidden rounded-2xl border-line/70 bg-gradient-to-b from-surface to-surface/80 ring-1 ring-inset ring-white/[0.04]', className)} {...p}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
      {children}
    </Card>
  )
}

function IconTile({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent/25 to-accent/5 text-accent ring-1 ring-inset ring-accent/25', className)}><Icon size={17} /></span>
}

function SectionHead({ icon, title, hint, right }: { icon: LucideIcon; title: string; hint?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-3"><IconTile icon={icon} /><div><h3 className="text-[15px] font-semibold leading-tight">{title}</h3>{hint && <p className="mt-0.5 text-[13px] text-soft">{hint}</p>}</div></div>
      {right}
    </div>
  )
}

/** Big money with a quiet currency symbol and quiet paise. */
function Money({ value, currency, className }: { value: number; currency: string; className?: string }) {
  const parts = new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).formatToParts(value)
  return (
    <span className={cn('num inline-flex items-baseline', className)}>
      {parts.map((p, i) => p.type === 'currency'
        ? <span key={i} className="mr-1 text-[.62em] font-medium opacity-60">{p.value}</span>
        : p.type === 'decimal' || p.type === 'fraction'
          ? <span key={i} className="text-[.55em] font-medium opacity-60">{p.value}</span>
          : <span key={i}>{p.value}</span>)}
    </span>
  )
}

function Stat({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <Panel className="card-lift p-5">
      <div className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-accent/10 blur-2xl" />
      <div className="relative flex items-center gap-2.5 text-[13px] font-medium text-soft"><IconTile icon={Icon} className="h-8 w-8 rounded-lg" />{label}</div>
      <div className="num relative mt-4 text-[26px] font-semibold leading-none tracking-tight">{value}</div>
      {hint && <div className="relative mt-2 text-xs text-soft">{hint}</div>}
    </Panel>
  )
}

function Empty({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-6 pb-9 pt-5 text-center">
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

  return (
    <>
      <PageHeader title="Billing & Usage" subtitle="Your balance, what you spent, and your invoices." />
      {s.limit_state !== 'ok' && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl border border-warn/40 bg-gradient-to-r from-warn/15 via-warn/[0.07] to-transparent p-4 text-sm text-warn" role="alert">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-warn/15 ring-1 ring-inset ring-warn/30"><AlertTriangle size={17} /></span>
          <span className="font-medium">{s.limit_state === 'limit' ? "You've reached your monthly spending limit, so new calls are paused. Raise the limit to carry on." : "You've used over 80% of your monthly spending limit."}</span>
        </div>)}

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        {/* ---------- wallet ---------- */}
        <div className="relative isolate flex flex-col overflow-hidden rounded-[22px] p-6 text-white shadow-[0_30px_60px_-28px_rgba(4,47,42,.85)] ring-1 ring-inset ring-white/10 sm:p-8" style={{ backgroundImage: HERO_BG }}>
          <div className="pointer-events-none absolute inset-0 -z-10 opacity-70 [mask-image:linear-gradient(to_bottom,black,transparent_80%)]" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.10) 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
          <div className="pointer-events-none absolute -right-20 -top-24 -z-10 h-72 w-72 rounded-full bg-emerald-300/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-28 -left-16 -z-10 h-64 w-64 rounded-full bg-teal-300/15 blur-3xl" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />

          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5 text-sm font-medium text-white/75"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 ring-1 ring-inset ring-white/20 backdrop-blur"><Wallet size={17} /></span>Available balance</div>
            <span className="num inline-flex items-center gap-1.5 rounded-full bg-black/20 px-3 py-1 text-[12px] font-medium text-white/85 ring-1 ring-inset ring-white/15 backdrop-blur"><Sparkles size={12} className="text-emerald-300" />{fmt(s.price_per_min, s.currency)} / min</span>
          </div>

          <div className="mt-5"><Money value={s.balance} currency={s.currency} className="text-[44px] font-semibold leading-none tracking-tight sm:text-[56px]" /></div>
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[13px] text-white/85 ring-1 ring-inset ring-white/15 backdrop-blur">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300/70" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" /></span>
            {s.minutes_available > 0 ? `${Math.floor(s.minutes_available).toLocaleString('en-IN')} minutes left to use` : s.low_balance ? 'Running low. Add money to keep taking calls.' : 'About ' + Math.floor(s.balance / s.price_per_min) + ' minutes of calls'}
          </div>

          <div className="min-h-6 flex-1" />
          <div className="rounded-2xl bg-black/20 p-4 ring-1 ring-inset ring-white/10 backdrop-blur-sm">
            <div className="flex items-center justify-between text-[12px] font-medium text-white/70">
              <span className="inline-flex items-center gap-1.5"><TrendingDown size={13} className="text-emerald-300" />{nxt ? 'Next price drop' : 'Best self-serve price'}</span>
              <span className="num">{nxt ? `${fmt(cur.rate, s.currency)} → ${fmt(nxt.rate, s.currency)} / min` : `${fmt(cur.rate, s.currency)} / min`}</span>
            </div>
            <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-300 to-teal-200 shadow-[0_0_14px_rgba(110,231,183,.7)] transition-all duration-700" style={{ width: `${Math.max(4, Math.round(climb * 100))}%` }} />
            </div>
            <p className="mt-2 text-[13px] text-white/80">{nxt ? <>Add <b className="num text-white">{fmt(toNext, s.currency)}</b> more to unlock <b className="num text-white">{fmt(nxt.rate, s.currency)}</b> per minute.</> : "You're on our lowest self-serve price. Need more? Talk to us for enterprise pricing."}</p>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">{PRESETS.map((p) => (
            <button key={p} onClick={() => setAmount(String(p))} className={cn('rounded-full px-4 py-1.5 text-sm font-medium transition active:scale-95', amt === p ? 'bg-white text-emerald-900 shadow-lg shadow-black/25' : 'bg-white/10 text-white/90 ring-1 ring-inset ring-white/15 hover:bg-white/20')}>{fmt(p, s.currency, 0)}</button>))}</div>
          <div className="mt-4 flex max-w-md gap-2.5">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-lg font-medium text-white/60">₹</span>
              <Input type="number" min={100} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount to add" className="num h-12 rounded-xl border-white/20 bg-white/10 pl-8 text-lg font-medium text-white shadow-none backdrop-blur placeholder:text-white/40 hover:border-white/40 focus-visible:border-white/60 focus-visible:ring-white/15" />
            </div>
            <Button className="h-12 rounded-xl border-transparent bg-white px-6 text-[15px] font-semibold text-emerald-900 shadow-[0_12px_30px_-10px_rgba(255,255,255,.55)] hover:bg-white/90" disabled={!canPay || amt < 100} onClick={pay}>Add money</Button>
          </div>
          {amt >= 100 && (
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-white/75">
              <span>Your wallet will hold about <b className="num text-white">{afterMin.toLocaleString('en-IN')} minutes</b> at <b className="num text-white">{fmt(afterRow.rate, s.currency)}</b> / min</span>
              {unlocks && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-300/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-200 ring-1 ring-inset ring-emerald-300/30"><Zap size={10} />Price drops from {fmt(cur.rate, s.currency)}</span>}
            </div>)}
          {!s.payments_enabled && <div className="mt-3 text-xs text-white/70">Online payments are being switched on. They will appear here shortly.</div>}
          {s.payments_enabled && <div className="mt-4 flex items-center gap-1.5 text-xs text-white/55"><ShieldCheck size={13} />Secure payment by card, UPI or net banking. GST invoice for every top-up.</div>}
        </div>

        {/* ---------- price ---------- */}
        <Panel className="p-5 sm:p-6">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-accent/[0.08] to-transparent" />
          <div className="relative">
            <div className="flex items-center justify-between"><h3 className="text-[15px] font-semibold">What you pay now</h3>
              <Badge tone="accent" className="gap-1"><Sparkles size={11} />Slab {curIdx + 1} of {rows.length}</Badge></div>
            <div className="num mt-3 flex items-baseline gap-1.5"><span className="gradient-text text-[44px] font-bold leading-none tracking-tight">{fmt(s.price_per_min, s.currency)}</span><span className="text-sm font-medium text-soft">/ minute</span></div>
            <p className="mt-2 text-[13px] text-soft">One price, nothing hidden. The more minutes your wallet holds, the lower it gets. It includes:</p>
            <ul className="mt-3 grid gap-2 text-sm">{['The AI that talks and thinks', 'The voice and speech recognition', 'The phone line for the call', 'Recordings, transcripts and analytics'].map((x) => <li key={x} className="flex items-center gap-2.5"><span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-ok/15 text-ok"><CheckCircle2 size={13} /></span>{x}</li>)}</ul>
            <div className="mt-5"><Ladder rows={rows} curIdx={curIdx} currency={s.currency} /></div>
            <p className="mt-2.5 px-1 text-[12px] text-soft">More than {s.contact_sales_above.toLocaleString('en-IN')} minutes in your wallet? Talk to us for enterprise pricing.</p>
            {nxt && <div className="mt-3 flex items-start gap-2 rounded-xl bg-accent/10 px-3 py-2.5 text-[13px] text-accent ring-1 ring-inset ring-accent/20"><TrendingDown size={15} className="mt-0.5 shrink-0" /><span>Add <b className="num">{fmt(toNext, s.currency)}</b> to your wallet and the price drops to <b className="num">{fmt(nxt.rate, s.currency)}</b>.</span></div>}
            <p className="mt-4 text-xs leading-relaxed text-soft">Billed per minute, rounded up: a 61 second call is 2 minutes, and a call that never connects is free. Practice calls from the Talk button are charged at the same price. Monthly phone number rent is billed separately.</p>
          </div>
        </Panel>
      </div>

      {/* ---------- stats ---------- */}
      <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={ReceiptText} label="Spent this month" value={fmt(s.month_usage_value, s.currency)} hint={s.spend_limit ? `${limitPct}% of your ${fmt(s.spend_limit, s.currency, 0)} limit` : 'No monthly limit set'} />
        <Stat icon={Clock} label="Minutes this month" value={s.month_minutes} hint="Calls answered or made" />
        <Stat icon={Sparkles} label="Average per call minute" value={s.month_minutes ? fmt(s.month_usage_value / s.month_minutes, s.currency) : '—'} hint="Matches your price when everything is included" />
        <Stat icon={Phone} label={`Last ${days} days`} value={fmt(totalVal, s.currency)} hint={`${Math.round(totalMin * 10) / 10} minutes`} />
      </div>

      {/* ---------- spend ---------- */}
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Panel className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="text-[15px] font-semibold">Spend over time</h3><p className="num mt-0.5 text-[13px] text-soft">{fmt(totalVal, s.currency)} across {Math.round(totalMin * 10) / 10} minutes</p></div>
            <div className="flex gap-1 rounded-full bg-muted/70 p-1 text-xs font-semibold ring-1 ring-inset ring-line/60">{[7, 30, 90].map((d) => <button key={d} onClick={() => setDays(d)} className={cn('rounded-full px-3 py-1 transition', days === d ? 'bg-surface text-ink shadow-card ring-1 ring-inset ring-line/70' : 'text-soft hover:text-ink')}>{d}d</button>)}</div></div>
          {u && u.by_day.length > 0 ? (
            <div className="mt-5 h-64"><ResponsiveContainer><AreaChart data={u.by_day} margin={{ top: 6, right: 4, left: -8, bottom: 0 }}><defs><linearGradient id="spend" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.4} /><stop offset="70%" stopColor="hsl(var(--accent))" stopOpacity={0.06} /><stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid vertical={false} strokeDasharray="3 5" strokeOpacity={0.16} /><XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} fontSize={11} tickLine={false} axisLine={false} tickMargin={8} /><YAxis fontSize={11} width={48} tickLine={false} axisLine={false} />
              <RTooltip cursor={{ stroke: 'hsl(var(--accent))', strokeOpacity: 0.3, strokeDasharray: '4 4' }} content={<SpendTip currency={s.currency} />} /><Area dataKey="value" name="Spend" type="monotone" stroke="hsl(var(--accent))" strokeWidth={2.5} fill="url(#spend)" activeDot={{ r: 5, strokeWidth: 3, stroke: 'hsl(var(--surface))', fill: 'hsl(var(--accent))' }} /></AreaChart></ResponsiveContainer></div>
          ) : <Empty icon={Gauge} text="No calls in this period yet. Spending will show up here." />}
        </Panel>
        <Panel className="p-5 sm:p-6">
          <h3 className="text-[15px] font-semibold">By agent</h3>
          {u && u.by_agent.length > 0 ? <div className="mt-5 space-y-5">{u.by_agent.map((a, i) => { const pct = totalVal ? Math.round((a.value / totalVal) * 100) : 0
            return <div key={a.name}>
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent/25 to-accent/5 text-[12px] font-bold text-accent ring-1 ring-inset ring-accent/25">{i + 1}</span>
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{a.name}</div><div className="num text-xs text-soft">{a.minutes} min</div></div>
                <div className="text-right"><div className="num text-sm font-semibold">{fmt(a.value, s.currency)}</div><div className="num text-xs text-soft">{pct}%</div></div>
              </div>
              <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-gradient-to-r from-accent/70 to-accent shadow-glow transition-all duration-700" style={{ width: `${Math.max(pct, 3)}%` }} /></div></div> })}</div>
            : <Empty icon={Sparkles} text="Nothing yet. Your busiest agents will rank here." />}
        </Panel>
      </div>

      {/* ---------- limit + invoice details ---------- */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel className="p-5 sm:p-6">
          <SectionHead icon={Gauge} title="Spending limit" hint="Calls pause when you reach this each month. You get a warning at 80%." />
          <div className="mt-4 flex gap-2.5">
            <div className="relative flex-1"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-soft">₹</span>
              <Input type="number" min={0} placeholder="No limit" value={limit} onChange={(e) => setLimit(e.target.value)} aria-label="Monthly spending limit" className="num h-10 rounded-xl pl-7" /></div>
            <Button variant="primary" className="h-10 rounded-xl px-5" onClick={() => (limit ? save({ spend_limit: Number(limit) }) : save({ clear_spend_limit: true }))}>Save</Button></div>
          {s.spend_limit ? <div className="mt-5"><div className="relative h-2.5 overflow-hidden rounded-full bg-muted"><div className={cn('h-full rounded-full transition-all duration-700', limitPct >= 80 ? 'bg-gradient-to-r from-warn/80 to-warn' : 'bg-gradient-to-r from-accent/70 to-accent')} style={{ width: `${limitPct}%` }} /><span className="absolute inset-y-0 left-[80%] w-px bg-ink/25" /></div>
            <div className="num mt-1.5 flex justify-between text-xs text-soft"><span>{fmt(s.month_usage_value, s.currency)} of {fmt(s.spend_limit, s.currency, 0)} used this month</span><span>{limitPct}%</span></div></div> : null}
          <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-line/70 bg-muted/30 p-4">
            <div className="flex items-start gap-3"><IconTile icon={Zap} className="h-8 w-8 rounded-lg" /><div><div className="text-sm font-medium">Auto top-up</div><div className="mt-0.5 text-xs leading-relaxed text-soft">When your balance drops below your reminder level, we email you a one-tap payment link for your top-up amount (at most once a day). Nothing is charged until you pay.</div></div></div>
            <Switch checked={s.settings.auto_topup_enabled} onChange={(v) => save({ auto_topup_enabled: v })} label="Auto top-up" /></div>
        </Panel>
        <Panel className="p-5 sm:p-6">
          <SectionHead icon={Building2} title="Invoice details" hint="Printed on your GST tax invoices." />
          <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
            <Field label="Business name"><Input className="h-10 rounded-xl" value={prof.billing_name} onChange={(e) => setProf({ ...prof, billing_name: e.target.value })} /></Field>
            <Field label="GSTIN"><Input className="num h-10 rounded-xl uppercase" value={prof.billing_gstin} onChange={(e) => setProf({ ...prof, billing_gstin: e.target.value.toUpperCase() })} /></Field>
            <Field label="State code (e.g. 29)"><Input className="num h-10 rounded-xl" value={prof.billing_state} maxLength={2} onChange={(e) => setProf({ ...prof, billing_state: e.target.value })} /></Field>
            <Field label="Address"><Input className="h-10 rounded-xl" value={prof.billing_address} onChange={(e) => setProf({ ...prof, billing_address: e.target.value })} /></Field>
          </div>
          <Button variant="primary" className="mt-5 h-10 rounded-xl px-5" onClick={() => save(prof)}>Save details</Button>
        </Panel>
      </div>

      {/* ---------- payments + invoices ---------- */}
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Panel>
          <div className="p-5 pb-3 sm:px-6"><SectionHead icon={Wallet} title="Payments" /></div>
          {pays.data && pays.data.length > 0 ? (
            <table className="w-full text-sm"><thead className="border-y border-line/70 bg-muted/30 text-left text-[11px] uppercase tracking-wider text-soft"><tr>{['Date', 'Reference', 'Amount', 'Status'].map((h) => <th key={h} className="px-5 py-2.5 font-semibold first:sm:pl-6">{h}</th>)}</tr></thead>
              <tbody>{pays.data.map((p) => <tr key={p.order_id} className="border-b border-line/50 transition-colors last:border-0 hover:bg-muted/30"><td className="px-5 py-3.5 first:sm:pl-6">{p.at ? new Date(p.at).toLocaleDateString() : '—'}</td><td className="px-5 py-3.5 font-mono text-xs text-soft">{p.order_id.slice(-10)}</td>
                <td className="num px-5 py-3.5 font-semibold">{fmt(p.amount, p.currency)}</td><td className="px-5 py-3.5"><Badge tone={statusTone(p.status)}><span className="h-1.5 w-1.5 rounded-full bg-current" />{statusLabel(p.status)}</Badge></td></tr>)}</tbody></table>
          ) : <Empty icon={Wallet} text="Money you add will be listed here." />}
        </Panel>
        <Panel>
          <div className="p-5 pb-3 sm:px-6"><SectionHead icon={ReceiptText} title="Invoices" /></div>
          {inv.data && inv.data.length > 0 ? (
            <table className="w-full text-sm"><thead className="border-y border-line/70 bg-muted/30 text-left text-[11px] uppercase tracking-wider text-soft"><tr>{['Invoice', 'Month', 'Minutes', 'Tax', 'Total', ''].map((h) => <th key={h} className="px-4 py-2.5 font-semibold first:sm:pl-6">{h}</th>)}</tr></thead>
              <tbody>{inv.data.map((i) => <tr key={i.number} className="border-b border-line/50 transition-colors last:border-0 hover:bg-muted/30"><td className="px-4 py-3.5 font-medium first:sm:pl-6">{i.number}</td><td className="px-4 py-3.5 text-soft">{i.period}</td><td className="num px-4 py-3.5">{i.minutes}</td><td className="num px-4 py-3.5 text-soft">{fmt(i.tax, i.currency)}</td><td className="num px-4 py-3.5 font-semibold">{fmt(i.total, i.currency)}</td>
                <td className="px-4 py-3.5 text-right"><Button size="sm" className="rounded-lg" onClick={() => pdf(i.number)}><Download size={14} />PDF</Button></td></tr>)}</tbody></table>
          ) : <Empty icon={ReceiptText} text="Your first invoice appears after your first full month of calls." />}
        </Panel>
      </div>
      <p className="mt-6 flex items-center gap-1.5 text-xs text-soft"><ArrowUpRight size={12} />Questions about a charge? Write to us from the Help page.</p>
    </>
  )
}
