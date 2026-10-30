import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Check, Pause, Play, Plus, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, Field, Input, Progress, Select } from '@/components/ui'
import { CardSkeletons, EmptyState, PageHeader, StatusBadge, useAsync } from '@/components/shared'
import { api } from '@/lib/api'
import { USE_MOCKS } from '@/lib/api/env'
import { CampaignsReal } from './GrowthReal'
import { useData } from '@/store/data'
import { cn } from '@/lib/utils'

function DemoCampaignsPage() {
  const { data, loading } = useAsync(() => api.campaigns(), [])
  return (
    <>
      <PageHeader title="Campaigns" subtitle="Let your agent call a whole list for you." actions={<Link to="/campaigns/new"><Button variant="primary"><Plus size={16} />New campaign</Button></Link>} />
      {loading ? <CardSkeletons n={4} h="h-32" /> : (
        <div className="grid gap-4 md:grid-cols-2">{data!.map((c) => <Link key={c.id} to={'/campaigns/' + c.id}><Card className="p-5 transition hover:shadow-pop"><div className="flex items-start justify-between gap-3"><h3 className="font-semibold">{c.name}</h3><StatusBadge status={c.status} /></div>
          <Progress className="mt-4" value={(c.dialed / c.total) * 100} /><div className="num mt-2 text-[13px] text-soft">{c.dialed.toLocaleString()} of {c.total.toLocaleString()} called</div></Card></Link>)}</div>)}
    </>
  )
}

function Counter({ to }: { to: number }) {
  const [v, setV] = React.useState(0)
  React.useEffect(() => { let n = 0; const i = setInterval(() => { n += Math.ceil(to / 25); if (n >= to) { n = to; clearInterval(i) } setV(n) }, 30); return () => clearInterval(i) }, [to])
  return <span className="num">{v.toLocaleString()}</span>
}
export function CampaignDetail() {
  const { id } = useParams()
  const { data } = useAsync(() => api.campaigns(), [])
  const c = data?.find((x) => x.id === id)
  const [paused, setPaused] = React.useState(false)
  if (!c) return <CardSkeletons n={3} h="h-24" />
  const funnel = [{ n: 'Dialed', v: c.dialed }, { n: 'Answered', v: c.answered }, { n: 'Converted', v: c.converted }]
  return (
    <>
      <PageHeader title={c.name} actions={<><StatusBadge status={paused ? 'paused' : c.status} />{c.status !== 'done' && <Button onClick={() => { setPaused(!paused); toast(paused ? 'Resumed' : 'Paused') }}>{paused ? <><Play size={14} />Resume</> : <><Pause size={14} />Pause</>}</Button>}</>} />
      <div className="grid gap-4 sm:grid-cols-5">{[['Dialed', c.dialed], ['Answered', c.answered], ['Voicemail', c.voicemail], ['No answer', c.noAnswer], ['Converted', c.converted]].map(([l, v]) => <Card key={l as string} className="p-5"><div className="text-[13px] text-soft">{l}</div><div className="mt-1 text-2xl font-semibold"><Counter to={v as number} /></div></Card>)}</div>
      <Card className="mt-6 p-6"><h3 className="mb-3 font-semibold">Funnel</h3><div className="h-56"><ResponsiveContainer><BarChart layout="vertical" data={funnel}><XAxis type="number" hide /><YAxis type="category" dataKey="n" width={80} tickLine={false} axisLine={false} /><Tooltip /><Bar dataKey="v" fill="hsl(var(--accent))" radius={6} /></BarChart></ResponsiveContainer></div></Card>
    </>
  )
}

export function NewCampaign() {
  const nav = useNavigate()
  const agents = useData((s) => s.agents)
  const [file, setFile] = React.useState<string | null>(null)
  const checks = ['Do-Not-Call list checked', 'Callers have given consent', 'Calling only 9 AM – 8 PM local time']
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New campaign" subtitle="Four things and you're ready." />
      <div className="space-y-6">
        <Card className="p-6"><h3 className="font-semibold">1. Upload your list</h3>
          <label onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); setFile(e.dataTransfer.files[0]?.name ?? 'contacts.csv') }} className="mt-3 flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-soft hover:bg-muted"><Upload /><span>{file ?? 'Drag a CSV here, or click to choose'}</span><input type="file" accept=".csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0]?.name ?? null)} /></label>
          {file && <table className="mt-4 w-full text-sm"><thead className="text-left text-xs text-soft"><tr><th>Name</th><th>Phone</th></tr></thead><tbody>{[['Ananya Iyer', '+91 98450 11223'], ['Rahul Mehta', '+91 99001 45678'], ['Divya Nair', '+91 90353 22110']].map(([a, b]) => <tr key={a} className="border-t"><td className="py-2">{a}</td><td className="num">{b}</td></tr>)}</tbody></table>}</Card>
        <Card className="space-y-4 p-6"><h3 className="font-semibold">2. Who calls, and when</h3>
          <Field label="Agent"><Select>{agents.map((a) => <option key={a.id}>{a.name}</option>)}</Select></Field>
          <div className="grid gap-4 sm:grid-cols-3"><Field label="From"><Input type="time" defaultValue="09:00" /></Field><Field label="Until"><Input type="time" defaultValue="18:00" /></Field><Field label="Time zone"><Select><option>India (IST)</option><option>UK (GMT)</option><option>US East</option></Select></Field></div>
          <Field label="If nobody answers"><Select><option>Try again up to 3 times, 4 hours apart</option><option>Don't retry</option></Select></Field></Card>
        <Card className="p-6"><h3 className="font-semibold">3. Safety checks</h3><ul className="mt-3 space-y-2">{checks.map((c) => <li key={c} className={cn('flex items-center gap-2 rounded-lg bg-ok/10 p-3 text-ok')}><Check size={16} />{c}</li>)}</ul></Card>
        <Button variant="primary" size="lg" disabled={!file} onClick={() => { toast.success('Campaign scheduled!'); nav('/campaigns') }}>Start campaign</Button>
        {!file && <EmptyState emoji="📋" title="Add a list to continue" text="Upload a CSV with names and phone numbers." />}
      </div>
    </div>
  )
}

export default function CampaignsPage() {
  return USE_MOCKS ? <DemoCampaignsPage /> : <CampaignsReal />
}
