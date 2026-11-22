import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Card, Input, Select } from '@/components/ui'
import { EmptyState, PageHeader, TableSkeleton } from '@/components/shared'
import { Plus } from '@/components/icons'
import { http } from '@/lib/api/http'
import { pixelsApi, type Pixel } from '@/lib/api/pixels'
import { cn } from '@/lib/utils'

type AgentRow = { id: string; name: string; status: string }
const say = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
const ago = (iso: string | null) => {
  if (!iso) return 'never'
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
const mins = (n: number) => (n < 1 ? `${Math.round(n * 60)} s` : `${n % 1 ? n.toFixed(1) : n} min`)
const REASON: Record<string, string> = { touch_end: 'Ended on the device', idle: 'Nobody spoke', limit: 'Time limit', done: 'Finished', error: 'Something went wrong', disconnect: 'Device disconnected', restart: 'New touch', timeout: 'No activity' }
const wssUrl = () => `wss://${window.location.host}/api/v1/ws/device`

function Sessions({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['pixel-sessions', id], queryFn: () => pixelsApi.sessions(id) })
  if (q.isPending) return <TableSkeleton rows={2} />
  if (!q.data?.length) return <p className="py-3 text-sm text-soft">No conversations yet. Touch the pad on the device and say hello.</p>
  return (
    <div className="divide-y text-sm">
      {q.data.map((s, i) => (
        <div key={i} className="flex items-center justify-between gap-3 py-2.5">
          <div><div className="font-medium">{new Date(s.started).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div><div className="text-xs text-soft">{REASON[s.reason] ?? s.reason ?? 'Finished'}</div></div>
          <div className="flex items-center gap-3"><span className="num text-soft">{mins(s.seconds / 60)}</span>{s.call_id && <Link to={`/conversations/${s.call_id}`} className="text-[13px] font-medium text-accent hover:underline">Open</Link>}</div>
        </div>))}
    </div>
  )
}

function DeviceCard({ d, agents, onChanged }: { d: Pixel; agents: AgentRow[]; onChanged: () => void }) {
  const [name, setName] = React.useState(d.name)
  const [open, setOpen] = React.useState(false)
  React.useEffect(() => setName(d.name), [d.name])
  const change = async (b: Parameters<typeof pixelsApi.change>[1]) => { try { await pixelsApi.change(d.id, b); onChanged() } catch (e) { say(e) } }
  const off = d.status === 'revoked'
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn('h-2.5 w-2.5 rounded-full', off ? 'bg-bad' : d.online ? 'bg-ok' : 'bg-soft/40')} aria-hidden />
            <span className="text-[13px] font-medium">{off ? 'Switched off' : d.online ? 'Online' : `Offline · seen ${ago(d.last_seen)}`}</span>
            <Badge>{d.id}</Badge>{d.fw && <span className="text-xs text-soft">firmware {d.fw}</span>}
          </div>
          <Input className="mt-3 max-w-sm font-semibold" value={name} aria-label="Device name" onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name.trim() !== d.name && change({ name: name.trim() })} />
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          {[['Today', mins(d.minutes_today)], ['All time', mins(d.minutes)], ['Chats', String(d.sessions)]].map(([k, v]) => <div key={k}><div className="num text-[17px] font-semibold">{v}</div><div className="text-xs text-soft">{k}</div></div>)}
        </div>
      </div>
      <div className="mt-5">
        <div className="mb-1.5 text-[13px] font-medium">Which agent does it talk to?</div>
        <div className="flex flex-wrap items-center gap-2">
          <Select className="max-w-xs" value={d.agent_id ?? ''} aria-label="Agent" onChange={(e) => change(e.target.value ? { agent_id: e.target.value } : { clear_agent: true })}>
            <option value="">Choose an agent…</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.status === 'live' ? '' : ' (draft)'}</option>)}
          </Select>
          {d.agent_id && <Link to={`/agents/${d.agent_id}`} className="text-[13px] font-medium text-accent hover:underline">Edit this agent</Link>}
          <Link to="/agents/new" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline"><Plus size={13} />New agent</Link>
        </div>
        {!d.agent_id && <p className="mt-2 text-xs text-warn">Pick an agent, or the device can't answer yet. Its voice, language, knowledge and tools are the agent's: change them on the agent's page.</p>}
      </div>
      <button type="button" onClick={() => setOpen(!open)} className="mt-4 text-[13px] font-medium text-soft hover:text-ink">{open ? 'Hide conversations' : 'Recent conversations'}</button>
      {open && <div className="mt-2"><Sessions id={d.id} /></div>}
    </Card>
  )
}

export default function DevicesPage() {
  const qc = useQueryClient()
  const devices = useQuery({ queryKey: ['pixels'], queryFn: pixelsApi.list, refetchInterval: 10000 })
  const agents = useQuery({ queryKey: ['pixel-agents'], queryFn: () => http<AgentRow[]>('/agents') })
  const refresh = () => qc.invalidateQueries({ queryKey: ['pixels'] })
  return (
    <>
      <PageHeader title="Devices" subtitle="Your Swarvo Pixel devices: what each one says, who it talks to, and how much it has been used." />
      {devices.isPending ? <TableSkeleton rows={2} /> : !devices.data?.length ? (
        <EmptyState emoji="🎙️" title="No devices here yet" text="A Swarvo Pixel shows up here after you sign in with its device id and activation code on the sign-in page." />
      ) : (
        <div className="space-y-4">{devices.data.map((d) => <DeviceCard key={d.id} d={d} agents={agents.data ?? []} onChanged={refresh} />)}</div>
      )}
      <Card className="mt-6 p-5">
        <h3 className="text-[15px] font-semibold">Connecting the device</h3>
        <p className="mt-1 text-[13px] text-soft">The device opens a secure WebSocket and says hello with its id and activation code. Nothing else to set up on this page. Calls from a device are charged from your balance, the same per-minute price as a practice call.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2"><code className="rounded-lg bg-muted px-3 py-2 text-[13px]">{wssUrl()}</code><Button size="sm" onClick={() => { navigator.clipboard?.writeText(wssUrl()); toast.success('Copied') }}>Copy address</Button></div>
        <p className="mt-3 text-xs text-soft">You can change the agent, its voice, languages, knowledge and tools any time. The device uses the latest version at its next touch, no update needed.</p>
      </Card>
    </>
  )
}
