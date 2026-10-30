import * as React from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, Dialog, Field, Input, Select, Textarea } from '@/components/ui'
import { CardSkeletons, CodeBlock, PageHeader, SimpleAdvanced, useAsync } from '@/components/shared'
import { api } from '@/lib/api'

const builtin = ['Transfer to a human', 'Send a text message', 'Send an email', 'End the call', 'Press keypad numbers', 'Check the calendar']

export default function ToolsPage() {
  const { data, loading } = useAsync(() => api.integrations(), [])
  const [on, setOn] = React.useState<Record<string, boolean>>({})
  const [open, setOpen] = React.useState(false)
  const [res, setRes] = React.useState<string | null>(null)
  const [custom, setCustom] = React.useState<string[]>(['Look up order status'])
  const [name, setName] = React.useState('')
  return (
    <>
      <PageHeader title="Tools & Integrations" subtitle="Connect the apps your agent should work with." />
      <h2 className="mb-3 font-semibold">Ready-made</h2>
      {loading ? <CardSkeletons n={8} h="h-28" /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{data!.map((i) => { const c = on[i.id] ?? i.connected; return (
          <Card key={i.id} className="p-5"><div className="flex h-10 w-10 items-center justify-center rounded-xl text-lg font-bold text-white" style={{ background: i.color }}>{i.letter}</div>
            <div className="mt-3 font-medium">{i.name}</div><div className="text-[13px] text-soft">{i.blurb}</div>
            <Button size="sm" variant={c ? 'secondary' : 'primary'} className="mt-3" onClick={() => { setOn({ ...on, [i.id]: !c }); toast.success(c ? `${i.name} disconnected` : `${i.name} connected`) }}>{c ? '✓ Connected' : 'Connect'}</Button></Card>) })}</div>)}
      <h2 className="mb-3 mt-10 font-semibold">Built-in abilities</h2>
      <div className="flex flex-wrap gap-2">{builtin.map((b) => <Badge key={b} tone="accent" className="px-3 py-1.5 text-sm">{b}</Badge>)}</div>
      <div className="mb-3 mt-10 flex items-center justify-between"><h2 className="font-semibold">Custom tools</h2><Button onClick={() => setOpen(true)}><Plus size={15} />New tool</Button></div>
      <div className="space-y-2">{custom.map((c) => <Card key={c} className="flex items-center justify-between p-4"><span className="font-medium">{c}</span><Badge tone="green">Ready</Badge></Card>)}</div>
      <Dialog open={open} onOpenChange={setOpen} wide title="Build a custom tool" description="Teach your agent a new trick.">
        <SimpleAdvanced
          simple={<div className="space-y-4"><Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Look up order" /></Field><Field label="What does it do?"><Textarea placeholder="Finds an order by its number and tells the caller where it is." /></Field><Field label="What info does it need?"><Input placeholder="Order number" /></Field></div>}
          advanced={<div className="space-y-4"><div className="grid grid-cols-[110px_1fr] gap-2"><Select><option>POST</option><option>GET</option></Select><Input defaultValue="https://api.example.com/orders/lookup" /></div><Field label="Headers"><Textarea className="font-mono" defaultValue={'Authorization: Bearer {{secret}}'} /></Field><Field label="JSON schema"><Textarea className="min-h-[120px] font-mono" defaultValue={'{\n  "type": "object",\n  "properties": { "order_id": { "type": "string" } },\n  "required": ["order_id"]\n}'} /></Field></div>} />
        {res && <div className="mt-4"><CodeBlock json code={res} /></div>}
        <div className="mt-4 flex gap-2"><Button onClick={() => setTimeout(() => setRes('{\n  "status": "shipped",\n  "eta": "Thursday",\n  "ok": true\n}'), 600)}>Test this tool</Button><Button variant="primary" onClick={() => { setCustom([...custom, name || 'New tool']); setOpen(false); setRes(null); toast.success('Tool saved') }}>Save tool</Button></div>
      </Dialog>
    </>
  )
}
