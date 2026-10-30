import * as React from 'react'
import { FileText, Globe, MessageSquare, Plus, RefreshCw, Type } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, Dialog, Input, Tab, TabPanel, Tabs, TabsList, Textarea } from '@/components/ui'
import { CardSkeletons, PageHeader, StatusBadge, useAsync } from '@/components/shared'
import { api } from '@/lib/api'
import { timeAgo } from '@/lib/utils'

const icon = { PDF: FileText, Website: Globe, Text: Type, 'Q&A': MessageSquare }

export default function KnowledgePage() {
  const { data, loading } = useAsync(() => api.knowledge(), [])
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState('')
  const [ans, setAns] = React.useState<null | boolean>(null)
  const [gap, setGap] = React.useState(true)
  return (
    <>
      <PageHeader title="Knowledge" subtitle="Everything your agents know about your business." actions={<Button variant="primary" onClick={() => setOpen(true)}><Plus size={16} />Add knowledge</Button>} />
      {gap && <Card className="mb-6 flex flex-wrap items-center gap-3 border-warn/40 bg-warn/10 p-4"><span className="font-medium text-warn">Callers asked about the refund policy 14 times and no answer exists.</span><Button size="sm" className="ml-auto" onClick={() => { setOpen(true); setGap(false) }}>Add one</Button></Card>}
      <Card className="mb-6 p-6"><h3 className="font-semibold">Test a question</h3>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); setAns(null); setTimeout(() => setAns(true), 700) }}><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. How much is a cleaning?" aria-label="Question" /><Button variant="primary">Ask</Button></form>
        {ans && <div className="mt-4 rounded-lg bg-accent-soft p-4"><p>A regular cleaning is ₹800. It takes about 30 minutes, and we have slots on weekdays.</p><p className="mt-2 text-xs text-soft">Source: Price list 2026.pdf, page 2</p></div>}</Card>
      {loading ? <CardSkeletons n={8} h="h-28" /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{data!.map((k) => { const I = icon[k.kind]; return (
          <Card key={k.id} className="p-5"><div className="flex items-start justify-between"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent"><I size={18} /></div><StatusBadge status={k.status} /></div>
            <div className="mt-3 truncate font-medium">{k.title}</div><div className="text-xs text-soft">{k.kind} · {k.size} · {timeAgo(k.updated)}</div>
            <Button size="sm" variant="ghost" className="mt-3 -ml-2" onClick={() => toast.success('Syncing…')}><RefreshCw size={13} />Re-sync</Button></Card>) })}</div>)}
      <Dialog open={open} onOpenChange={setOpen} title="Add knowledge">
        <Tabs defaultValue="web"><TabsList><Tab value="web">Website</Tab><Tab value="pdf">PDF</Tab><Tab value="text">Text</Tab><Tab value="qa">Q&A</Tab></TabsList>
          <TabPanel value="web"><Input placeholder="https://yourbusiness.com" /></TabPanel>
          <TabPanel value="pdf"><div className="rounded-xl border border-dashed p-8 text-center text-soft">Drop a PDF here or click to choose</div></TabPanel>
          <TabPanel value="text"><Textarea placeholder="Paste anything your agent should know…" /></TabPanel>
          <TabPanel value="qa"><Input placeholder="Question" className="mb-2" /><Textarea placeholder="Answer" /></TabPanel></Tabs>
        <Button variant="primary" className="mt-4 w-full" onClick={() => { setOpen(false); toast.success('Added! Your agent is learning it now.') }}>Add</Button>
      </Dialog>
    </>
  )
}
