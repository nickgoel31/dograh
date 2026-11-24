import * as React from 'react'
import { toast } from 'sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Card, Dialog, Field, Input, Select } from '@/components/ui'
import { EmptyState, PageHeader, StatCard, TableSkeleton } from '@/components/shared'
import { Plus } from '@/components/icons'
import { http } from '@/lib/api/http'
import { useMe } from '@/lib/useMe'
import { useUI } from '@/store/ui'
import { subApi, type SubAccount } from '@/lib/api/subaccounts'
import { money } from '@/lib/utils'

const say = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
const num = (s: string) => (s.trim() === '' ? null : Number(s))
const pct = (used: number, cap: number | null) => (cap ? Math.min(100, Math.round((used / cap) * 100)) : null)

function Meter({ label, used, cap, fmt }: { label: string; used: number; cap: number | null; fmt: (n: number) => string }) {
  const p = pct(used, cap)
  return (
    <div>
      <div className="flex justify-between text-xs text-soft"><span>{label}</span><span>{fmt(used)}{cap ? ` of ${fmt(cap)}` : ' · no limit'}</span></div>
      {p != null && <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className={p >= 100 ? 'h-full bg-bad' : p >= 80 ? 'h-full bg-amber-500' : 'h-full bg-accent'} style={{ width: `${p}%` }} /></div>}
    </div>
  )
}

function Editor({ s, onClose, onSaved }: { s: SubAccount | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = React.useState(s?.name ?? '')
  const [billing, setBilling] = React.useState<'shared' | 'own'>(s?.billing ?? 'shared')
  const [capValue, setCapValue] = React.useState(s?.cap_value != null ? String(s.cap_value) : '')
  const [capMinutes, setCapMinutes] = React.useState(s?.cap_minutes != null ? String(s.cap_minutes) : '')
  const [conc, setConc] = React.useState(s?.max_concurrent != null ? String(s.max_concurrent) : '')
  const [busy, setBusy] = React.useState(false)
  const save = async () => {
    if (!name.trim()) return toast.error('Give the sub-account a name.')
    setBusy(true)
    try {
      const cv = num(capValue), cm = num(capMinutes), mc = num(conc)
      if (!s) await subApi.create({ name: name.trim(), billing, cap_value: cv, cap_minutes: cm, max_concurrent: mc })
      else await subApi.change(s.id, { name: name.trim(), billing, ...(cv != null ? { cap_value: cv } : { clear_cap_value: true }), ...(cm != null ? { cap_minutes: cm } : { clear_cap_minutes: true }), ...(mc != null ? { max_concurrent: mc } : { clear_max_concurrent: true }) })
      toast.success(s ? 'Saved' : 'Sub-account created'); onSaved(); onClose()
    } catch (e) { say(e) } finally { setBusy(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={s ? 'Edit sub-account' : 'New sub-account'} description="Its own agents, numbers, voices and team. You control its billing and limits.">
      <div className="space-y-4">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Pune branch" autoFocus /></Field>
        <Field label="Who pays for its calls">
          <Select value={billing} onChange={(e) => setBilling(e.target.value as 'shared' | 'own')}>
            <option value="shared">My wallet (shared). It has no wallet of its own.</option>
            <option value="own">Its own wallet. It tops up for itself.</option>
          </Select>
        </Field>
        {billing === 'shared' && <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Monthly spending limit"><Input type="number" min={0} value={capValue} onChange={(e) => setCapValue(e.target.value)} placeholder="No limit" /></Field>
          <Field label="Monthly minutes limit"><Input type="number" min={0} value={capMinutes} onChange={(e) => setCapMinutes(e.target.value)} placeholder="No limit" /></Field>
        </div>}
        <Field label="Most calls at the same time"><Input type="number" min={1} value={conc} onChange={(e) => setConc(e.target.value)} placeholder="No limit" /></Field>
        <p className="text-xs text-soft">{billing === 'shared' ? 'When a limit is reached, new calls are refused until next month or until you raise it. You get an alert at 80% and at 100%.' : 'It gets its own welcome minutes and prices, like any account.'}</p>
        <Button variant="primary" className="w-full" disabled={busy} onClick={save}>{busy ? 'Saving…' : s ? 'Save' : 'Create sub-account'}</Button>
      </div>
    </Dialog>
  )
}

export function SubAccountsPage() {
  const qc = useQueryClient()
  const me = useMe().data
  const setUI = useUI((x) => x.set)
  const list = useQuery({ queryKey: ['subaccounts'], queryFn: subApi.list })
  const usage = useQuery({ queryKey: ['subaccounts-usage'], queryFn: () => subApi.usage() })
  const [edit, setEdit] = React.useState<SubAccount | 'new' | null>(null)
  const refresh = () => { qc.invalidateQueries({ queryKey: ['subaccounts'] }); qc.invalidateQueries({ queryKey: ['subaccounts-usage'] }); qc.invalidateQueries({ queryKey: ['me'] }) }
  const isChild = !!me?.current_workspace.sub_account
  const toggle = async (s: SubAccount) => { try { await (s.suspended ? subApi.resume(s.id) : subApi.pause(s.id)); refresh() } catch (e) { say(e) } }
  const open = (s: SubAccount) => { setUI({ workspaceId: s.id }); window.location.assign('/') }
  const csv = async () => {
    try { const blob = await http<Blob>(subApi.csvUrl(), { blob: true }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `sub-accounts-${usage.data?.period ?? 'usage'}.csv`; a.click(); URL.revokeObjectURL(a.href) } catch (e) { say(e) }
  }
  const u = usage.data
  return (
    <>
      <PageHeader title="Sub-accounts" subtitle="Separate workspaces for your branches, brands or clients. They share your wallet, and you set their limits." actions={<div className="flex gap-2"><Button variant="secondary" onClick={csv} disabled={!list.data?.length}>Download usage (CSV)</Button><Button variant="primary" onClick={() => setEdit('new')}><Plus size={15} />New sub-account</Button></div>} />
      {isChild && <div className="mb-4 rounded-xl border p-3 text-[13px] text-soft">You are inside a sub-account. Switch to the main account to manage sub-accounts.</div>}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Sub-accounts" value={list.data?.length ?? 0} loading={list.isPending} />
        <StatCard label="Calls this month" value={u?.total_calls ?? 0} loading={usage.isPending} />
        <StatCard label="Minutes this month" value={u?.total_minutes ?? 0} loading={usage.isPending} />
        <StatCard label="Value this month" value={money(u?.total_value ?? 0)} loading={usage.isPending} />
      </div>
      {list.isPending ? <TableSkeleton rows={3} /> : !list.data?.length ? (
        <EmptyState emoji="🏢" title="No sub-accounts yet" text="Create one for each branch, brand or client. Each gets its own agents, numbers and team, while the calls are paid from your wallet and you stay in control with monthly limits." action={<Button variant="primary" onClick={() => setEdit('new')}><Plus size={15} />New sub-account</Button>} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {list.data.map((s) => (
            <Card key={s.id} className="space-y-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><div className="truncate text-[15px] font-semibold">{s.name}</div>
                  <div className="mt-0.5 text-xs text-soft">{s.agents} agents · {s.members} people · {s.billing === 'shared' ? 'Uses your wallet' : 'Own wallet'}{s.max_concurrent ? ` · up to ${s.max_concurrent} calls at once` : ''}</div></div>
                <Badge>{s.suspended ? 'Paused' : 'Active'}</Badge>
              </div>
              <div className="space-y-2.5">
                <Meter label="Minutes this month" used={s.month_minutes} cap={s.cap_minutes} fmt={(n) => `${Math.round(n * 10) / 10} min`} />
                <Meter label="Spend this month" used={s.month_value} cap={s.cap_value} fmt={(n) => money(n)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => open(s)}>Open</Button>
                <Button size="sm" variant="secondary" onClick={() => setEdit(s)}>Limits & billing</Button>
                <Button size="sm" variant="ghost" className={s.suspended ? '' : 'text-bad'} onClick={() => toggle(s)}>{s.suspended ? 'Resume calls' : 'Pause calls'}</Button>
              </div>
            </Card>))}
        </div>)}
      {edit && <Editor s={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={refresh} />}
    </>
  )
}
