import * as React from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { flexRender, getCoreRowModel, getPaginationRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import { Download, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, Chip, Input, Select } from '@/components/ui'
import { USE_MOCKS } from '@/lib/api/env'
import { AdvancedOnly, EmptyState, PageHeader, StatusBadge, TableSkeleton, WaveformPlayer, sentimentEmoji, useAsync } from '@/components/shared'
import { api } from '@/lib/api'
import { useUI } from '@/store/ui'
import { callSearch } from '@/lib/api/calls'
import { useData } from '@/store/data'
import { download, fmtDur, money, cn } from '@/lib/utils'
import type { Call } from '@/mock/types'

const outcomes = ['booked', 'resolved', 'qualified', 'transferred', 'voicemail', 'failed', 'no-answer']

export default function ConversationsPage() {
  const practice = new URLSearchParams(window.location.search).get('practice') === '1'
  const agents = useData((s) => s.agents)
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const [said, setSaid] = React.useState('')
  const [saidNow, setSaidNow] = React.useState('')
  React.useEffect(() => { const t = setTimeout(() => setSaidNow(said), 400); return () => clearTimeout(t) }, [said])
  const { data, loading } = useAsync(() => { callSearch.text = saidNow; return api.calls(practice ? 'test' : 'live') }, [practice, saidNow])
  const [q, setQ] = React.useState('')
  const [agent, setAgent] = React.useState('')
  const [outcome, setOutcome] = React.useState('')
  const [days, setDays] = React.useState('30')
  const failedOnly = sp.get('failed') === '1'
  const rows = React.useMemo(() => (data ?? []).filter((c) =>
    (!q || (c.caller + c.phone).toLowerCase().includes(q.toLowerCase())) && (!agent || c.agentId === agent) && (!outcome || c.outcome === outcome) &&
    (!failedOnly || c.outcome === 'failed') && Date.now() - new Date(c.time).getTime() < +days * 864e5), [data, q, agent, outcome, failedOnly, days])
  const aName = (id: string) => agents.find((a) => a.id === id)?.name.split(' — ')[0] ?? id

  const columns = React.useMemo<ColumnDef<Call>[]>(() => [
    { header: 'Time', accessorFn: (c) => new Date(c.time).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) },
    { header: 'Caller', cell: ({ row }) => <div><div className="font-medium">{row.original.caller}</div><div className="num text-xs text-soft">{row.original.phone}</div></div> },
    { header: 'Agent', accessorFn: (c) => aName(c.agentId) },
    { header: 'Length', cell: ({ row }) => <span className="num">{fmtDur(row.original.duration)}</span> },
    { header: 'Result', cell: ({ row }) => <StatusBadge status={row.original.outcome} /> },
    { header: 'Mood', cell: ({ row }) => <span className="text-lg" title="How the caller felt">{row.original.sentiment ? sentimentEmoji[row.original.sentiment] : '—'}</span> },
    { header: 'Cost', cell: ({ row }) => <span className="num">{money(row.original.cost, 2)}</span> },
  ], [agents])
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel(), getPaginationRowModel: getPaginationRowModel(), initialState: { pagination: { pageSize: 10 } } })

  const exportCsv = () => { download('calls.csv', 'time,caller,phone,agent,seconds,outcome,cost\n' + rows.map((c) => [c.time, c.caller, c.phone, aName(c.agentId), c.duration, c.outcome, c.cost].join(',')).join('\n')); toast.success('Your file is downloading (demo)') }
  return (
    <>
      <PageHeader title="Conversations" subtitle="Every call your agents have had. Click one to listen and read." actions={<Button onClick={exportCsv}><Download size={15} />Export CSV</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-[240px]"><Search size={15} className="absolute left-3 top-2.5 text-soft" /><Input className="pl-9" placeholder="Search name or number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search calls" /></div>
        <Select className="w-auto" value={days} onChange={(e) => setDays(e.target.value)} aria-label="Date"><option value="1">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></Select>
        <Select className="w-auto" value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Agent"><option value="">All agents</option>{agents.slice(0, 3).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        <Select className="w-auto" value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Result"><option value="">Any result</option>{outcomes.map((o) => <option key={o}>{o}</option>)}</Select>
        <Input className="w-56" placeholder="Search what was said" aria-label="Search what was said" value={said} onChange={(e) => setSaid(e.target.value)} />
        <Chip active={failedOnly} onClick={() => setSp(failedOnly ? {} : { failed: '1' })}>Failed only</Chip>
        <Chip active={practice} onClick={() => setSp(practice ? {} : { practice: '1' })}>Practice calls</Chip>
      </div>
      <Card className="overflow-hidden">
        {loading ? <TableSkeleton /> : rows.length === 0 ? <div className="p-6"><EmptyState emoji="📭" title="No calls match" text="Try clearing a filter to see more calls." action={<Button variant="primary" size="lg" onClick={() => { setQ(''); setAgent(''); setOutcome(''); setSp({}) }}>Clear filters</Button>} /></div> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-soft">{table.getHeaderGroups().map((g) => <tr key={g.id}>{g.headers.map((h) => <th key={h.id} className="px-4 py-3 font-medium">{flexRender(h.column.columnDef.header, h.getContext())}</th>)}</tr>)}</thead>
            <tbody>{table.getRowModel().rows.map((r) => <tr key={r.id} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && nav('/conversations/' + r.original.id)} onClick={() => nav('/conversations/' + r.original.id)} className="cursor-pointer border-b last:border-0 hover:bg-muted/50">{r.getVisibleCells().map((c) => <td key={c.id} className="px-4 py-3">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}</tr>)}</tbody></table></div>)}
        {!loading && rows.length > 0 && <div className="flex items-center justify-between border-t p-3 text-sm text-soft"><span>{rows.length} calls</span><div className="flex items-center gap-2"><Button size="sm" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>Back</Button><span>Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}</span><Button size="sm" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>Next</Button></div></div>}
      </Card>
    </>
  )
}

export function CallDetail() {
  const { id } = useParams()
  const { data: call, loading } = useAsync(() => api.call(id!), [id])
  const [t, setT] = React.useState(0)
  const [playing, setPlaying] = React.useState(false)
  React.useEffect(() => {
    if (!playing || !call) return
    const i = setInterval(() => setT((x) => { if (x >= call.duration) { setPlaying(false); return 0 } return x + 0.25 }), 250)
    return () => clearInterval(i)
  }, [playing, call])
  const active = call?.turns.filter((x) => x.t <= t).pop()
  const lineRef = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => { lineRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [active])
  if (loading) return <TableSkeleton rows={6} />
  if (!call) return <EmptyState emoji="🔍" title="Call not found" text="It may be older than your history limit." action={<Link to="/conversations"><Button variant="primary" size="lg">Back to calls</Button></Link>} />
  const colors = ['#6356f1', '#0ea5e9', '#f59e0b', '#10b981']
  return (
    <>
      <PageHeader title={call.caller} subtitle={`${call.phone} · ${new Date(call.time).toLocaleString('en-IN')}`} actions={<><StatusBadge status={call.outcome} /><Button onClick={() => toast.success('Replaying with the fixed prompt…')}>Replay with a fixed prompt</Button><Button onClick={() => toast('Thanks! We’ll look into that answer.')}>Report a bad answer</Button></>} />
      {call.failReason && <Card className="mb-4 border-warn/40 bg-warn/10 p-4 text-warn">⚠️ {call.failReason}</Card>}
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <Card className="p-6">
            {USE_MOCKS ? (
              <WaveformPlayer duration={call.duration} time={t} playing={playing} onToggle={() => setPlaying(!playing)} onSeek={(x) => setT(Math.max(0, Math.min(call.duration, x)))} segments={call.turns} seed={+call.id.slice(1)} />
            ) : call.audioUrl ? (
              <audio controls preload="none" src={call.audioUrl} className="w-full" aria-label="Call recording" />
            ) : (
              <p className="text-sm text-soft">There's no recording for this call.</p>
            )}
            {USE_MOCKS && <div className="num mt-2 text-right text-xs text-soft">{fmtDur(t)} / {fmtDur(call.duration)}</div>}
            <div className="mt-4 max-h-[320px] space-y-2 overflow-y-auto" aria-label="Transcript">
              {call.turns.map((x, i) => <button key={i} ref={x === active ? lineRef : undefined} onClick={() => setT(x.t)} className={cn('flex w-full gap-3 rounded-lg p-2.5 text-left text-sm transition hover:bg-muted', x === active && 'bg-accent-soft')}>
                <span className="num w-10 shrink-0 text-xs text-soft">{fmtDur(x.t)}</span><span className={cn('w-14 shrink-0 text-xs font-semibold', x.who === 'agent' ? 'text-accent' : 'text-warn')}>{x.who === 'agent' ? 'Agent' : 'Caller'}</span><span className="flex-1">{x.text}{x.tool && <Badge tone="gray" className="ml-2">🔧 {x.tool}</Badge>}</span></button>)}
            </div>
          </Card>
          <Card className="p-6">
            <h3 className="font-semibold">Who spoke when</h3>
            <div className="relative mt-4 space-y-2">
              {(['agent', 'caller'] as const).map((w) => <div key={w} className="relative h-6 rounded bg-muted"><span className="absolute -top-0.5 left-1 z-10 text-[10px] font-semibold uppercase text-soft">{w}</span>{call.turns.filter((x) => x.who === w).map((x, i) => <div key={i} className={cn('absolute top-0 h-6 rounded', w === 'agent' ? 'bg-accent' : 'bg-warn')} style={{ left: `${(x.t / call.duration) * 100}%`, width: `${((x.end - x.t) / call.duration) * 100}%` }} />)}</div>)}
              <div className="relative h-6 rounded bg-muted"><span className="absolute left-1 top-0.5 text-[10px] font-semibold uppercase text-soft">Events</span>{call.turns.filter((x) => x.tool || x.interrupted).map((x, i) => <span key={i} className="absolute top-0.5 text-sm" style={{ left: `${(x.t / call.duration) * 100}%` }} title={x.tool ?? 'Interruption'}>{x.tool ? '🔧' : '✋'}</span>)}</div>
              <div className="absolute inset-y-0 w-px bg-ink/60" style={{ left: `${(t / call.duration) * 100}%` }} />
            </div>
            <h4 className="mb-2 mt-6 text-sm font-medium">How fast it replied <span className="font-normal text-soft">(shorter is better)</span></h4>
            <div className="flex h-16 items-end gap-2">{call.turns.filter((x) => x.reply).map((x, i) => <div key={i} className="flex-1 rounded-t bg-accent/70" style={{ height: `${(x.reply! / 1500) * 100}%` }} title={`${x.reply} ms`} />)}</div>
            <AdvancedOnly><p className="mt-2 text-xs text-soft">Latency per turn (ms): {call.turns.filter((x) => x.reply).map((x) => x.reply).join(', ')}</p></AdvancedOnly>
          </Card>
        </div>
        <div className="space-y-6">
          <Card className="p-6"><h3 className="font-semibold">Summary</h3><p className="mt-2 text-soft">{call.summary || 'A summary will appear here once call summaries are switched on.'}</p></Card>
          <Card className="p-6"><h3 className="font-semibold">What we found out</h3><dl className="mt-3 space-y-2 text-sm">{Object.entries(call.extracted).map(([k, v]) => <div key={k} className="flex justify-between gap-4"><dt className="text-soft">{k}</dt><dd className="font-medium">{v}</dd></div>)}</dl></Card>
          <Card className="p-6"><h3 className="font-semibold">Where the money went</h3>
            <div className="relative h-44"><ResponsiveContainer><PieChart><Pie data={call.costSplit} dataKey="value" innerRadius={52} outerRadius={72} paddingAngle={3} stroke="none">{call.costSplit.map((_, i) => <Cell key={i} fill={colors[i]} />)}</Pie></PieChart></ResponsiveContainer><div className="num absolute inset-0 flex items-center justify-center text-lg font-semibold">{money(call.cost, 2)}</div></div>
            <ul className="space-y-1 text-sm">{call.costSplit.map((c, i) => <li key={c.name} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: colors[i] }} />{c.name}<span className="num ml-auto">{money(c.value, 2)}</span></li>)}</ul></Card>
        </div>
      </div>
    </>
  )
}
