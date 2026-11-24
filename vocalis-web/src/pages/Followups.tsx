import * as React from 'react'
import { toast } from 'sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Card, Dialog, Field, Input, Select, Switch, Textarea } from '@/components/ui'
import { EmptyState, PageHeader, TableSkeleton } from '@/components/shared'
import { Plus } from '@/components/icons'
import { http } from '@/lib/api/http'
import { ivrApi } from '@/lib/api/ivr'
import { followupsApi, type Followup, type FollowupIn } from '@/lib/api/followups'

const say = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
const WHEN: Record<string, string> = {
  any: 'After every call', answered: 'Only when someone was reached', booked: 'When a booking was made', qualified: 'When the caller is a good lead',
  resolved: 'When the call was handled', transferred: 'When the call was passed to a person', voicemail: 'When the caller left a voicemail', 'no-answer': 'When nobody spoke', agent: 'When a menu passed the call to an AI agent',
}
const VAR_HELP: Record<string, string> = { name: "caller's first name", business: 'your business name', agent: 'the agent that answered', caller: "caller's number", payment_link: 'your payment link', summary: 'a one-line summary of the call' }
type Agent = { id: string; name: string }

function Editor({ f, agents, menus, ready, testNumber, onClose, onSaved }: { f: Followup | null; agents: Agent[]; menus: Agent[]; ready: boolean; testNumber: string | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = React.useState(f?.name ?? '')
  const [source, setSource] = React.useState<'all' | 'agent' | 'ivr'>(f?.source ?? 'all')
  const [sourceId, setSourceId] = React.useState(f?.source_id ?? '')
  const [trigger, setTrigger] = React.useState(f?.trigger ?? 'any')
  const [message, setMessage] = React.useState(f?.message ?? '')
  const [link, setLink] = React.useState(f?.link ?? '')
  const [delay, setDelay] = React.useState(String(f?.delay_minutes ?? 0))
  const [cooldown, setCooldown] = React.useState(String(f?.cooldown_hours ?? 24))
  const [consent, setConsent] = React.useState(f?.consent ?? false)
  const [enabled, setEnabled] = React.useState(f?.enabled ?? false)
  const [busy, setBusy] = React.useState(false)
  const status = useQuery({ queryKey: ['followup-status'], queryFn: followupsApi.status, staleTime: 60000 })
  const sends = useQuery({ queryKey: ['followup-sends', f?.id], queryFn: () => followupsApi.sends(f!.id), enabled: !!f })
  const pick = source === 'agent' ? agents : source === 'ivr' ? menus : []
  const body = (): FollowupIn => ({ source, source_id: source === 'all' ? null : sourceId || null, trigger, message, link: link.trim(), delay_minutes: Number(delay) || 0, cooldown_hours: Number(cooldown) || 0, consent })
  const save = async (test = false) => {
    setBusy(true)
    try {
      let id = f?.id
      if (!id) { const r = await followupsApi.create({ name: name.trim() || 'New follow-up', ...body() }); id = r.id }
      await followupsApi.change(id, { name: name.trim() || 'New follow-up', ...body(), enabled })
      if (test) { const r = await followupsApi.test(id); toast.success(`Test sent to your WhatsApp: “${r.preview}”`) } else toast.success('Saved')
      onSaved(); if (!test) onClose()
    } catch (e) { say(e) } finally { setBusy(false) }
  }
  const remove = async () => { if (!f || !window.confirm('Delete this follow-up?')) return; try { await followupsApi.remove(f.id); onSaved(); onClose() } catch (e) { say(e) } }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} side title={f ? 'Edit follow-up' : 'New follow-up'} description="A WhatsApp message sent after a call.">
      <div className="space-y-5 overflow-y-auto pb-4">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Thank you + booking link" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Which calls"><Select value={source} onChange={(e) => { setSource(e.target.value as 'all' | 'agent' | 'ivr'); setSourceId('') }}><option value="all">All my calls</option><option value="agent">One AI voice agent</option><option value="ivr">One phone menu (IVR)</option></Select></Field>
          {source !== 'all' && <Field label={source === 'agent' ? 'Agent' : 'Menu'}><Select value={sourceId} onChange={(e) => setSourceId(e.target.value)}><option value="">Choose…</option>{pick.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="When to send"><Select value={trigger} onChange={(e) => setTrigger(e.target.value)}>{Object.entries(WHEN).filter(([k]) => source === 'agent' ? k !== 'agent' : true).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Wait after the call (minutes)"><Input type="number" min={0} max={1440} value={delay} onChange={(e) => setDelay(e.target.value)} /></Field>
        </div>
        <Field label="Message">
          <Textarea rows={4} value={message} maxLength={600} onChange={(e) => setMessage(e.target.value)} placeholder="Hi {name}, thanks for calling {business}! Here is the link to book: https://…" />
          <div className="mt-2 flex flex-wrap gap-1.5">{(status.data?.variables ?? Object.keys(VAR_HELP)).map((v) => <button key={v} type="button" title={VAR_HELP[v]} onClick={() => setMessage((m) => `${m}${m && !m.endsWith(' ') ? ' ' : ''}{${v}}`)} className="rounded-md border px-2 py-0.5 text-xs text-soft hover:bg-muted hover:text-ink">{`{${v}}`}</button>)}</div>
          <p className="mt-1.5 text-xs text-soft">For menus, what a caller typed can be used too, by the name you gave it in the “Call it” box of an “Ask for a number” step, like {'{account}'}. Click a word to add it.</p>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Link to add (optional)"><Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" /></Field>
          <Field label="Same person at most once every (hours)"><Input type="number" min={0} max={720} value={cooldown} onChange={(e) => setCooldown(e.target.value)} /></Field>
        </div>
        <label className="flex items-start gap-3 rounded-xl border p-3 text-sm">
          <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span><b>Callers are told they will get this message.</b><br /><span className="text-soft">WhatsApp only allows messages to people who expect them. Say it in your agent’s greeting or your menu, for example “We’ll send you the details on WhatsApp.” People on your do-not-call list are never messaged.</span></span>
        </label>
        <div className="flex items-center justify-between rounded-xl border p-3"><div><div className="text-[13px] font-medium">Send these messages</div><p className="text-xs text-soft">{consent ? 'Turn off any time.' : 'Confirm the box above first.'}</p></div><Switch checked={enabled} onChange={setEnabled} label="Send these messages" /></div>
        {!ready && <div className="rounded-xl border border-bad/30 bg-bad/5 p-3 text-[13px] text-bad">WhatsApp sending isn’t switched on for the platform yet, so nothing will go out until it is. Please contact support.</div>}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" className="flex-1" disabled={busy} onClick={() => save()}>{busy ? 'Saving…' : 'Save'}</Button>
          <Button variant="secondary" disabled={busy || !testNumber} title={testNumber ? undefined : 'Your own WhatsApp number must be verified first'} onClick={() => save(true)}>Send me a test{testNumber ? ` (${testNumber})` : ''}</Button>
          {f && <Button variant="ghost" className="text-bad" onClick={remove}>Delete</Button>}
        </div>
        {f && <div><div className="mb-2 text-[13px] font-medium">Recent messages</div>
          {sends.isPending ? <TableSkeleton rows={2} /> : !sends.data?.length ? <p className="text-sm text-soft">Nothing sent yet.</p> : (
            <div className="divide-y rounded-xl border text-[13px]">{sends.data.map((s, i) => <div key={i} className="flex items-center justify-between gap-3 px-3 py-2"><span className="num">{s.phone}</span><span className="text-soft">{s.status === 'sent' ? 'Sent' : s.status === 'failed' ? 'Failed' : `Skipped: ${s.reason}`}</span></div>)}</div>)}
        </div>}
      </div>
    </Dialog>
  )
}

export function FollowupsPage() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['followups'], queryFn: followupsApi.list })
  const status = useQuery({ queryKey: ['followup-status'], queryFn: followupsApi.status })
  const agents = useQuery({ queryKey: ['agents-min'], queryFn: () => http<Agent[]>('/agents'), staleTime: 60000 })
  const menus = useQuery({ queryKey: ['ivrs'], queryFn: ivrApi.list })
  const [edit, setEdit] = React.useState<Followup | 'new' | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['followups'] })
  const toggle = async (f: Followup, on: boolean) => { try { await followupsApi.change(f.id, { enabled: on }); refresh() } catch (e) { say(e) } }
  return (
    <>
      <PageHeader title="WhatsApp follow-ups" subtitle="Send a message on WhatsApp after a call: a thank-you, a booking link, a payment link or a summary. Works for AI voice agents and phone menus." actions={<Button variant="primary" onClick={() => setEdit('new')}><Plus size={15} />New follow-up</Button>} />
      {status.data && !status.data.whatsapp_ready && <div className="mb-4 rounded-xl border border-bad/30 bg-bad/5 p-3 text-[13px] text-bad">WhatsApp sending isn’t switched on for the platform yet, so follow-ups won’t go out. Please contact support.</div>}
      {list.isPending ? <TableSkeleton rows={3} /> : !list.data?.length ? (
        <EmptyState emoji="💬" title="No follow-ups yet" text="Pick an agent or a phone menu, write a message, and it goes out on WhatsApp after each call. You can send yourself a test first." action={<Button variant="primary" onClick={() => setEdit('new')}><Plus size={15} />New follow-up</Button>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.data.map((f) => (
            <Card key={f.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <button type="button" onClick={() => setEdit(f)} className="min-w-0 text-left"><div className="truncate text-[15px] font-semibold">{f.name}</div>
                  <div className="mt-0.5 text-[13px] text-soft">{f.source === 'all' ? 'All calls' : f.source === 'agent' ? `Agent: ${f.source_name ?? ''}` : `Menu: ${f.source_name ?? ''}`} · {WHEN[f.trigger] ?? f.trigger}</div></button>
                <Switch checked={f.enabled} onChange={(v) => toggle(f, v)} label={`Send “${f.name}”`} />
              </div>
              <p className="mt-3 line-clamp-2 text-[13px] text-soft">{f.message || 'No message yet'}</p>
              <div className="mt-3 flex items-center gap-2 text-xs text-soft"><Badge>{f.sent} sent</Badge>{f.failed > 0 && <Badge>{f.failed} failed</Badge>}{f.delay_minutes > 0 && <span>after {f.delay_minutes} min</span>}</div>
            </Card>))}
        </div>)}
      {edit && <Editor f={edit === 'new' ? null : edit} agents={agents.data ?? []} menus={(menus.data ?? []).map((m) => ({ id: m.id, name: m.name }))} ready={!!status.data?.whatsapp_ready} testNumber={status.data?.test_number ?? null} onClose={() => setEdit(null)} onSaved={refresh} />}
    </>
  )
}
