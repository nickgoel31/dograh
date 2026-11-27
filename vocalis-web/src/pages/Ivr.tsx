import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Card, Dialog, Field, Input, Select, Switch, Textarea } from '@/components/ui'
import { EmptyState, PageHeader, StatCard, TableSkeleton } from '@/components/shared'
import { ArrowRight, Check, Phone, Plus, Trash2 } from '@/components/icons'
import { http } from '@/lib/api/http'
import { ivrApi, type Ivr, type IvrFlow, type IvrNode, type IvrSettings, type IvrStep } from '@/lib/api/ivr'
import { cn, money } from '@/lib/utils'
import { IvrFlowEditor, StepEditor, removeStep, TYPE, type Change } from '@/components/IvrFlowEditor'

const say = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const OUTCOME: Record<string, string> = { time_limit: 'Cut at the time limit', menu: 'Hung up in the menu', transferred: 'Transferred', agent: 'AI agent', voicemail: 'Voicemail', hangup: 'Finished' }
const mins = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`)
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')
const rate = (n: number) => '₹' + n.toFixed(2)
const perUnit = (pulse: number, perMin: number) => (pulse === 30 ? `${rate(perMin / 2)} per 30 seconds` : `${rate(perMin)} per minute`)

/* ---------------- overview ---------------- */
export function IvrOverviewPage() {
  const qc = useQueryClient()
  const nav = useNavigate()
  const list = useQuery({ queryKey: ['ivrs'], queryFn: ivrApi.list })
  const stats = useQuery({ queryKey: ['ivr-overview'], queryFn: ivrApi.overview })
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [starter, setStarter] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const create = async () => {
    setBusy(true)
    try { const r = await ivrApi.create(name.trim() || 'Main menu', starter); qc.invalidateQueries({ queryKey: ['ivrs'] }); nav(`/ivr/${r.id}`) } catch (e) { say(e) } finally { setBusy(false) }
  }
  const o = stats.data?.outcomes ?? {}
  return (
    <>
      <PageHeader title="Swarvo IVR" subtitle="Phone menus that answer every call: press 1 for sales, 2 for support, or let an AI agent take over." actions={<Button variant="primary" onClick={() => setOpen(true)}><Plus size={15} />New menu</Button>} />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Menus" value={stats.data?.menus ?? 0} loading={stats.isPending} />
        <StatCard label="Calls answered" value={stats.data?.calls ?? 0} loading={stats.isPending} />
        <StatCard label="Reached an AI agent" value={o.agent ?? 0} loading={stats.isPending} />
        <StatCard label="Spent on IVR" value={money(stats.data?.spent ?? 0)} loading={stats.isPending} />
      </div>
      {list.isPending ? <TableSkeleton rows={3} /> : !list.data?.length ? (
        <EmptyState emoji="☎️" title="Build your first phone menu" text="Greet callers, route them by key press or voice, check your opening hours, take voicemail or pass the call to an AI agent. It takes a few minutes." action={<Button variant="primary" onClick={() => setOpen(true)}><Plus size={15} />New menu</Button>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.data.map((m) => (
            <Link key={m.id} to={`/ivr/${m.id}`}>
              <Card className="p-5 transition hover:bg-muted/40">
                <div className="flex items-center justify-between gap-2"><div className="truncate text-[15px] font-semibold">{m.name}</div><Badge>{m.status === 'live' ? 'Live' : m.status === 'paused' ? 'Paused' : 'Draft'}</Badge></div>
                <div className="mt-2 text-[13px] text-soft">{Object.keys(m.flow.nodes ?? {}).length} steps · {m.calls} calls</div>
                <div className="mt-1 text-[13px] text-soft">{m.numbers.length ? `Answers ${m.numbers.join(', ')}` : 'Not connected to a number yet'}</div>
                {m.problems.length > 0 && <div className="mt-2 text-[12.5px] text-bad">{m.problems[0]}</div>}
              </Card>
            </Link>))}
        </div>)}
      <Dialog open={open} onOpenChange={setOpen} title="New menu" description="You can change everything afterwards.">
        <div className="space-y-4">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Front desk" autoFocus /></Field>
          <label className="flex items-start gap-3 text-sm"><Switch checked={starter} onChange={setStarter} label="Start with an example" /><span><b>Start with an example</b><br /><span className="text-soft">Open or closed, then press 1 for sales, 2 for support, 3 for voicemail.</span></span></label>
          <Button variant="primary" className="w-full" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create menu'}</Button>
        </div>
      </Dialog>
    </>
  )
}

/* ---------------- builder ---------------- */
type Agent = { id: string; name: string; status: string }

function Tester({ ivr, flow, dirty }: { ivr: Ivr; flow: IvrFlow; dirty: boolean }) {
  const [log, setLog] = React.useState<{ who: 'menu' | 'you'; text: string }[]>([])
  const [cur, setCur] = React.useState<IvrStep['then'] | null>(null)
  const [tries, setTries] = React.useState(0)
  const [word, setWord] = React.useState('')
  const [open, setOpen] = React.useState(true)
  const [phone, setPhone] = React.useState(() => { try { return localStorage.getItem('ivr-test-number') ?? '' } catch { return '' } })
  const [mine, setMine] = React.useState(false)
  const [calling, setCalling] = React.useState(false)
  const run = async (b: Parameters<typeof ivrApi.simulate>[1], youSaid?: string) => {
    try {
      const r = await ivrApi.simulate(ivr.id, { open, ...b })
      const heard = [...r.say, ...(r.then.prompt ? [r.then.prompt] : [])]
      const extra = r.then.kind === 'dial' ? [`📞 Calling ${r.then.number}…`] : r.then.kind === 'agent' ? ['🤖 An AI agent takes over the call.'] : r.then.kind === 'record' ? ['🎙️ Beep. Recording a message…'] : r.then.kind === 'hangup' ? ['Call ended.'] : []
      setLog((l) => [...l, ...(youSaid ? [{ who: 'you' as const, text: youSaid }] : []), ...[...heard, ...extra].map((t) => ({ who: 'menu' as const, text: t }))])
      setCur(r.then); setTries(r.then.tries ?? 0)
    } catch (e) { say(e) }
  }
  const start = () => { setLog([]); setCur(null); void run({}) }
  const callMe = async () => {
    setCalling(true)
    try { await ivrApi.testCall(ivr.id, phone, mine); try { localStorage.setItem('ivr-test-number', phone) } catch { /* private window */ } toast.success('Calling you now. Pick up to hear your menu.') } catch (e) { say(e) } finally { setCalling(false) }
  }
  const waiting = cur?.kind === 'gather'
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3"><div><div className="text-[14px] font-semibold">Get a real call</div><p className="mt-0.5 text-xs text-soft">We ring your phone and play this menu, so you hear exactly what callers hear.</p></div></div>
        <div className="mt-3 space-y-2.5">
          <Input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" aria-label="Your phone number" />
          <label className="flex items-start gap-2 text-xs text-soft"><input type="checkbox" className="mt-0.5" checked={mine} onChange={(e) => setMine(e.target.checked)} />This is my own number</label>
          <Button variant="primary" className="w-full" disabled={calling || !mine || phone.replace(/\D/g, '').length < 8 || dirty} onClick={callMe}><Phone size={14} />{calling ? 'Calling…' : 'Call me'}</Button>
          {dirty && <p className="text-xs text-soft">Save your changes first. The call plays the saved menu.</p>}
          <p className="text-[11.5px] leading-snug text-soft">Billed like any menu call. It rings from one of your own phone numbers; if you have none yet, get one in Phone Numbers.</p>
        </div>
      </Card>
      <Card className="p-4">
        <div className="flex items-center justify-between"><div className="text-[14px] font-semibold">Try it here, free</div><label className="flex items-center gap-2 text-xs text-soft"><Switch checked={open} onChange={setOpen} label="Pretend we are open" />We are open</label></div>
        <p className="mt-1 text-xs text-soft">Press keys on the screen. No phone call. Uses the saved menu.</p>
        <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto rounded-xl bg-muted/40 p-3 text-[13px]" aria-live="polite">
          {log.length === 0 && <span className="text-soft">Press “Start”.</span>}
          {log.map((m, i) => <div key={i} className={m.who === 'you' ? 'text-right font-medium text-accent' : ''}>{m.text}</div>)}
        </div>
        {!cur || cur.kind !== 'gather' ? <Button className="mt-3 w-full" variant="secondary" onClick={start}><Phone size={14} />{log.length ? 'Start again' : 'Start'}</Button> : (
          <div className="mt-3 space-y-2">
            {cur.digits && <div className="grid grid-cols-6 gap-1.5">{['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '*', '#'].map((d) => <Button key={d} size="sm" variant="secondary" onClick={() => run({ node: cur.node, digits: d, tries }, `Pressed ${d}`)}>{d}</Button>)}</div>}
            {cur.speech && <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (word.trim()) { void run({ node: cur.node, speech: word, tries }, `“${word}”`); setWord('') } }}><Input value={word} onChange={(e) => setWord(e.target.value)} placeholder="Say something…" /><Button type="submit" variant="secondary">Say</Button></form>}
            <Button size="sm" variant="ghost" className="w-full" onClick={() => run({ node: cur.node, tries }, 'Said nothing')}>Say nothing</Button>
          </div>)}
        {!waiting && cur && <div className="mt-2 text-center text-xs text-soft">{cur.kind === 'hangup' ? 'The call has ended.' : 'The call carries on outside this test.'}</div>}
        <span className="sr-only">{Object.keys(flow.nodes).length} steps</span>
      </Card>
    </div>
  )
}

/** "Cut the call after ..." : a number with a seconds or minutes choice. Stored in seconds; empty means no limit. */
export function CallLimit({ seconds, onChange, max = 14400, min = 10, alwaysOn }: { seconds: number | null; onChange: (s: number | null) => void; max?: number; min?: number; alwaysOn?: boolean }) {
  const [unit, setUnit] = React.useState<'s' | 'm'>(seconds && seconds % 60 === 0 ? 'm' : 's')
  const on = seconds != null || !!alwaysOn
  const shown = seconds == null ? '' : unit === 'm' ? String(seconds / 60) : String(seconds)
  const set = (raw: string, u = unit) => { const n = Math.round(Number(raw) * (u === 'm' ? 60 : 1)); onChange(raw === '' || !Number.isFinite(n) ? null : Math.min(max, Math.max(min, n))) }
  return (
    <div>
      <div className="mb-2 flex items-center justify-between"><span className="text-[13px] font-medium">Cut the call automatically after a set time</span>{!alwaysOn && <Switch checked={on} onChange={(v) => onChange(v ? 300 : null)} label="Cut calls after a set time" />}</div>
      {on && <div className="flex gap-2"><Input type="number" min={1} value={shown} onChange={(e) => set(e.target.value)} aria-label="Time" /><Select value={unit} onChange={(e) => { const u = e.target.value as 's' | 'm'; setUnit(u); set(u === 'm' ? String(Math.max(1, Math.round((seconds ?? 300) / 60))) : String(seconds ?? 300), u) }} className="w-32"><option value="s">seconds</option><option value="m">minutes</option></Select></div>}
      <p className="mt-1 text-xs text-soft">{on ? 'Callers hear a short goodbye, then the call ends. Transfers and voicemail never run past it.' : 'No limit: calls last until the caller hangs up.'}</p>
    </div>
  )
}

function SettingsPanel({ s, onChange, locked }: { s: IvrSettings; onChange: (p: Partial<IvrSettings>) => void; locked?: boolean }) {
  const opts = useQuery({ queryKey: ['ivr-options'], queryFn: ivrApi.options, staleTime: 600000 })
  const h = s.hours ?? { enabled: false, tz: 'Asia/Kolkata', windows: [{ days: [0, 1, 2, 3, 4], start: '09:00', end: '18:00' }], closed_message: '' }
  const w = h.windows[0] ?? { days: [0, 1, 2, 3, 4], start: '09:00', end: '18:00' }
  const setH = (p: Partial<typeof h>, wp?: Partial<typeof w>) => onChange({ hours: { ...h, ...p, windows: [{ ...w, ...(wp ?? {}) }] } })
  const price = (p: number) => opts.data?.pricing.find((x) => x.pulse === p)?.per_minute
  return (
    <Card className="space-y-4 p-4">
      <div className="text-[14px] font-semibold">Voice, hours and billing</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Voice"><Select value={s.voice} onChange={(e) => onChange({ voice: e.target.value })}>{(opts.data?.voices ?? [{ id: s.voice, label: s.voice, languages: [] }]).map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</Select></Field>
        <Field label="Language"><Select value={s.language} onChange={(e) => onChange({ language: e.target.value })}>{Object.entries(opts.data?.languages ?? { [s.language]: s.language }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
      </div>
      <Field label={locked ? 'How you are billed (set by Swarvo for your account)' : 'How you are billed'}>
        <div className="grid gap-2 sm:grid-cols-2">
          {([60, 30] as const).map((p) => (
            <button key={p} type="button" disabled={locked} onClick={() => onChange({ pulse: p })} aria-pressed={s.pulse === p} className={cn('rounded-xl border p-3 text-left text-sm transition', s.pulse === p ? 'border-accent bg-accent-soft' : 'hover:bg-muted/40')}>
              <div className="flex items-center justify-between font-medium">{p === 60 ? 'Per minute' : 'Per 30 seconds'}{s.pulse === p && <Check size={14} />}</div>
              <div className="mt-0.5 text-xs text-soft">{price(p) != null ? perUnit(p, price(p)!) : ''} · {p === 60 ? 'Rounded up to the next minute' : 'Rounded up to the next 30 seconds. Cheaper for short calls.'}</div>
            </button>))}
        </div>
      </Field>
      <CallLimit seconds={s.max_seconds ?? null} onChange={(v) => onChange({ max_seconds: v })} />
      <div>
        <div className="mb-2 flex items-center justify-between"><span className="text-[13px] font-medium">Business hours <span className="font-normal text-soft">(used by “Open or closed?” steps)</span></span><Switch checked={h.enabled} onChange={(v) => setH({ enabled: v })} label="Use business hours" /></div>
        {h.enabled && <div className="space-y-3">
          <div className="flex flex-wrap gap-2">{DAYS.map((d, i) => <button key={d} type="button" aria-pressed={w.days.includes(i)} onClick={() => setH({}, { days: w.days.includes(i) ? w.days.filter((x) => x !== i) : [...w.days, i].sort() })} className={cn('rounded-md border px-2.5 py-1 text-sm', w.days.includes(i) ? 'border-accent bg-accent-soft text-accent' : 'text-soft')}>{d}</button>)}</div>
          <div className="grid grid-cols-3 gap-3"><Field label="Opens"><Input type="time" value={w.start} onChange={(e) => setH({}, { start: e.target.value })} /></Field><Field label="Closes"><Input type="time" value={w.end} onChange={(e) => setH({}, { end: e.target.value })} /></Field>
            <Field label="Time zone"><Select value={h.tz} onChange={(e) => setH({ tz: e.target.value })}>{['Asia/Kolkata', 'UTC', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney'].map((z) => <option key={z}>{z}</option>)}</Select></Field></div>
        </div>}
      </div>
    </Card>
  )
}

export function IvrBuilderPage() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const nav = useNavigate()
  const q = useQuery({ queryKey: ['ivr', id], queryFn: () => ivrApi.get(id) })
  const agentsQ = useQuery({ queryKey: ['agents-min'], queryFn: () => http<Agent[]>('/agents'), staleTime: 60000 })
  const [flow, setFlow] = React.useState<IvrFlow | null>(null)
  const [settings, setSettings] = React.useState<IvrSettings | null>(null)
  const [name, setName] = React.useState('')
  const [dirty, setDirty] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [selected, setSelected] = React.useState('')
  const [tab, setTab] = React.useState<'step' | 'try' | 'settings'>('try')
  React.useEffect(() => { if (q.data && !dirty) { setFlow(q.data.flow); setSettings(q.data.settings); setName(q.data.name) } }, [q.data, dirty])
  if (q.isPending || !flow || !settings || !q.data) return <TableSkeleton rows={4} />
  const ivr = q.data
  const agents = agentsQ.data ?? []
  const cur = flow.nodes[selected] ? selected : flow.start
  const change: Change = (fn) => { const c = structuredClone(flow); const r = fn(c); setFlow(c); setDirty(true); return r }
  const pick = (k: string) => { setSelected(k); setTab('step') }
  const save = async () => {
    setBusy(true)
    try { const r = await ivrApi.change(id, { name, flow, settings }); qc.setQueryData(['ivr', id], r); setDirty(false); qc.invalidateQueries({ queryKey: ['ivrs'] }); toast.success('Saved') } catch (e) { say(e) } finally { setBusy(false) }
  }
  const go = async (status: 'live' | 'paused') => {
    try { if (dirty) await save(); const r = await ivrApi.status(id, status); qc.setQueryData(['ivr', id], r); qc.invalidateQueries({ queryKey: ['ivrs'] }); toast.success(status === 'live' ? 'Your menu is live' : 'Paused') } catch (e) { say(e) }
  }
  const del = async () => { if (!window.confirm('Delete this menu? Numbers that use it will stop answering.')) return; try { await ivrApi.remove(id); qc.invalidateQueries({ queryKey: ['ivrs'] }); nav('/ivr') } catch (e) { say(e) } }
  const issues = dirty ? [] : ivr.problems
  const TABS = [['step', 'Step'], ['try', 'Try it'], ['settings', 'Settings']] as const
  return (
    <>
      <PageHeader title={name || 'Menu'} subtitle={ivr.numbers.length ? `Answers ${ivr.numbers.join(', ')}` : 'Connect a number in Phone Numbers to start taking calls.'}
        actions={<div className="flex flex-wrap items-center gap-2"><Badge>{ivr.status === 'live' ? 'Live' : ivr.status === 'paused' ? 'Paused' : 'Draft'}</Badge>
          <Button variant="secondary" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}</Button>
          {ivr.status === 'live' ? <Button variant="secondary" onClick={() => go('paused')}>Pause</Button> : <Button variant="primary" onClick={() => go('live')}>Go live</Button>}</div>} />
      {issues.length > 0 && <div className="mb-4 rounded-xl border border-bad/30 bg-bad/5 p-3 text-[13px] text-bad">{issues.map((m) => <div key={m}>{m}</div>)}</div>}
      <div className="grid gap-5 xl:grid-cols-[1fr_390px]">
        <div className="min-w-0 space-y-4">
          <Field label="Menu name"><Input value={name} onChange={(e) => { setName(e.target.value); setDirty(true) }} /></Field>
          <IvrFlowEditor flow={flow} agents={agents} selected={cur} onSelect={pick} onChange={change} />
        </div>
        <div className="space-y-3 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:self-start xl:overflow-y-auto">
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted/60 p-1" role="tablist">
            {TABS.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('rounded-lg px-3 py-1.5 text-[13px] font-medium transition', tab === k ? 'bg-surface shadow-sm' : 'text-soft hover:text-ink')}>{label}</button>)}
          </div>
          {tab === 'step' && <Card className="p-4"><StepEditor id={cur} flow={flow} agents={agents} onChange={change} onRemove={(k) => { if (removeStep(change, k)) setSelected(flow.start) }} /></Card>}
          {tab === 'try' && <Tester ivr={ivr} flow={flow} dirty={dirty} />}
          {tab === 'settings' && <><SettingsPanel locked={ivr.pulse_locked} s={settings} onChange={(p) => { setSettings({ ...settings, ...p }); setDirty(true) }} /><Button variant="ghost" className="w-full text-bad" onClick={del}>Delete this menu</Button></>}
        </div>
      </div>
    </>
  )
}

/* ---------------- calls ---------------- */
export function IvrCallsPage() {
  const q = useQuery({ queryKey: ['ivr-calls'], queryFn: () => ivrApi.calls() })
  return (
    <>
      <PageHeader title="IVR calls" subtitle="Every call into your menus: the path the caller took, voicemails and what it cost." />
      {q.isPending ? <TableSkeleton rows={4} /> : !q.data?.length ? <EmptyState emoji="📞" title="No calls yet" text="When a number connected to a menu gets a call, it shows up here." /> : (
        <Card className="divide-y">
          {q.data.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
              <div className="min-w-0"><div className="font-medium">{c.from || 'Unknown caller'} <span className="text-soft">→ {c.ivr}</span></div>
                <div className="text-xs text-soft">{when(c.started)} · {mins(c.seconds)} · {OUTCOME[c.outcome] ?? c.outcome}</div></div>
              <div className="flex items-center gap-3">{c.voicemail_url && <audio controls preload="none" src={c.voicemail_url} className="h-8 max-w-[220px]" />}<span className="num text-soft">{c.billed ? money(c.cost) : 'Not billed yet'}</span></div>
            </div>))}
        </Card>)}
    </>
  )
}

/* ---------------- pricing ---------------- */
export function IvrPricingPage() {
  const o = useQuery({ queryKey: ['ivr-options'], queryFn: ivrApi.options })
  return (
    <>
      <PageHeader title="IVR pricing" subtitle="You pay for the time callers spend in your menus. Calls that an AI agent takes over are billed at your normal agent rate from that moment." />
      <div className="grid gap-4 md:grid-cols-2">
        {[{ p: 60, t: 'Per minute', d: 'Every started minute counts as a full minute.' }, { p: 30, t: 'Per 30 seconds', d: 'Every started 30 seconds counts. Best for short calls and quick menus.' }].map((x) => (
          <Card key={x.p} className="p-5"><div className="text-sm text-soft">{x.t}</div><div className="num mt-1 text-3xl font-semibold">{o.data ? rate((o.data.pricing.find((r) => r.pulse === x.p)?.per_minute ?? 0) / (x.p === 30 ? 2 : 1)) : '…'}<span className="text-base font-normal text-soft"> {x.p === 30 ? '/ 30 seconds' : '/ minute'}</span></div><p className="mt-2 text-[13px] text-soft">{x.d}</p></Card>))}
      </div>
      <p className="mt-4 text-sm text-soft">Choose how you are billed for each menu, in the menu’s settings. Free minutes and your wallet work the same as for agent calls. Playing with “Try it” in the builder is free.</p>
    </>
  )
}
