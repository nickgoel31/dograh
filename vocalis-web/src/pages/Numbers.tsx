import * as React from 'react'
import { Plus, Settings2, ShieldCheck } from '@/components/icons'
import { toast } from 'sonner'
import { Badge, Button, Card, Dialog, Field, Input, Select, Switch, Tab, TabPanel, Tabs, TabsList } from '@/components/ui'
import { CopyButton, EmptyState, PageHeader, StatusBadge, TableSkeleton, useAsync } from '@/components/shared'
import { api } from '@/lib/api'
import { availableNumbers } from '@/mock/misc'
import { useData } from '@/store/data'
import { money } from '@/lib/utils'
import type { PhoneNumber } from '@/mock/types'
import { USE_MOCKS } from '@/lib/api/env'
import RealNumbers from './NumbersReal'

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function DemoNumbers() {
  const { data, loading } = useAsync(() => api.numbers(), [])
  const agents = useData((s) => s.agents)
  const [extra, setExtra] = React.useState<PhoneNumber[]>([])
  const [buy, setBuy] = React.useState(false)
  const [sel, setSel] = React.useState<PhoneNumber | null>(null)
  const [step, setStep] = React.useState(0)
  const list = [...extra, ...(data ?? [])]
  const [hours, setHours] = React.useState<Record<string, boolean>>({ Mon: true, Tue: true, Wed: true, Thu: true, Fri: true, Sat: false, Sun: false })
  return (
    <>
      <PageHeader title="Phone Numbers" subtitle="The numbers people call to reach your agents." actions={<Button variant="primary" onClick={() => setBuy(true)}><Plus size={16} />Get a number</Button>} />
      <Card className="overflow-hidden">
        {loading ? <TableSkeleton rows={5} /> : list.length === 0 ? <div className="p-6"><EmptyState emoji="📞" title="No numbers yet" text="Get a number so real people can call your agent." action={<Button variant="primary" size="lg" onClick={() => setBuy(true)}>Get a number</Button>} /></div> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b bg-muted/50 text-left text-xs text-soft"><tr>{['Number', 'Answered by', 'Status', 'Spam check', 'Per month', ''].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody>{list.map((n) => <tr key={n.id} className="border-b last:border-0"><td className="px-4 py-3"><div className="num font-medium">{n.number}</div><div className="text-xs text-soft">{n.country} · {n.type}</div></td>
              <td className="px-4 py-3">{agents.find((a) => a.id === n.agentId)?.name ?? <span className="text-soft">Nobody yet</span>}</td><td className="px-4 py-3"><StatusBadge status={n.status} /></td>
              <td className="px-4 py-3"><StatusBadge status={n.reputation} /></td><td className="num px-4 py-3">{money(n.monthly)}</td><td className="px-4 py-3 text-right"><Button size="sm" onClick={() => setSel(n)}><Settings2 size={14} />Settings</Button></td></tr>)}</tbody></table></div>)}
      </Card>

      <Dialog open={buy} onOpenChange={(o) => { setBuy(o); setStep(0) }} wide title="Get a phone number" description="Pick a new number or bring one you already own.">
        <Tabs defaultValue="new"><TabsList><Tab value="new">Get a new number</Tab><Tab value="own">Bring your own number</Tab></TabsList>
          <TabPanel value="new"><div className="grid gap-4 sm:grid-cols-2"><Field label="Country"><Select><option>India</option><option>United States</option><option>United Kingdom</option></Select></Field><Field label="Type"><Select><option>Local</option><option>Toll-free</option></Select></Field></div>
            <div className="mt-4 space-y-2">{availableNumbers.map((n) => <div key={n} className="flex items-center justify-between rounded-lg border p-3"><span className="num font-medium">{n}</span><div className="flex items-center gap-3"><span className="text-sm text-soft">{money(400)}/mo</span><Button size="sm" variant="primary" onClick={() => { setExtra([{ id: 'n' + n, number: n, country: 'India', type: 'Local', status: 'active', monthly: 400, reputation: 'Clean' }, ...extra]); setBuy(false); toast.success('It’s yours! Now connect it to an agent.') }}>Get this</Button></div></div>)}</div></TabPanel>
          <TabPanel value="own"><ol className="space-y-3">{[['Open your phone provider', 'Find the SIP trunk settings.'], ['Paste our server address', 'sip.swarvoai.example.com'], ['Paste your username', 'ws_sunrise_4821'], ['Test the connection', 'We’ll call you to check.']].map(([t, v], i) => (
            <li key={t} className={`flex items-center gap-3 rounded-lg border p-3 ${i === step ? 'border-accent bg-accent-soft' : i < step ? 'opacity-60' : ''}`}><span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface text-sm font-semibold">{i < step ? '✓' : i + 1}</span><div className="flex-1"><div className="font-medium">{t}</div><div className="font-mono text-xs text-soft">{v}</div></div>{i === 1 || i === 2 ? <CopyButton text={v} /> : null}</li>))}</ol>
            <div className="mt-4 flex justify-end"><Button variant="primary" onClick={() => (step < 3 ? setStep(step + 1) : (toast.success('Connected!'), setBuy(false), setStep(0)))}>{step < 3 ? 'Next step' : 'Test connection'}</Button></div></TabPanel></Tabs>
      </Dialog>

      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)} side title={sel?.number ?? ''} description="Settings for this number">
        {sel && <div className="space-y-6">
          <div className="flex items-center justify-between rounded-lg border p-3"><div className="flex items-center gap-2"><ShieldCheck size={18} className="text-ok" /><div><div className="font-medium">Spam reputation</div><div className="text-xs text-soft">How phones label calls from this number</div></div></div><StatusBadge status={sel.reputation} /></div>
          <Field label="Answered by"><Select defaultValue={sel.agentId ?? ''}><option value="">Nobody yet</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          <div><div className="mb-2 text-[13px] font-medium">Business hours</div><div className="space-y-2">{days.map((d) => <div key={d} className="flex items-center gap-3"><span className="w-10 text-sm">{d}</span><Switch checked={hours[d]} onChange={(v) => setHours({ ...hours, [d]: v })} label={d} />{hours[d] ? <span className="num text-sm text-soft">9:00 AM – 6:00 PM</span> : <Badge>Closed → voicemail</Badge>}</div>)}</div></div>
          <Field label="If the agent can’t help, call a human on"><Input defaultValue="+91 98765 43210" /></Field>
          <Button variant="primary" className="w-full" onClick={() => { toast.success('Saved!'); setSel(null) }}>Save</Button></div>}
      </Dialog>
    </>
  )
}

export default function NumbersPage() {
  return USE_MOCKS ? <DemoNumbers /> : <RealNumbers />
}
