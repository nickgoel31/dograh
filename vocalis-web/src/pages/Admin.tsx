import * as React from 'react'
import { toast } from 'sonner'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Card, Dialog, Field, Input, Switch } from '@/components/ui'
import { EmptyState, PageHeader, SearchPill, StatCard, TableSkeleton } from '@/components/shared'
import { http } from '@/lib/api/http'
import { useMe } from '@/lib/useMe'

/** The owner's view of every customer. Only the platform owner account sees this; the server checks it again on every request. */
interface Overview { users: number; workspaces: number; new_workspaces_7d: number; agents: number; live_agents: number; calls_24h: number; calls_7d: number; bonus_given: number; bonus_limit: number; phone_verified: number; currency: string }
interface Row { id: string; name: string; owner: string | null; created: string | null; balance: number | null; agents: number; calls: number; phone_verified: boolean; bonus: boolean; adopted: boolean; child: boolean }
interface Detail { swarvo_tts?: boolean; id: string; name: string; created: string | null; adopted: boolean; currency: string; balance: number; minutes_available: number; month_minutes: number; month_spend: number; calls_30d: number; phone_verified: boolean; verified_phone: string | null; bonus_given: boolean; members: { email: string; role: string }[]; agents: { id: string; name: string; status: string; voice: string | null }[] }
const say = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
const money = (n: number | null | undefined, cur = 'INR') => (n == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(n))
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

export default function AdminPage() {
  const me = useMe()
  const qc = useQueryClient()
  const [q, setQ] = React.useState('')
  const [dq, setDq] = React.useState('')
  const [page, setPage] = React.useState(0)
  const [open, setOpen] = React.useState<string | null>(null)
  const [amount, setAmount] = React.useState('')
  const [note, setNote] = React.useState('')
  React.useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(0) }, 250); return () => clearTimeout(t) }, [q])
  const allowed = !!me.data?.is_admin
  const ov = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => http<Overview>('/admin/overview'), enabled: allowed })
  const list = useQuery({ queryKey: ['admin', 'ws', dq, page], queryFn: () => http<{ total: number; workspaces: Row[]; currency: string }>(`/admin/workspaces?limit=25&offset=${page * 25}${dq ? `&q=${encodeURIComponent(dq)}` : ''}`), enabled: allowed })
  const one = useQuery({ queryKey: ['admin', 'one', open], queryFn: () => http<Detail>(`/admin/workspaces/${open}`), enabled: allowed && !!open })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['admin'] }) }
  const adjust = useMutation({
    mutationFn: () => http<{ balance: number }>(`/admin/workspaces/${open}/balance`, { method: 'POST', json: { amount: Number(amount), note } }),
    onSuccess: (r) => { toast.success(`Balance is now ${money(r.balance, one.data?.currency)}`); setAmount(''); setNote(''); refresh() }, onError: say,
  })
  const swarvo = useQuery({ queryKey: ['admin', 'swarvo'], queryFn: () => http<{ everyone: boolean; workspaces: { id: string; name: string }[]; discount_percent: number }>('/admin/swarvo-tts'), enabled: allowed })
  const setEveryone = useMutation({ mutationFn: (v: boolean) => http('/admin/swarvo-tts', { method: 'PUT', json: { everyone: v } }), onSuccess: () => { toast.success('Saved'); refresh() }, onError: say })
  const setOne = useMutation({ mutationFn: (v: boolean) => http(`/admin/workspaces/${open}/swarvo-tts`, { method: 'PUT', json: { enabled: v } }), onSuccess: () => { toast.success('Saved'); refresh() }, onError: say })
  const verify = useMutation({ mutationFn: () => http(`/admin/workspaces/${open}/verify-phone`, { method: 'POST' }), onSuccess: () => { toast.success('Marked as verified'); refresh() }, onError: say })

  if (me.isLoading) return <TableSkeleton rows={4} />
  if (!allowed) return <EmptyState emoji="🔒" title="This area is only for the platform owner" text="Sign in with the owner account to see it." />
  const o = ov.data
  const rows = list.data?.workspaces ?? []
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / 25))
  const d = one.data
  return (
    <div>
      <PageHeader title="Admin" subtitle="Every customer, their balance, agents and usage." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Customers" value={o?.workspaces ?? '—'} hint={o ? `${o.new_workspaces_7d} new this week` : undefined} loading={ov.isLoading} />
        <StatCard label="Agents" value={o?.agents ?? '—'} hint={o ? `${o.live_agents} live` : undefined} loading={ov.isLoading} />
        <StatCard label="Calls" value={o?.calls_7d ?? '—'} hint={o ? `${o.calls_24h} in the last day` : undefined} loading={ov.isLoading} />
        <StatCard label="Sign-up bonus" value={o ? `${o.bonus_given} / ${o.bonus_limit}` : '—'} hint={o ? `${o.phone_verified} numbers verified` : undefined} loading={ov.isLoading} />
      </div>

      <Card className="mt-6 flex flex-wrap items-center gap-4 rounded-2xl p-5 shadow-none">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[15px] font-semibold">swarvo-tts 2.5 voices{swarvo.data && <Badge tone={swarvo.data.everyone ? 'green' : 'accent'}>{swarvo.data.everyone ? 'On for everyone' : 'Coming soon for customers'}</Badge>}</div>
          <p className="mt-1 text-[13px] text-soft">While this is off, the voices show as "Coming soon" and cannot be picked. Turn it on for everyone here, or for one customer at a time from their page below.{swarvo.data ? ` Calls spoken with them cost ${swarvo.data.discount_percent}% less.` : ''}</p>
          {swarvo.data && !swarvo.data.everyone && swarvo.data.workspaces.length > 0 && <p className="mt-2 text-[13px]">Open for: {swarvo.data.workspaces.map((w) => w.name).join(', ')}</p>}
        </div>
        <label className="flex items-center gap-2.5 text-sm font-medium">Everyone<Switch checked={!!swarvo.data?.everyone} onChange={(v) => setEveryone.mutate(v)} label="swarvo-tts for everyone" /></label>
      </Card>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-[15px] font-semibold">Customers</h2>
        <SearchPill value={q} onChange={setQ} placeholder="Search name, email or id" className="sm:max-w-xs" />
      </div>
      <Card className="mt-3 overflow-hidden p-0">
        {list.isLoading ? <TableSkeleton rows={6} /> : rows.length === 0 ? <div className="p-8 text-center text-soft">No customers match.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b text-xs text-soft"><tr><th className="px-4 py-3 font-medium">Workspace</th><th className="px-4 py-3 font-medium">Owner</th><th className="px-4 py-3 text-right font-medium">Balance</th><th className="px-4 py-3 text-right font-medium">Agents</th><th className="px-4 py-3 text-right font-medium">Calls</th><th className="px-4 py-3 font-medium">Joined</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id} onClick={() => setOpen(r.id)} className="cursor-pointer border-b last:border-0 transition hover:bg-muted">
                  <td className="px-4 py-3"><div className="font-medium">{r.name}</div><div className="mt-0.5 flex gap-1.5">{r.adopted && <Badge>Classic</Badge>}{r.child && <Badge>Sub-account</Badge>}{!r.phone_verified && !r.adopted && <Badge tone="accent">Number not verified</Badge>}</div></td>
                  <td className="px-4 py-3 text-soft">{r.owner ?? '—'}</td>
                  <td className="num px-4 py-3 text-right">{money(r.balance, list.data?.currency)}</td>
                  <td className="num px-4 py-3 text-right">{r.agents}</td>
                  <td className="num px-4 py-3 text-right">{r.calls}</td>
                  <td className="px-4 py-3 text-soft">{day(r.created)}</td>
                </tr>))}</tbody>
            </table>
          </div>)}
      </Card>
      {pages > 1 && <div className="mt-3 flex items-center justify-end gap-2 text-sm text-soft"><Button variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>Page {page + 1} of {pages}<Button variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</Button></div>}

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)} title={d?.name ?? 'Customer'} description={d ? `Joined ${day(d.created)}` : undefined} wide>
        {!d ? <TableSkeleton rows={4} /> : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[['Balance', money(d.balance, d.currency)], ['Minutes left', Math.round(d.minutes_available)], ['This month', money(d.month_spend, d.currency)], ['Calls (30 days)', d.calls_30d]].map(([l, v]) => <div key={String(l)} className="rounded-xl border p-3"><div className="text-xs text-soft">{l}</div><div className="num mt-0.5 text-[15px] font-semibold">{v}</div></div>)}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge>{d.phone_verified ? `Number verified ${d.verified_phone ?? ''}` : 'Number not verified'}</Badge>
              <Badge>{d.bonus_given ? 'Sign-up bonus given' : 'No sign-up bonus'}</Badge>
              {!d.phone_verified && !d.adopted && <Button variant="ghost" onClick={() => verify.mutate()} disabled={verify.isPending}>Mark number as verified</Button>}
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
              <div><div className="text-[13px] font-medium">swarvo-tts 2.5 voices</div><p className="text-xs text-soft">{swarvo.data?.everyone ? 'Already on for everyone.' : 'Let this customer pick them before they open up to everyone.'}</p></div>
              <Switch checked={!!d.swarvo_tts || !!swarvo.data?.everyone} onChange={(v) => setOne.mutate(v)} label="swarvo-tts for this customer" />
            </div>
            <div>
              <div className="mb-2 text-[13px] font-medium">Change balance</div>
              <div className="grid gap-2 sm:grid-cols-[140px_1fr_auto]">
                <Field label="Amount (negative removes)"><Input type="number" inputMode="decimal" placeholder="e.g. 100 or -50" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
                <Field label="Reason (saved in the log)"><Input placeholder="e.g. Goodwill credit" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} /></Field>
                <div className="flex items-end"><Button variant="primary" className="w-full sm:w-auto" disabled={!Number(amount) || note.trim().length < 3 || adjust.isPending} onClick={() => adjust.mutate()}>Apply</Button></div>
              </div>
            </div>
            <div><div className="mb-2 text-[13px] font-medium">Team</div><div className="divide-y rounded-xl border">{d.members.map((m) => <div key={m.email} className="flex justify-between px-3 py-2 text-sm"><span>{m.email}</span><span className="text-soft">{m.role}</span></div>)}</div></div>
            <div><div className="mb-2 text-[13px] font-medium">Agents ({d.agents.length})</div>{d.agents.length === 0 ? <p className="text-sm text-soft">No agents yet.</p> : <div className="divide-y rounded-xl border">{d.agents.map((a) => <div key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm"><span className="truncate font-medium">{a.name}</span><Badge>{a.status}</Badge></div>)}</div>}</div>
          </div>)}
      </Dialog>
    </div>
  )
}
