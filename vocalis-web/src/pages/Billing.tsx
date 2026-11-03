import * as React from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { AlertTriangle, CreditCard, Download } from '@/components/icons'
import { toast } from 'sonner'
import { Badge, Button, Card, Progress, Select, Slider, Switch } from '@/components/ui'
import { AdvancedOnly, PageHeader, StatusBadge, TableSkeleton, useAsync } from '@/components/shared'
import { api } from '@/lib/api'
import { days } from '@/mock/misc'
import { money } from '@/lib/utils'
import { PRICE_PER_MIN } from '@/config/brand'
import { useUI } from '@/store/ui'
import { USE_MOCKS } from '@/lib/api/env'
import RealBilling from './BillingReal'

function DemoBilling() {
  const mode = useUI((s) => s.mode)
  const inv = useAsync(() => api.invoices(), [])
  const [auto, setAuto] = React.useState(true)
  const [limit, setLimit] = React.useState(25000)
  const [by, setBy] = React.useState('agent')
  const used = mode === 'test' ? 0 : 20000
  const data = days.map((d) => by === 'day' ? { day: d.day, Priya: d.stt, Arjun: d.brain / 2, Mira: d.voice / 3 } : { day: d.day, Priya: d.calls * 0.5, Arjun: d.calls * 0.3, Mira: d.calls * 0.2 })
  return (
    <>
      <PageHeader title="Billing & Usage" subtitle={`One simple price: ${money(PRICE_PER_MIN)} per minute, everything included.`} />
      {used / limit >= 0.8 && <Card className="mb-6 flex items-center gap-3 border-warn/40 bg-warn/10 p-4 text-warn"><AlertTriangle size={18} /><span className="font-medium">You’ve used {Math.round((used / limit) * 100)}% of this month’s limit.</span><Button size="sm" className="ml-auto" onClick={() => setLimit(limit + 10000)}>Raise limit by ₹10,000</Button></Card>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6"><div className="text-sm text-soft">Current balance</div><div className="num mt-1 text-4xl font-semibold">{money(mode === 'test' ? 0 : 5240)}</div>
          <div className="mt-6 flex items-center justify-between"><div><div className="font-medium">Top up automatically</div><div className="text-[13px] text-soft">Add ₹5,000 when balance drops below ₹1,000</div></div><Switch checked={auto} onChange={(v) => { setAuto(v); toast(v ? 'Auto top-up is on' : 'Auto top-up is off') }} label="Auto top-up" /></div>
          <Button variant="primary" className="mt-5" onClick={() => toast.success('Added ₹5,000 (demo)')}>Add ₹5,000</Button></Card>
        <Card className="p-6"><div className="flex justify-between"><div className="font-medium">Monthly spending limit</div><div className="num font-semibold">{money(limit)}</div></div>
          <div className="mt-4"><Slider min={5000} max={100000} step={1000} value={limit} onChange={setLimit} label="Spending limit" /></div>
          <div className="mt-6"><div className="mb-1 flex justify-between text-sm text-soft"><span>Used so far</span><span className="num">{money(used)}</span></div><Progress value={(used / limit) * 100} /></div></Card>
      </div>
      <Card className="mt-6 p-6"><div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">Usage</h3><Select className="w-auto" value={by} onChange={(e) => setBy(e.target.value)} aria-label="Group by"><option value="agent">By agent</option><option value="day">By day</option><option value="number">By number</option></Select></div>
        <div className="h-64"><ResponsiveContainer><BarChart data={data}><CartesianGrid vertical={false} stroke="hsl(var(--line))" /><XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={12} interval={1} /><Tooltip /><Legend />
          <Bar dataKey="Priya" stackId="a" fill="#6356f1" /><Bar dataKey="Arjun" stackId="a" fill="#0ea5e9" /><Bar dataKey="Mira" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
        <AdvancedOnly><table className="mt-6 w-full text-sm"><thead className="text-left text-xs text-soft"><tr><th className="py-2">Item</th><th>Minutes</th><th>Rate</th><th className="text-right">Amount</th></tr></thead><tbody>
          {[['Listening', 3070, 1.1], ['AI brain', 3070, 2.0], ['Voice', 3070, 1.8], ['Phone', 3070, 1.1]].map(([n, m, r]) => <tr key={n as string} className="border-t"><td className="py-2">{n}</td><td className="num">{m}</td><td className="num">{money(r as number, 2)}</td><td className="num text-right">{money((m as number) * (r as number))}</td></tr>)}</tbody></table></AdvancedOnly></Card>
      <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card className="overflow-hidden"><div className="border-b p-5 font-semibold">Invoices</div>{inv.loading ? <TableSkeleton rows={4} /> : (
          <table className="w-full text-sm"><tbody>{inv.data!.map((i) => <tr key={i.id} className="border-b last:border-0"><td className="px-5 py-3 font-medium">{i.id}</td><td className="text-soft">{i.date}</td><td className="num">{money(i.amount)}</td><td><StatusBadge status={i.status} /></td><td className="px-5 text-right"><Button size="sm" variant="ghost" aria-label="Download PDF" onClick={() => toast.success(`Downloading ${i.id}.pdf (demo)`)}><Download size={14} />PDF</Button></td></tr>)}</tbody></table>)}</Card>
        <Card className="p-6"><h3 className="font-semibold">Payment methods</h3><div className="mt-4 flex items-center gap-3 rounded-lg border p-3"><CreditCard size={20} /><div className="flex-1"><div className="font-medium">Visa •••• 4242</div><div className="text-xs text-soft">Expires 08/28</div></div><Badge tone="accent">Default</Badge></div><Button className="mt-3 w-full" onClick={() => toast('Card form would open here')}>Add a card</Button></Card>
      </div>
    </>
  )
}

export default function BillingPage() {
  return USE_MOCKS ? <DemoBilling /> : <RealBilling />
}
