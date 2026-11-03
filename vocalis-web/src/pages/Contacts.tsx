import * as React from 'react'
import { Link } from 'react-router-dom'
import { Ban, Download, Pencil, Search, Trash2 } from '@/components/icons'
import { toast } from 'sonner'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Card, Dialog, Field, Input, Tab, TabPanel, Tabs, TabsList, Textarea } from '@/components/ui'
import { EmptyState, PageHeader, SearchPill, TableSkeleton } from '@/components/shared'
import { API_URL } from '@/lib/api/env'
import { http } from '@/lib/api/http'
import { useUI } from '@/store/ui'

interface Contact { id: string; phone: string; name: string | null; notes: string | null; tags: string[]; calls: number; last_call: string | null; blocked: boolean }
interface Blocked { id: string; phone: string; reason: string; added: string }
const say = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
const REASON: Record<string, string> = { added: 'Added by you', imported: 'Imported', asked: 'Asked not to be called' }

export default function ContactsPage() {
  const qc = useQueryClient()
  const { mode, workspaceId } = useUI()
  const [q, setQ] = React.useState('')
  const [dq, setDq] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [edit, setEdit] = React.useState<Contact | null>(null)
  const [f, setF] = React.useState({ name: '', notes: '', tags: '' })
  const [numbers, setNumbers] = React.useState('')
  React.useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1) }, 250); return () => clearTimeout(t) }, [q])
  const list = useQuery({ queryKey: ['contacts', dq, page], queryFn: () => http<{ contacts: Contact[]; total: number }>(`/contacts?page=${page}&limit=25${dq ? `&q=${encodeURIComponent(dq)}` : ''}`) })
  const blocked = useQuery({ queryKey: ['blocked'], queryFn: () => http<Blocked[]>('/contacts/blocked') })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['contacts'] }); qc.invalidateQueries({ queryKey: ['blocked'] }) }
  const save = useMutation({ mutationFn: () => http(`/contacts/${edit!.id}`, { method: 'PATCH', json: { name: f.name, notes: f.notes, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean) } }), onSuccess: () => { setEdit(null); refresh(); toast.success('Saved') }, onError: say })
  const add = useMutation({ mutationFn: (n: string) => http<{ added: number; skipped: number }>('/contacts/blocked', { method: 'POST', json: { numbers: n } }), onSuccess: (r) => { toast.success(`${r.added} added to your do-not-call list`); setNumbers(''); refresh() }, onError: say })
  const unblock = useMutation({ mutationFn: (id: string) => http(`/contacts/blocked/${id}`, { method: 'DELETE' }), onSuccess: refresh, onError: say })
  const open = (c: Contact) => { setEdit(c); setF({ name: c.name ?? '', notes: c.notes ?? '', tags: c.tags.join(', ') }) }
  const exportCsv = async () => {
    const res = await fetch(`${API_URL}/contacts/export/csv`, { credentials: 'include', headers: { 'X-Environment': mode, ...(workspaceId ? { 'X-Workspace': workspaceId } : {}) } })
    if (!res.ok) return say(new Error('We could not export your contacts.'))
    const url = URL.createObjectURL(await res.blob())
    Object.assign(document.createElement('a'), { href: url, download: 'contacts.csv' }).click(); URL.revokeObjectURL(url)
  }
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / 25))

  return (
    <>
      <PageHeader title="Contacts" subtitle="Everyone your agents have talked to." actions={<Button onClick={exportCsv}><Download size={15} />Export CSV</Button>} />
      <Tabs defaultValue="all"><TabsList><Tab value="all">All contacts</Tab><Tab value="dnc">Do not call{blocked.data?.length ? ` (${blocked.data.length})` : ''}</Tab></TabsList>
        <TabPanel value="all">
          <SearchPill className="mb-4 max-w-sm" placeholder="Search name, number or notes" label="Search contacts" value={q} onChange={setQ} />
          {list.isPending ? <TableSkeleton rows={6} /> : list.data?.contacts.length === 0 ? <EmptyState emoji="👥" title="No contacts yet" text="People show up here after your agent talks to them on the phone." /> : (
            <Card className="overflow-hidden"><table className="w-full text-sm"><thead className="border-b bg-muted/50 text-left text-xs text-soft"><tr>{['Contact', 'Calls', 'Last call', 'Tags', ''].map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr></thead>
              <tbody>{list.data?.contacts.map((c) => (
                <tr key={c.id} className="border-b last:border-0 hover:bg-muted/40"><td className="px-4 py-3"><div className="font-medium">{c.name ?? c.phone}{c.blocked && <Badge tone="red" className="ml-2"><Ban size={11} />Do not call</Badge>}</div>{c.name && <div className="num text-xs text-soft">{c.phone}</div>}{c.notes && <div className="mt-0.5 line-clamp-1 text-xs text-soft">{c.notes}</div>}</td>
                  <td className="num px-4 py-3"><Link to={`/conversations?q=${encodeURIComponent(c.phone)}`} className="text-accent hover:underline">{c.calls}</Link></td>
                  <td className="px-4 py-3 text-soft">{c.last_call ? new Date(c.last_call).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{c.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div></td>
                  <td className="px-4 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => open(c)} aria-label={`Edit ${c.name ?? c.phone}`}><Pencil size={14} /></Button></td></tr>))}</tbody></table>
              <div className="flex items-center justify-between border-t p-3 text-sm text-soft"><span>{list.data?.total} contacts</span><div className="flex items-center gap-2"><Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>{page} / {pages}</span><Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div></div></Card>)}
        </TabPanel>
        <TabPanel value="dnc">
          <Card className="mb-4 p-5"><h3 className="font-semibold">Never call these numbers</h3>
            <p className="mb-3 text-[13px] text-soft">Campaigns skip every number on this list. Anyone who tells your agent to stop calling is added automatically.</p>
            <Textarea value={numbers} onChange={(e) => setNumbers(e.target.value)} placeholder="+919876543210, +919812345678 (one per line, or paste a column)" aria-label="Numbers to add" />
            <Button className="mt-3" variant="primary" disabled={numbers.trim().length < 3 || add.isPending} onClick={() => add.mutate(numbers)}>Add to the list</Button></Card>
          {blocked.data?.length === 0 ? <p className="text-sm text-soft">Nobody is on your do-not-call list yet.</p> : (
            <Card className="divide-y">{blocked.data?.map((b) => <div key={b.id} className="flex items-center justify-between p-3 text-sm"><div><div className="num font-medium">{b.phone}</div><div className="text-xs text-soft">{REASON[b.reason] ?? b.reason} · {new Date(b.added).toLocaleDateString()}</div></div>
              <Button size="sm" variant="ghost" aria-label={`Remove ${b.phone}`} onClick={() => unblock.mutate(b.id)}><Trash2 size={14} /></Button></div>)}</Card>)}
        </TabPanel>
      </Tabs>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit?.name ?? edit?.phone ?? ''} description={edit?.phone}>
        <div className="space-y-3"><Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Anything worth remembering" /></Field>
          <Field label="Tags" hint={<span className="text-xs text-soft">Separate with commas</span>}><Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="vip, follow-up" /></Field>
          <div className="flex justify-between"><Button onClick={() => edit && add.mutate(edit.phone)} disabled={edit?.blocked}><Ban size={14} />Never call</Button><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>Save</Button></div></div>
      </Dialog>
    </>
  )
}
