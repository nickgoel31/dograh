import { TestingReal } from './InsightReal'
import { USE_MOCKS } from '@/lib/api/env'
import * as React from 'react'
import { Check, Play, Trophy, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, Progress, Select, Tab, TabPanel, Tabs, TabsList } from '@/components/ui'
import { PageHeader, Section } from '@/components/shared'
import { VoicePlayground } from '@/components/Playground'
import { useData } from '@/store/data'
import { sleep, cn } from '@/lib/utils'

const personas = [
  { id: 'p1', emoji: '😠', name: 'Angry customer', d: 'Raises their voice and wants a refund now.', score: 78 },
  { id: 'p2', emoji: '👵', name: 'Confused elder', d: 'Speaks slowly, repeats questions, loses track.', score: 91 },
  { id: 'p3', emoji: '⚡', name: 'Fast talker', d: 'Rattles off everything in one breath.', score: 69 },
  { id: 'p4', emoji: '🤐', name: 'Quiet mumbler', d: 'Gives very short, unclear answers.', score: 84 },
]
const cases0 = [
  { id: 1, say: 'Do you have a slot tomorrow?', should: 'Check the calendar and offer times', res: null as null | boolean },
  { id: 2, say: 'I want to talk to a person', should: 'Transfer the call to a human', res: null },
  { id: 3, say: 'How much is a cleaning?', should: 'Quote ₹800 from the price list', res: null },
  { id: 4, say: 'Cancel my booking', should: 'Confirm which booking, then cancel it', res: null },
  { id: 5, say: 'Are you a robot?', should: 'Say it is an AI assistant honestly', res: null },
]

function DemoTestingPage() {
  const agents = useData((s) => s.agents)
  const [aid, setAid] = React.useState(agents[0].id)
  const [run, setRun] = React.useState<Record<string, number | 'done'>>({})
  const [cases, setCases] = React.useState(cases0)
  const [running, setRunning] = React.useState(false)

  const runPersona = async (id: string) => {
    for (let p = 0; p <= 100; p += 10) { setRun((r) => ({ ...r, [id]: p })); await sleep(180) }
    setRun((r) => ({ ...r, [id]: 'done' })); toast.success('Simulated call finished')
  }
  const runAll = async () => {
    setRunning(true); setCases((c) => c.map((x) => ({ ...x, res: null })))
    for (const c of cases0) { await sleep(600); setCases((cs) => cs.map((x) => (x.id === c.id ? { ...x, res: c.id !== 3 } : x))) }
    setRunning(false)
  }
  return (
    <>
      <PageHeader title="Testing Lab" subtitle="Try your agent safely before real people call it." actions={<Select className="w-56" value={aid} onChange={(e) => setAid(e.target.value)} aria-label="Agent">{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>} />
      <Tabs defaultValue="play">
        <TabsList><Tab value="play">Playground</Tab><Tab value="sim">Simulated callers</Tab><Tab value="cases">Test cases</Tab><Tab value="ab">A/B tests</Tab></TabsList>
        <TabPanel value="play"><Card className="p-6"><VoicePlayground key={aid} agentId={aid} /></Card></TabPanel>
        <TabPanel value="sim"><div className="grid gap-4 sm:grid-cols-2">{personas.map((p) => { const r = run[p.id]; return (
          <Card key={p.id} className="p-5"><div className="flex items-start gap-4"><div className="text-4xl">{p.emoji}</div><div className="flex-1"><h3 className="font-semibold">{p.name}</h3><p className="text-soft">{p.d}</p>
            {r === undefined && <Button className="mt-3" onClick={() => runPersona(p.id)}><Play size={14} />Run</Button>}
            {typeof r === 'number' && <div className="mt-4"><Progress value={r} /><div className="mt-1 text-xs text-soft">Calling… {r}%</div></div>}
            {r === 'done' && <div className="mt-3 flex items-center gap-3"><Badge tone={p.score > 75 ? 'green' : 'orange'}>Score {p.score}/100</Badge><span className="text-[13px] text-soft">{p.score > 75 ? 'Handled well' : 'Got flustered once'}</span><Button size="sm" variant="ghost" onClick={() => setRun((x) => { const n = { ...x }; delete n[p.id]; return n })}>Again</Button></div>}</div></div></Card>) })}</div></TabPanel>
        <TabPanel value="cases"><Section title="Test cases" hint="When the caller says X, the agent should do Y." right={<Button variant="primary" onClick={runAll} disabled={running}><Play size={14} />Run all</Button>}>
          <div className="divide-y">{cases.map((c) => <div key={c.id} className="flex flex-wrap items-center gap-3 py-3"><div className="min-w-[200px] flex-1"><div className="text-[13px] text-soft">When the caller says</div><div className="font-medium">“{c.say}”</div></div><div className="min-w-[200px] flex-1"><div className="text-[13px] text-soft">The agent should</div><div>{c.should}</div></div>
            {c.res === null ? <Badge>Not run</Badge> : c.res ? <Badge tone="green"><Check size={12} />Pass</Badge> : <Badge tone="red"><X size={12} />Fail</Badge>}</div>)}</div></Section></TabPanel>
        <TabPanel value="ab"><div className="grid gap-4 md:grid-cols-2">{[{ k: 'A', t: 'Friendly greeting', r: 81, b: 62, w: false }, { k: 'B', t: 'Short greeting', r: 89, b: 71, w: true }].map((v) => (
          <Card key={v.k} className={cn('p-6', v.w && 'border-ok ring-2 ring-ok/20')}><div className="flex items-center justify-between"><h3 className="font-semibold">Prompt {v.k}: {v.t}</h3>{v.w && <Badge tone="green"><Trophy size={12} />Winner</Badge>}</div>
            <div className="mt-5 space-y-4"><div><div className="mb-1 flex justify-between text-sm"><span>Callers helped</span><span className="num font-medium">{v.r}%</span></div><Progress value={v.r} /></div><div><div className="mb-1 flex justify-between text-sm"><span>Booked an appointment</span><span className="num font-medium">{v.b}%</span></div><Progress value={v.b} /></div></div></Card>))}</div>
          <p className="mt-4 text-soft">Prompt B helped 8% more callers over 200 test calls.</p></TabPanel>
      </Tabs>
    </>
  )
}

export default function TestingPage() {
  return USE_MOCKS ? <DemoTestingPage /> : <TestingReal />
}
