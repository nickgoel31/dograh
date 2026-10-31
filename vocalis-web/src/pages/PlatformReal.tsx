/** Real Developers, Team & Settings and Help. Demo versions stay in Developers.tsx and SettingsHelp.tsx for mock mode. */
import * as React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, Plus, Search, Send, Sparkles, Trash2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Card, Chip, Dialog, Field, Input, Select, Switch, Tab, TabPanel, Tabs, TabsList, Textarea } from '@/components/ui'
import { CodeBlock, ConfirmDialog, CopyButton, PageHeader, Row, TableSkeleton } from '@/components/shared'
import { platformApi as P, type Hook } from '@/lib/api/platform'
import { API_URL, BASE } from '@/lib/api/env'
import { useMe } from '@/lib/useMe'
import { useData } from '@/store/data'
import { useUI } from '@/store/ui'
import { BRAND } from '@/config/brand'

const say = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
const apiBase = () => (API_URL.startsWith('http') ? API_URL : `${window.location.origin}${API_URL}`)
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—')
const can = (perms: string[] | undefined, p: string) => !!perms?.includes(p)

/* ---------------- Developers ---------------- */
function Hooks() {
  const qc = useQueryClient()
  const hooks = useQuery({ queryKey: ['hooks'], queryFn: P.hooks })
  const events = useQuery({ queryKey: ['hook-events'], queryFn: P.events })
  const [open, setOpen] = React.useState(false)
  const [url, setUrl] = React.useState('')
  const [evs, setEvs] = React.useState<string[]>(['call.started', 'call.ended'])
  const [secret, setSecret] = React.useState<Hook | null>(null)
  const [sel, setSel] = React.useState<Hook | null>(null)
  const [del, setDel] = React.useState<Hook | null>(null)
  const refresh = () => { qc.invalidateQueries({ queryKey: ['hooks'] }); qc.invalidateQueries({ queryKey: ['deliveries'] }) }
  const add = useMutation({ mutationFn: () => P.createHook(url, evs), onSuccess: (h) => { setOpen(false); setUrl(''); setSecret(h); refresh() }, onError: say })
  const deliveries = useQuery({ queryKey: ['deliveries', sel?.id], queryFn: () => P.deliveries(sel!.id), enabled: !!sel })
  const test = useMutation({ mutationFn: (id: string) => P.testHook(id), onSuccess: (d) => { d.status === 'ok' ? toast.success('Test message delivered') : toast.error(d.error ?? 'Your server did not accept the test message'); refresh() }, onError: say })
  const resend = useMutation({ mutationFn: (id: string) => P.resend(id), onSuccess: (d) => { d.status === 'ok' ? toast.success('Sent again') : toast.error(d.error ?? 'Still failing'); refresh() }, onError: say })
  const check = useMutation({ mutationFn: P.sendNow, onSuccess: (r) => { toast.success(r.queued || r.sent ? `${r.queued} new, ${r.sent} sent` : 'Nothing new to send'); refresh() }, onError: say })
  const header = events.data?.signature_header
  return (
    <>
      <Card className="p-6">
        <Row><div><h3 className="font-semibold">Webhooks</h3><p className="text-[13px] text-soft">We send a signed message to your web address when something happens.</p></div>
          <div className="flex gap-2"><Button size="sm" onClick={() => check.mutate()} disabled={check.isPending}>Check for new events</Button><Button variant="primary" size="sm" onClick={() => setOpen(true)}><Plus size={14} />Add webhook</Button></div></Row>
        <div className="mt-4 space-y-2">
          {hooks.isPending ? <TableSkeleton rows={2} /> : hooks.data?.length === 0 ? <p className="text-sm text-soft">No webhooks yet.</p> : hooks.data?.map((h) => (
            <div key={h.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              <code className="min-w-0 flex-1 truncate text-sm">{h.url}</code>
              {h.failing && <Badge tone="red"><AlertTriangle size={12} />Failing</Badge>}
              <span className="text-xs text-soft">{h.events.join(', ')}</span>
              <Button size="sm" variant="ghost" onClick={() => test.mutate(h.id)}><Send size={13} />Send test</Button>
              <Button size="sm" variant="ghost" onClick={() => setSel(h)}>Deliveries</Button>
              <Button size="sm" variant="ghost" aria-label="Delete webhook" onClick={() => setDel(h)}><Trash2 size={14} /></Button>
            </div>))}
        </div>
        {header && <p className="mt-4 text-xs text-soft">Each message carries a <code>{header}</code> header: <code>t=&lt;time&gt;,v1=&lt;HMAC-SHA256 of "time.body" using your signing secret&gt;</code>. Failed messages are retried for about 15 hours.</p>}
      </Card>
      <Dialog open={open} onOpenChange={setOpen} title="Add a webhook">
        <Field label="Web address" hint="Must start with https://"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/voice" /></Field>
        <div className="mb-2 mt-4 text-[13px] font-medium">Tell me when…</div>
        <div className="flex flex-wrap gap-2">{events.data?.events.map((e) => (
          <span key={e.name} title={e.note ?? undefined} className={e.available ? '' : 'opacity-50'}>
            <Chip active={evs.includes(e.name)} onClick={() => e.available && setEvs(evs.includes(e.name) ? evs.filter((x) => x !== e.name) : [...evs, e.name])}>{e.name}{e.available ? '' : ' (soon)'}</Chip></span>))}</div>
        <Button variant="primary" className="mt-5 w-full" disabled={!url || !evs.length || add.isPending} onClick={() => add.mutate()}>Add webhook</Button>
      </Dialog>
      <Dialog open={!!secret} onOpenChange={(o) => !o && setSecret(null)} title="Your signing secret" description="Copy it now. For safety we only show it once.">
        <CodeBlock code={secret?.secret ?? ''} /><div className="mt-3 flex justify-end"><CopyButton text={secret?.secret ?? ''} /></div>
      </Dialog>
      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)} side title="Deliveries" description={sel?.url}>
        {deliveries.isPending ? <TableSkeleton rows={4} /> : deliveries.data?.length === 0 ? <p className="text-sm text-soft">Nothing sent yet.</p> : (
          <table className="w-full text-sm"><tbody>{deliveries.data?.map((d) => (
            <tr key={d.id} className="border-b last:border-0"><td className="py-2 font-mono text-xs">{d.event}</td><td><Badge tone={d.status === 'ok' ? 'green' : d.status === 'failed' ? 'red' : 'orange'}>{d.status}</Badge></td>
              <td className="text-xs text-soft">{d.error ?? (d.response_code ? `HTTP ${d.response_code}` : '')}{d.status === 'pending' && d.next_attempt ? ` · retry ${when(d.next_attempt)}` : ''}</td>
              <td className="text-right"><Button size="sm" variant="ghost" onClick={() => resend.mutate(d.id)}>Resend</Button></td></tr>))}</tbody></table>)}
      </Dialog>
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Delete this webhook?" text="We stop sending messages to this address." confirm="Delete" danger
        onConfirm={() => del && P.deleteHook(del.id).then(() => { toast.success('Deleted'); refresh() }).catch(say)} />
    </>
  )
}

export function DevelopersReal() {
  const qc = useQueryClient()
  const mode = useUI((s) => s.mode)
  const perms = useMe().data?.permissions
  const agents = useData((s) => s.agents)
  const keys = useQuery({ queryKey: ['keys', mode], queryFn: P.keys, enabled: can(perms, 'api_keys.manage') })
  const logs = useQuery({ queryKey: ['api-logs', mode], queryFn: P.logs, enabled: can(perms, 'api_keys.manage') })
  const [name, setName] = React.useState('')
  const [made, setMade] = React.useState<string | null>(null)
  const [ask, setAsk] = React.useState<string | null>(null)
  const [lang, setLang] = React.useState('curl')
  const [agent, setAgent] = React.useState('')
  const create = useMutation({ mutationFn: () => P.createKey(name || 'My key'), onSuccess: (k) => { setMade(k.key); setName(''); qc.invalidateQueries({ queryKey: ['keys'] }) }, onError: say })
  const live = agents.filter((a) => a.status === 'live')
  const base = apiBase()
  const sample = '<YOUR_KEY>'
  const snippets: Record<string, string> = {
    curl: `curl ${base}/public/calls \\\n  -H "Authorization: Bearer ${sample}"`,
    node: `const res = await fetch('${base}/public/calls', {\n  headers: { Authorization: 'Bearer ${sample}' },\n})\nconsole.log(await res.json())`,
    python: `import requests\n\nr = requests.get('${base}/public/calls', headers={'Authorization': 'Bearer ${sample}'})\nprint(r.json())`,
  }
  const embed = `<script src="${base}/public/widget.js"\n  data-app="${window.location.origin}${BASE}"\n  data-agent="${agent || live[0]?.id || 'AGENT_ID'}" async></script>`
  if (!can(perms, 'api_keys.manage')) return (<><PageHeader title="Developers" subtitle="Connect your own apps." /><Card className="p-8 text-center text-soft">Ask a workspace owner to give you the Developer role to use this page.</Card></>)
  return (
    <>
      <PageHeader title="Developers" subtitle={`Connect your own apps. You're looking at ${mode === 'test' ? 'Test' : 'Live'} data.`} />
      <Card className="mb-6 p-6"><h3 className="font-semibold">Read your calls from your own software</h3>
        <p className="mt-1 text-[13px] text-soft">Available: <code>GET /public/me</code>, <code>/public/agents</code>, <code>/public/calls</code> and <code>/public/calls/&#123;id&#125;</code>. Starting calls from the API is not available yet.</p>
        <Tabs value={lang} onValueChange={setLang} className="mt-4"><TabsList>{[['curl', 'cURL'], ['node', 'Node'], ['python', 'Python']].map(([v, l]) => <Tab key={v} value={v}>{l}</Tab>)}</TabsList>
          {Object.entries(snippets).map(([v, code]) => <TabPanel key={v} value={v}><CodeBlock code={code} /></TabPanel>)}</Tabs></Card>
      <Card className="mb-6 p-6">
        <Row><h3 className="font-semibold">API keys</h3><div className="flex gap-2"><Input className="w-48" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. My server" aria-label="Key name" /><Button variant="primary" onClick={() => create.mutate()} disabled={create.isPending}><Plus size={14} />Create key</Button></div></Row>
        <p className="mt-1 text-[13px] text-soft">{mode === 'test' ? 'Test keys (sk_test_…) see your practice calls.' : 'Live keys (sk_live_…) see your real calls.'} A key is shown once when you create it.</p>
        <div className="mt-4 space-y-2">{keys.isPending ? <TableSkeleton rows={2} /> : keys.data?.length === 0 ? <p className="text-sm text-soft">No keys yet.</p> : keys.data?.map((k) => (
          <div key={k.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3"><Badge tone={k.environment === 'live' ? 'green' : 'orange'}>{k.environment}</Badge><span className="font-medium">{k.name}</span><code className="flex-1 text-sm text-soft">{k.hint}</code>
            <span className="text-xs text-soft">Last used {when(k.last_used)}</span><Button size="sm" variant="ghost" onClick={() => setAsk(k.id)}>Revoke</Button></div>))}</div>
      </Card>
      <Tabs defaultValue="hooks"><TabsList><Tab value="hooks">Webhooks</Tab><Tab value="logs">Request log</Tab><Tab value="widget">Website button</Tab></TabsList>
        <TabPanel value="hooks"><Hooks /></TabPanel>
        <TabPanel value="logs"><Card className="overflow-hidden">{logs.isPending ? <TableSkeleton rows={5} /> : logs.data?.length === 0 ? <p className="p-6 text-sm text-soft">No requests yet.</p> : <table className="w-full text-sm"><tbody>{logs.data?.map((l, i) => (
          <tr key={i} className="border-b last:border-0"><td className="px-5 py-3"><Badge>{l.method}</Badge></td><td className="font-mono text-xs">{l.path}</td><td><Badge tone={l.status < 300 ? 'green' : 'red'}>{l.status}</Badge></td><td className="num text-soft">{l.ms} ms</td><td className="text-xs text-soft">{l.key}</td><td className="px-5 text-right text-soft">{when(l.time)}</td></tr>))}</tbody></table>}</Card></TabPanel>
        <TabPanel value="widget"><Card className="p-6"><h3 className="font-semibold">Add a talk button to your website</h3>
          <p className="mb-3 mt-1 text-[13px] text-soft">Visitors talk to a Live agent from their browser and calls use your Live balance. Add your website under Settings → Privacy first. Only agents that are live work here.</p>
          <Field label="Agent" className="mb-3 max-w-xs"><Select value={agent} onChange={(e) => setAgent(e.target.value)}>{live.length === 0 && <option value="">No live agents yet</option>}{live.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          <CodeBlock code={embed} /></Card></TabPanel></Tabs>
      <Dialog open={!!made} onOpenChange={(o) => !o && setMade(null)} title="Your new key" description="Copy it now. For safety we only show it once."><CodeBlock code={made ?? ''} /><div className="mt-3 flex justify-end"><CopyButton text={made ?? ''} /></div></Dialog>
      <ConfirmDialog open={!!ask} onOpenChange={(o) => !o && setAsk(null)} title="Revoke this key?" text="Apps using it stop working right away." confirm="Revoke" danger
        onConfirm={() => ask && P.revokeKey(ask).then(() => { toast.success('Key revoked'); qc.invalidateQueries({ queryKey: ['keys'] }) }).catch(say)} />
    </>
  )
}

/* ---------------- Team & Settings ---------------- */
const ROLES = ['admin', 'developer', 'viewer']
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function Privacy({ canEdit, isOwner }: { canEdit: boolean; isOwner: boolean }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['privacy'], queryFn: P.settings })
  const [f, setF] = React.useState<{ record_calls: boolean; redact_pii: boolean; retention_days: string; consent: string; origins: string } | null>(null)
  React.useEffect(() => { if (q.data) setF({ record_calls: q.data.record_calls, redact_pii: q.data.redact_pii, retention_days: q.data.retention_days ? String(q.data.retention_days) : '', consent: q.data.consent_announcement ?? '', origins: q.data.widget_origins.join('\n') }) }, [q.data])
  const save = useMutation({
    mutationFn: () => P.saveSettings({ record_calls: f!.record_calls, redact_pii: f!.redact_pii, retention_days: f!.retention_days ? Number(f!.retention_days) : null, consent_announcement: f!.consent || null, widget_origins: f!.origins.split('\n').map((x) => x.trim()).filter(Boolean) }),
    onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['privacy'] }) }, onError: say,
  })
  const [purge, setPurge] = React.useState(false)
  if (!f) return <TableSkeleton rows={4} />
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p })
  return (
    <Card className="space-y-5 p-6">
      <Row><div><div className="font-medium">Show recordings</div><div className="text-[13px] text-soft">Turn off to stop offering audio playback.</div></div><Switch checked={f.record_calls} onChange={(v) => set({ record_calls: v })} label="Show recordings" /></Row>
      <Row><div><div className="font-medium">Hide personal details</div><div className="text-[13px] text-soft">Masks phone numbers, emails and card numbers in transcripts and call lists.</div></div><Switch checked={f.redact_pii} onChange={(v) => set({ redact_pii: v })} label="Hide personal details" /></Row>
      <Field label="Keep recordings and transcripts for (days)" hint="Leave empty to keep them."><Input className="w-40" type="number" min={1} value={f.retention_days} onChange={(e) => set({ retention_days: e.target.value })} /></Field>
      <Field label="What callers hear first on Live calls" hint="Added to the greeting the next time each agent goes live."><Textarea value={f.consent} onChange={(e) => set({ consent: e.target.value })} placeholder="This call may be recorded to help us serve you better." /></Field>
      <Field label="Websites allowed to show your call button" hint="One per line, like https://example.com"><Textarea value={f.origins} onChange={(e) => set({ origins: e.target.value })} /></Field>
      {q.data?.notes?.map((n) => <p key={n} className="text-xs text-soft">{n}</p>)}
      <div className="flex gap-2"><Button variant="primary" disabled={!canEdit || save.isPending} onClick={() => save.mutate()}>Save</Button>
        {isOwner && <Button onClick={() => setPurge(true)}>Clear old data now</Button>}</div>
      <ConfirmDialog open={purge} onOpenChange={setPurge} title="Clear old recordings and transcripts?" text="Anything older than your retention period is removed for good." confirm="Clear now" danger
        onConfirm={() => P.purge().then((r) => toast.success(`${r.cleared} calls cleared`)).catch(say)} />
    </Card>
  )
}

function Security() {
  const qc = useQueryClient()
  const st = useQuery({ queryKey: ['2fa'], queryFn: P.twoFa })
  const [setup, setSetup] = React.useState<{ secret: string; uri: string } | null>(null)
  const [code, setCode] = React.useState('')
  const done = () => { setSetup(null); setCode(''); qc.invalidateQueries({ queryKey: ['2fa'] }) }
  const on = useMutation({ mutationFn: () => P.twoFaEnable(code), onSuccess: () => { toast.success('Two-step sign-in is on'); done() }, onError: say })
  const off = useMutation({ mutationFn: () => P.twoFaDisable(code), onSuccess: () => { toast.success('Two-step sign-in is off'); done() }, onError: say })
  return (
    <Card className="space-y-5 p-6">
      <Row><div><div className="font-medium">Two-step sign-in</div><div className="text-[13px] text-soft">Ask for a 6-digit code from an authenticator app when you sign in.</div></div>
        {st.data?.enabled ? <Badge tone="green">On</Badge> : !setup && <Button size="sm" onClick={() => P.twoFaSetup().then(setSetup).catch(say)}>Turn on</Button>}</Row>
      {setup && !st.data?.enabled && (<div className="space-y-3 rounded-lg border p-4">
        <p className="text-sm">In your authenticator app choose "enter a setup key" and type this key:</p><CodeBlock code={setup.secret} />
        <Field label="Then enter the 6-digit code it shows"><Input className="w-40" inputMode="numeric" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        <Button variant="primary" disabled={code.length < 6 || on.isPending} onClick={() => on.mutate()}>Confirm and turn on</Button></div>)}
      {st.data?.enabled && (<div className="flex items-end gap-2"><Field label="To turn it off, enter a current code"><Input className="w-40" inputMode="numeric" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} /></Field><Button disabled={code.length < 6 || off.isPending} onClick={() => off.mutate()}>Turn off</Button></div>)}
      {['Single sign-on (SSO)', 'IP allowlist'].map((s) => <Row key={s}><div className="font-medium">{s}</div><Badge tone="accent">Coming soon</Badge></Row>)}
    </Card>
  )
}

export function SettingsReal() {
  const qc = useQueryClient()
  const me = useMe().data
  const perms = me?.permissions
  const manage = can(perms, 'team.manage')
  const isOwner = me?.current_workspace.role === 'owner'
  const team = useQuery({ queryKey: ['team'], queryFn: P.team })
  const audit = useQuery({ queryKey: ['audit'], queryFn: P.audit, enabled: manage })
  const subs = useQuery({ queryKey: ['subs'], queryFn: P.subAccounts })
  const [inv, setInv] = React.useState(false)
  const [email, setEmail] = React.useState('')
  const [role, setRole] = React.useState('viewer')
  const [link, setLink] = React.useState<string | null>(null)
  const [sub, setSub] = React.useState('')
  const [rm, setRm] = React.useState<string | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['team'] })
  const invite = useMutation({ mutationFn: () => P.invite(email, role), onSuccess: (i) => { setInv(false); setEmail(''); setLink(`${window.location.origin}${BASE}/invite/${i.token}`); refresh() }, onError: say })
  const addSub = useMutation({ mutationFn: () => P.newSubAccount(sub), onSuccess: () => { toast.success('Sub-account created. Switch to it from the workspace menu.'); setSub(''); qc.invalidateQueries({ queryKey: ['subs'] }); qc.invalidateQueries({ queryKey: ['me'] }) }, onError: say })
  return (
    <>
      <PageHeader title="Team & Settings" subtitle="Who can do what, and how your data is handled." />
      <Tabs defaultValue="members"><TabsList>{[['members', 'Members'], ['audit', 'Audit log'], ['privacy', 'Privacy & compliance'], ['security', 'Security'], ['ws', 'Sub-accounts']].map(([v, l]) => <Tab key={v} value={v}>{l}</Tab>)}</TabsList>
        <TabPanel value="members"><Card className="overflow-hidden"><div className="flex items-center justify-between border-b p-5"><h3 className="font-semibold">Members</h3>{manage && <Button variant="primary" size="sm" onClick={() => setInv(true)}><Plus size={14} />Invite</Button>}</div>
          {team.isPending ? <TableSkeleton rows={4} /> : <table className="w-full text-sm"><tbody>
            {team.data?.members.map((m) => (<tr key={m.id} className="border-b last:border-0"><td className="px-5 py-3"><div className="font-medium">{m.name ?? m.email}{m.you && <span className="ml-2 text-xs text-soft">(you)</span>}</div><div className="text-xs text-soft">{m.email}</div></td>
              <td>{manage && m.role !== 'owner' && !m.you ? <Select className="w-36" value={m.role} aria-label="Role" onChange={(e) => P.setRole(m.id, e.target.value).then(refresh).catch(say)}>{ROLES.map((r) => <option key={r} value={r}>{cap(r)}</option>)}</Select> : <Badge>{cap(m.role)}</Badge>}</td>
              <td className="px-5 text-right">{manage && m.role !== 'owner' && !m.you && <Button size="sm" variant="ghost" onClick={() => setRm(m.id)}>Remove</Button>}</td></tr>))}
            {team.data?.invites.map((i) => (<tr key={i.id} className="border-b bg-muted/30 last:border-0"><td className="px-5 py-3"><div className="font-medium">{i.email}</div><div className="text-xs text-soft">Invited · expires {when(i.expires)}</div></td><td><Badge tone="orange">{cap(i.role)}</Badge></td>
              <td className="px-5 text-right"><Button size="sm" variant="ghost" onClick={() => P.revokeInvite(i.id).then(refresh).catch(say)}>Cancel</Button></td></tr>))}</tbody></table>}</Card>
          <p className="mt-3 text-xs text-soft">Owner: everything. Admin: everything except deleting the workspace. Developer: build agents, keys and webhooks. Viewer: look only.</p></TabPanel>
        <TabPanel value="audit"><Card className="divide-y">{!manage ? <p className="p-6 text-sm text-soft">Only owners and admins can see the audit log.</p> : audit.isPending ? <TableSkeleton rows={5} /> : audit.data?.length === 0 ? <p className="p-6 text-sm text-soft">Nothing yet.</p> : audit.data?.map((a, i) => (
          <div key={i} className="flex justify-between gap-4 p-4 text-sm"><span><b>{a.who ?? 'Someone'}</b> {a.action.replace(/[._]/g, ' ')}{a.target ? ` · ${a.target}` : ''}</span><span className="shrink-0 text-soft">{when(a.time)}</span></div>))}</Card></TabPanel>
        <TabPanel value="privacy"><Privacy canEdit={manage} isOwner={isOwner} /></TabPanel>
        <TabPanel value="security"><Security /></TabPanel>
        <TabPanel value="ws"><Card className="divide-y">{subs.data?.length === 0 && <p className="p-4 text-sm text-soft">No sub-accounts. They are separate workspaces for your own clients.</p>}
          {subs.data?.map((w) => <div key={w.id} className="flex items-center justify-between p-4"><span className="font-medium">{w.name}</span><Badge>Sub-account</Badge></div>)}
          {can(perms, 'workspace.create_child') && <div className="flex gap-2 p-4"><Input className="max-w-xs" value={sub} onChange={(e) => setSub(e.target.value)} placeholder="Client name" aria-label="Sub-account name" /><Button disabled={!sub.trim() || addSub.isPending} onClick={() => addSub.mutate()}><Plus size={14} />New sub-account</Button></div>}</Card>
          <p className="mt-3 text-xs text-soft">Each sub-account has its own agents, numbers and balance. Combined billing is not available yet.</p></TabPanel></Tabs>
      <Dialog open={inv} onOpenChange={setInv} title="Invite a teammate"><Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" /></Field>
        <Field label="Role" className="mt-3"><Select value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.slice().reverse().map((r) => <option key={r} value={r}>{cap(r)}</option>)}</Select></Field>
        <Button variant="primary" className="mt-4 w-full" disabled={!email || invite.isPending} onClick={() => invite.mutate()}>Create invite link</Button></Dialog>
      <Dialog open={!!link} onOpenChange={(o) => !o && setLink(null)} title="Send them this link" description="We don't send emails yet. Share the link yourself. It works once, for 7 days, and only for the email you invited."><CodeBlock code={link ?? ''} /><div className="mt-3 flex justify-end"><CopyButton text={link ?? ''} /></div></Dialog>
      <ConfirmDialog open={!!rm} onOpenChange={(o) => !o && setRm(null)} title="Remove this person?" text="They lose access to this workspace right away." confirm="Remove" danger onConfirm={() => rm && P.removeMember(rm).then(refresh).catch(say)} />
    </>
  )
}

export function AcceptInvite() {
  const { token = '' } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const set = useUI((s) => s.set)
  const [err, setErr] = React.useState<string | null>(null)
  React.useEffect(() => {
    P.acceptInvite(token).then((r) => { set({ workspaceId: r.workspace }); qc.invalidateQueries({ queryKey: ['me'] }); toast.success(`You joined ${r.name}`); nav('/') }).catch((e) => setErr(e instanceof Error ? e.message : 'This invite could not be accepted.'))
  }, [token, nav, qc, set])
  return <Card className="mx-auto mt-16 max-w-md p-8 text-center">{err ? <><p className="text-bad">{err}</p><Button className="mt-4" onClick={() => nav('/')}>Go to {BRAND}</Button></> : <p className="text-soft">Joining the team…</p>}</Card>
}

/* ---------------- Help ---------------- */
export function HelpReal() {
  const [q, setQ] = React.useState('')
  const [dq, setDq] = React.useState('')
  React.useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t) }, [q])
  const arts = useQuery({ queryKey: ['help', dq], queryFn: () => P.articles(dq) })
  const status = useQuery({ queryKey: ['help-status'], queryFn: P.status })
  const [open, setOpen] = React.useState<string | null>(null)
  const [question, setQuestion] = React.useState('')
  const ask = useMutation({ mutationFn: () => P.ask(question), onError: say })
  const [c, setC] = React.useState({ subject: '', body: '' })
  const send = useMutation({ mutationFn: () => P.contact(c.subject, c.body), onSuccess: (r) => { toast.success(r.message); setC({ subject: '', body: '' }) }, onError: say })
  const bad = status.data?.filter((s) => s.state === 'down') ?? []
  return (
    <>
      <PageHeader title="How can we help?" actions={status.data && (bad.length ? <Badge tone="red" className="px-3 py-1.5 text-sm"><AlertTriangle size={14} />Some things are down</Badge> : <Badge tone="green" className="px-3 py-1.5 text-sm"><CheckCircle2 size={14} />Everything we can check is working</Badge>)} />
      <Card className="mb-6 max-w-2xl p-6"><h3 className="flex items-center gap-2 font-semibold"><Sparkles size={16} className="text-accent" />Ask the helper</h3>
        <p className="mt-1 text-[13px] text-soft">It answers from our help pages only.</p>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (question.trim()) ask.mutate() }}><Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. How do I put my agent live?" aria-label="Your question" /><Button variant="primary" disabled={ask.isPending}>{ask.isPending ? 'Thinking…' : 'Ask'}</Button></form>
        {ask.data && <div className="mt-4 rounded-lg bg-muted/50 p-4 text-sm"><p>{ask.data.answer}</p>{!ask.data.from_ai && ask.data.articles.length > 0 && <p className="mt-2 text-xs text-soft">Showing the closest help page.</p>}</div>}</Card>
      <div className="relative mb-6 max-w-xl"><Search size={16} className="absolute left-3 top-3 text-soft" /><Input className="h-11 pl-10" placeholder="Search help…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search help" /></div>
      <div className="grid gap-3 lg:grid-cols-2">{arts.data?.length === 0 ? <p className="text-sm text-soft">Nothing matches. Try other words, or send us a message below.</p> : arts.data?.map((a) => (
        <Card key={a.id} className="p-4"><button className="w-full text-left" onClick={() => setOpen(open === a.id ? null : a.id)}><div className="text-xs text-soft">{a.section}</div><div className="font-medium">{a.title}</div></button>{open === a.id && <p className="mt-2 text-sm text-soft">{a.body}</p>}</Card>))}</div>
      <h2 className="mb-3 mt-10 font-semibold">System status</h2>
      <Card className="max-w-xl divide-y">{status.data?.map((s) => <div key={s.name} className="flex items-center justify-between gap-4 p-3 text-sm"><span><b>{s.name}</b><span className="ml-2 text-soft">{s.detail}</span></span><Badge tone={s.state === 'ok' ? 'green' : s.state === 'down' ? 'red' : 'gray'}>{s.state === 'ok' ? 'Working' : s.state === 'down' ? 'Down' : 'Not set up'}</Badge></div>)}</Card>
      <Card className="mt-10 max-w-xl p-6"><h3 className="font-semibold">Contact support</h3><div className="mt-3 space-y-3">
        <Input placeholder="Subject" aria-label="Subject" value={c.subject} onChange={(e) => setC({ ...c, subject: e.target.value })} />
        <Textarea placeholder="Tell us what's happening…" aria-label="Message" value={c.body} onChange={(e) => setC({ ...c, body: e.target.value })} />
        <Button variant="primary" disabled={!c.subject.trim() || !c.body.trim() || send.isPending} onClick={() => send.mutate()}>Send</Button></div></Card>
    </>
  )
}
