import * as React from 'react'
import { BookOpen, CheckCircle2, Play, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, Dialog, Field, Input, Select, Switch, Tab, TabPanel, Tabs, TabsList, Textarea } from '@/components/ui'
import { PageHeader, Row, TableSkeleton, useAsync } from '@/components/shared'
import { api } from '@/lib/api'
import { auditLog } from '@/mock/misc'

export function SettingsPage() {
  const { data, loading } = useAsync(() => api.team(), [])
  const [inv, setInv] = React.useState(false)
  const [rec, setRec] = React.useState(true)
  const [pii, setPii] = React.useState(true)
  return (
    <>
      <PageHeader title="Team & Settings" subtitle="Who can do what, and how your data is handled." />
      <Tabs defaultValue="members"><TabsList>{[['members', 'Members'], ['audit', 'Audit log'], ['privacy', 'Privacy & compliance'], ['security', 'Security'], ['ws', 'Workspaces'], ['brand', 'Branding']].map(([v, l]) => <Tab key={v} value={v}>{l}</Tab>)}</TabsList>
        <TabPanel value="members"><Card className="overflow-hidden"><div className="flex items-center justify-between border-b p-5"><h3 className="font-semibold">Members</h3><Button variant="primary" size="sm" onClick={() => setInv(true)}><Plus size={14} />Invite</Button></div>
          {loading ? <TableSkeleton rows={5} /> : <table className="w-full text-sm"><tbody>{data!.map((m) => <tr key={m.id} className="border-b last:border-0"><td className="px-5 py-3"><div className="font-medium">{m.name}</div><div className="text-xs text-soft">{m.email}</div></td><td><Select className="w-32" defaultValue={m.role} aria-label="Role">{['Owner', 'Admin', 'Developer', 'Viewer'].map((r) => <option key={r}>{r}</option>)}</Select></td><td className="px-5 text-right text-soft">{m.last}</td></tr>)}</tbody></table>}</Card></TabPanel>
        <TabPanel value="audit"><Card className="divide-y">{auditLog.map((a, i) => <div key={i} className="flex justify-between gap-4 p-4"><span><b>{a.who}</b> {a.what}</span><span className="shrink-0 text-soft">{a.when}</span></div>)}</Card></TabPanel>
        <TabPanel value="privacy"><Card className="space-y-5 p-6">
          <Row><div><div className="font-medium">Record calls</div><div className="text-[13px] text-soft">Keep audio so you can listen later</div></div><Switch checked={rec} onChange={setRec} label="Record calls" /></Row>
          <Row><div><div className="font-medium">Hide personal details</div><div className="text-[13px] text-soft">Blur card numbers and IDs in transcripts</div></div><Switch checked={pii} onChange={setPii} label="Redact" /></Row>
          <Field label="Keep recordings for"><Select className="w-48"><option>30 days</option><option>90 days</option><option>1 year</option></Select></Field>
          <Field label="What callers hear first"><Textarea defaultValue="This call may be recorded to help us serve you better." /></Field>
          <Button variant="primary" onClick={() => toast.success('Saved')}>Save</Button></Card></TabPanel>
        <TabPanel value="security"><Card className="space-y-5 p-6"><Row><div className="font-medium">Two-step sign-in (2FA)</div><Switch checked onChange={() => undefined} label="2FA" /></Row>
          {['Single sign-on (SSO)', 'IP allowlist'].map((s) => <Row key={s}><div className="font-medium">{s}</div><Badge tone="accent">Enterprise</Badge></Row>)}</Card></TabPanel>
        <TabPanel value="ws"><Card className="divide-y">{['Sunrise Dental', 'GlowUp Salon'].map((w) => <div key={w} className="flex items-center justify-between p-4"><span className="font-medium">{w}</span><Badge>Workspace</Badge></div>)}<div className="p-4"><Button onClick={() => toast('Sub-accounts are for agencies (demo)')}><Plus size={14} />New sub-account</Button></div></Card></TabPanel>
        <TabPanel value="brand"><Card className="p-10 text-center"><Badge tone="accent">Coming soon</Badge><p className="mt-3 text-soft">Add your own logo and colours to the widget and emails.</p></Card></TabPanel></Tabs>
      <Dialog open={inv} onOpenChange={setInv} title="Invite a teammate"><Field label="Email"><Input placeholder="name@company.com" /></Field><Field label="Role" className="mt-3"><Select><option>Viewer</option><option>Developer</option><option>Admin</option></Select></Field><Button variant="primary" className="mt-4 w-full" onClick={() => { setInv(false); toast.success('Invite sent') }}>Send invite</Button></Dialog>
    </>
  )
}

export function HelpPage() {
  const [q, setQ] = React.useState('')
  const cats = ['Getting started', 'Agents', 'Phone numbers', 'Billing', 'Integrations', 'API']
  return (
    <>
      <PageHeader title="How can we help?" actions={<Badge tone="green" className="px-3 py-1.5 text-sm"><CheckCircle2 size={14} />All systems operational</Badge>} />
      <div className="relative mb-8 max-w-xl"><Search size={16} className="absolute left-3 top-3 text-soft" /><Input className="h-11 pl-10" placeholder="Search help…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search help" /></div>
      <div className="grid gap-4 sm:grid-cols-3">{cats.filter((c) => c.toLowerCase().includes(q.toLowerCase())).map((c) => <Card key={c} className="flex items-center gap-3 p-5 hover:shadow-pop"><BookOpen className="text-accent" /><span className="font-medium">{c}</span></Card>)}</div>
      <h2 className="mb-3 mt-10 font-semibold">Video tutorials</h2>
      <div className="grid gap-4 sm:grid-cols-3">{['Your first agent in 60 seconds', 'Connecting a phone number', 'Reading call reports'].map((t) => <Card key={t} className="overflow-hidden"><button onClick={() => toast('Video player would open')} className="flex aspect-video w-full items-center justify-center bg-gradient-to-br from-accent to-[#8b5cf6] text-white"><Play size={36} /></button><div className="p-3 font-medium">{t}</div></Card>)}</div>
      <Card className="mt-10 max-w-xl p-6"><h3 className="font-semibold">Contact support</h3><div className="mt-3 space-y-3"><Input placeholder="Subject" aria-label="Subject" /><Textarea placeholder="Tell us what's happening…" aria-label="Message" /><Button variant="primary" onClick={() => toast.success('Thanks! We reply within a few hours.')}>Send</Button></div></Card>
    </>
  )
}
