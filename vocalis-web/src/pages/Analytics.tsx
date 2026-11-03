import { AnalyticsReal } from './InsightReal'
import { USE_MOCKS } from '@/lib/api/env'
import * as React from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { Lightbulb } from '@/components/icons'
import { Card, Chip, Select, Tab, TabPanel, Tabs, TabsList } from '@/components/ui'
import { PageHeader, StatCard } from '@/components/shared'
import { days } from '@/mock/misc'
import { useData } from '@/store/data'
import { money } from '@/lib/utils'

const grid = <CartesianGrid vertical={false} stroke="hsl(var(--line))" />
const Chart = ({ children }: { children: React.ReactElement }) => <div className="h-64"><ResponsiveContainer>{children}</ResponsiveContainer></div>
const insights = ['Most missed calls happen between 1 and 2 PM. Adding a lunch-time agent could win about 12 more bookings a week.', 'Callers who hear the shorter greeting stay on the line 9% longer.', 'Questions about parking came up 31 times. Adding it to Knowledge would save about 40 minutes.']

function DemoAnalyticsPage() {
  const agents = useData((s) => s.agents)
  const [range, setRange] = React.useState('14')
  const [cmp, setCmp] = React.useState(false)
  const d = days.slice(-Number(range))
  const prev = d.map((x) => ({ ...x, prev: Math.round(x.calls * 0.85) }))
  return (
    <>
      <PageHeader title="Analytics" subtitle="How your agents are helping your business." actions={<>
        <Select className="w-auto" value={range} onChange={(e) => setRange(e.target.value)} aria-label="Date range"><option value="7">Last 7 days</option><option value="14">Last 14 days</option></Select>
        <Select className="w-auto" aria-label="Agent"><option>All agents</option>{agents.slice(0, 3).map((a) => <option key={a.id}>{a.name}</option>)}</Select>
        <Chip active={cmp} onClick={() => setCmp(!cmp)}>Compare to before</Chip></>} />
      <Card className="mb-6 p-6"><h3 className="flex items-center gap-2 font-semibold"><Lightbulb size={16} className="text-warn" />AI insights this week</h3><ul className="mt-3 space-y-2">{insights.map((i) => <li key={i} className="rounded-lg bg-muted p-3">{i}</li>)}</ul></Card>
      <Tabs defaultValue="biz"><TabsList><Tab value="biz">Business</Tab><Tab value="q">Quality</Tab><Tab value="cost">Cost</Tab></TabsList>
        <TabPanel value="biz"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><StatCard label="Bookings" value="412" delta="+14%" /><StatCard label="Leads qualified" value="168" delta="+9%" /><StatCard label="Money saved (est.)" value={money(94000)} delta="+11%" /><StatCard label="Human hours replaced" value="236 h" delta="+7%" /></div>
          <Card className="mt-6 p-6"><h3 className="mb-3 font-semibold">Calls per day</h3><Chart><AreaChart data={prev}>{grid}<XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={12} /><Tooltip /><Area dataKey="calls" stroke="hsl(var(--accent))" fill="hsl(var(--accent-soft))" strokeWidth={2} />{cmp && <Area dataKey="prev" stroke="hsl(var(--soft))" fill="none" strokeDasharray="4 4" />}</AreaChart></Chart></Card></TabPanel>
        <TabPanel value="q"><div className="grid gap-4 sm:grid-cols-3"><StatCard label="Solved on first call" value="87%" hint="Callers who got what they needed" /><StatCard label="Average reply speed" value="0.8 s" /><StatCard label="Interruptions" value="14%" hint="How often callers talked over the agent" /></div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2"><Card className="p-6"><h3 className="mb-3 font-semibold">Where callers hang up</h3><Chart><BarChart layout="vertical" data={[{ s: 'Greeting', n: 100 }, { s: 'Question', n: 88 }, { s: 'Booking', n: 71 }, { s: 'Done', n: 64 }]}><XAxis type="number" hide /><Tooltip /><Bar dataKey="n" fill="hsl(var(--accent))" radius={4} /></BarChart></Chart></Card>
            <Card className="p-6"><h3 className="mb-3 font-semibold">Caller mood (1–5)</h3><Chart><LineChart data={d}>{grid}<XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={12} /><Tooltip /><Line dataKey="sentiment" stroke="hsl(var(--ok))" strokeWidth={2} dot={false} /></LineChart></Chart></Card></div></TabPanel>
        <TabPanel value="cost"><div className="grid gap-4 sm:grid-cols-2"><StatCard label="Cost per call" value={money(8.4, 2)} /><StatCard label="Cost per minute" value={money(6, 2)} /></div>
          <Card className="mt-6 p-6"><h3 className="mb-3 font-semibold">Spend by part</h3><Chart><BarChart data={d}>{grid}<XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={12} /><Tooltip /><Legend />
            <Bar dataKey="stt" name="Listening" stackId="a" fill="#6356f1" /><Bar dataKey="brain" name="AI brain" stackId="a" fill="#0ea5e9" /><Bar dataKey="voice" name="Voice" stackId="a" fill="#f59e0b" /><Bar dataKey="phone" name="Phone" stackId="a" fill="#10b981" /></BarChart></Chart></Card></TabPanel></Tabs>
    </>
  )
}

export default function AnalyticsPage() {
  return USE_MOCKS ? <DemoAnalyticsPage /> : <AnalyticsReal />
}
