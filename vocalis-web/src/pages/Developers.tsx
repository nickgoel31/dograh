import * as React from 'react'
import { Eye, EyeOff, MessageCircle, RefreshCw, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, Chip, Input, Dialog, Tab, TabPanel, Tabs, TabsList } from '@/components/ui'
import { CodeBlock, ConfirmDialog, CopyButton, PageHeader, TableSkeleton, useAsync } from '@/components/shared'
import { api } from '@/lib/api'
import { BRAND } from '@/config/brand'
import { cn } from '@/lib/utils'
import type { ReqLog } from '@/mock/types'

const snippets = {
  curl: `curl https://api.vocalis.example.com/v1/calls \\\n  -H "Authorization: Bearer sk_test_51Hx..." \\\n  -d agent_id=a1 \\\n  -d to=+919845011223`,
  node: `import ${BRAND} from '@vocalis/sdk'\n\nconst client = new ${BRAND}('sk_test_51Hx...')\nconst call = await client.calls.create({\n  agentId: 'a1',\n  to: '+919845011223',\n})\nconsole.log(call.id)`,
  python: `from vocalis import Client\n\nclient = Client("sk_test_51Hx...")\ncall = client.calls.create(agent_id="a1", to="+919845011223")\nprint(call.id)`,
}
const events = ['call.started', 'call.ended', 'tool.failed', 'campaign.completed']

function Key({ label, value, live }: { label: string; value: string; live?: boolean }) {
  const [show, setShow] = React.useState(false)
  const [key, setKey] = React.useState(value)
  const [ask, setAsk] = React.useState(false)
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
      <Badge tone={live ? 'green' : 'orange'}>{label}</Badge>
      <code className="flex-1 truncate font-mono text-sm">{show ? key : key.slice(0, 8) + '•'.repeat(24)}</code>
      <Button size="sm" variant="ghost" aria-label={show ? 'Hide key' : 'Reveal key'} onClick={() => setShow(!show)}>{show ? <EyeOff size={14} /> : <Eye size={14} />}</Button>
      <CopyButton text={key} /><Button size="sm" onClick={() => setAsk(true)}><RefreshCw size={13} />Roll key</Button>
      <ConfirmDialog open={ask} onOpenChange={setAsk} title="Roll this key?" text="The old key stops working right away. Make sure to update your apps." confirm="Roll key" danger onConfirm={() => { setKey(key.slice(0, 8) + Math.random().toString(36).slice(2, 28)); toast.success('New key created') }} />
    </div>
  )
}

export default function DevelopersPage() {
  const del = useAsync(() => api.deliveries(), [])
  const logs = useAsync(() => api.reqLogs(), [])
  const [lang, setLang] = React.useState<keyof typeof snippets>('curl')
  const [evs, setEvs] = React.useState(['call.ended'])
  const [log, setLog] = React.useState<ReqLog | null>(null)
  const [payload, setPayload] = React.useState<unknown>(null)
  const embed = `<script src="https://cdn.vocalis.example.com/widget.js"\n  data-agent="a1" data-color="#6356f1" async></script>`
  return (
    <>
      <PageHeader title="Developers" subtitle="Everything you need to connect your own apps." />
      <Card className="mb-6 p-6"><h3 className="font-semibold">Make your first call in 60 seconds</h3>
        <Tabs value={lang} onValueChange={(v) => setLang(v as keyof typeof snippets)} className="mt-4"><TabsList>{(['curl', 'node', 'python'] as const).map((l) => <Tab key={l} value={l}>{l === 'curl' ? 'cURL' : l === 'node' ? 'Node' : 'Python'}</Tab>)}</TabsList>
          {(['curl', 'node', 'python'] as const).map((l) => <TabPanel key={l} value={l}><CodeBlock code={snippets[l]} /></TabPanel>)}</Tabs></Card>
      <Card className="mb-6 p-6"><h3 className="mb-4 font-semibold">API keys</h3><div className="space-y-3"><Key label="Test" value="sk_test_51HxQ7aLm2TnR0cVbYe8dKp" /><Key label="Live" value="sk_live_51HxZ9uWq4SjF3gNtXa6oBc" live /></div></Card>
      <Tabs defaultValue="hooks"><TabsList><Tab value="hooks">Webhooks</Tab><Tab value="logs">Request logs</Tab><Tab value="widget">Web widget</Tab></TabsList>
        <TabPanel value="hooks"><div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-6"><h3 className="font-semibold">Endpoint</h3><div className="mt-3 flex gap-2"><Input defaultValue="https://api.sunrisedental.in/hooks/voice" aria-label="Endpoint URL" /><Button onClick={() => toast.success('Endpoint saved')}>Save</Button></div>
            <div className="mb-2 mt-5 text-[13px] font-medium">Tell me when…</div><div className="flex flex-wrap gap-2">{events.map((e) => <Chip key={e} active={evs.includes(e)} onClick={() => setEvs(evs.includes(e) ? evs.filter((x) => x !== e) : [...evs, e])}>{e}</Chip>)}</div></Card>
          <Card className="p-6"><h3 className="font-semibold">Example message</h3><div className="mt-3"><CodeBlock json code={JSON.stringify(payload ?? (del.data?.[0].payload ?? {}), null, 2)} /></div></Card></div>
          <Card className="mt-6 overflow-hidden"><div className="border-b p-5 font-semibold">Delivery log</div>{del.loading ? <TableSkeleton rows={4} /> : <table className="w-full text-sm"><tbody>{del.data!.map((d) => <tr key={d.id} className="cursor-pointer border-b last:border-0 hover:bg-muted/50" onClick={() => setPayload(d.payload)}><td className="px-5 py-3 font-mono text-xs">{d.event}</td><td><Badge tone={d.status === 200 ? 'green' : 'red'}>{d.status}</Badge></td><td className="text-soft">{d.time}</td><td className="px-5 text-right"><Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); toast.success('Sent again') }}><Send size={13} />Resend</Button></td></tr>)}</tbody></table>}</Card></TabPanel>
        <TabPanel value="logs"><Card className="overflow-hidden">{logs.loading ? <TableSkeleton rows={6} /> : <table className="w-full text-sm"><tbody>{logs.data!.map((l) => <tr key={l.id} className="cursor-pointer border-b last:border-0 hover:bg-muted/50" onClick={() => setLog(l)}><td className="px-5 py-3"><Badge>{l.method}</Badge></td><td className="font-mono text-xs">{l.path}</td><td><Badge tone={l.status < 300 ? 'green' : 'red'}>{l.status}</Badge></td><td className="num text-soft">{l.ms} ms</td><td className="px-5 text-right text-soft">{l.time}</td></tr>)}</tbody></table>}</Card></TabPanel>
        <TabPanel value="widget"><div className="grid gap-6 lg:grid-cols-2"><Card className="p-6"><h3 className="font-semibold">Add a talk button to your website</h3><p className="mb-3 mt-1 text-soft">Paste this before the closing body tag.</p><CodeBlock code={embed} /></Card>
          <Card className="relative min-h-[220px] overflow-hidden bg-muted/50 p-6"><div className="text-sm text-soft">Live preview</div><div className="mt-2 h-3 w-2/3 rounded bg-line" /><div className="mt-2 h-3 w-1/2 rounded bg-line" />
            <button onClick={() => toast('Starting a call with your agent…')} className={cn('absolute bottom-4 right-4 flex h-14 items-center gap-2 rounded-full bg-accent px-5 font-medium text-accent-fg shadow-pop transition hover:scale-105')}><MessageCircle size={20} />Talk to us</button></Card></div></TabPanel></Tabs>
      <Dialog open={!!log} onOpenChange={(o) => !o && setLog(null)} side title={log ? `${log.method} ${log.path}` : ''} description={log?.time}>
        {log && <div className="space-y-4"><div><div className="mb-1 text-xs font-semibold uppercase text-soft">Request</div><CodeBlock json code={JSON.stringify(log.req, null, 2)} /></div><div><div className="mb-1 text-xs font-semibold uppercase text-soft">Response</div><CodeBlock json code={JSON.stringify(log.res, null, 2)} /></div></div>}
      </Dialog>
    </>
  )
}
