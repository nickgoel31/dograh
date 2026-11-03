import * as React from 'react'
import { Check } from '@/components/icons'
import { toast } from 'sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Card, Dialog, Field, Input } from './ui'
import { http } from '@/lib/api/http'
import { BrandLogo } from './BrandLogo'

type Item = {
  id: string; name: string; blurb: string; connected: boolean; info: string | null; does: string[]
  fields: { key: string; label: string; secret: boolean; hint: string; optional: boolean; value: string }[]
}
const say = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.')

/** Every outside service the workspace can connect, with a form for the details each one needs. */
export function ConnectorGrid() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['connectors'], queryFn: () => http<Item[]>('/connectors') })
  const [open, setOpen] = React.useState<Item | null>(null)
  const [vals, setVals] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const start = (i: Item) => { setVals(Object.fromEntries(i.fields.map((f) => [f.key, f.value]))); setOpen(i) }
  const refresh = () => qc.invalidateQueries({ queryKey: ['connectors'] })
  const save = async () => {
    if (!open) return
    setBusy(true)
    try { await http(`/connectors/${open.id}`, { method: 'PUT', json: { config: vals } }); toast.success(`${open.name} is connected`); setOpen(null); refresh(); qc.invalidateQueries({ queryKey: ['tools'] }) } catch (e) { say(e) } finally { setBusy(false) }
  }
  const remove = async (i: Item) => { if (window.confirm(`Disconnect ${i.name}?`)) try { await http(`/connectors/${i.id}`, { method: 'DELETE' }); refresh(); qc.invalidateQueries({ queryKey: ['tools'] }) } catch (e) { say(e) } }
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {(q.data ?? []).map((i) => (
          <Card key={i.id} className="flex flex-col p-5">
            <div className="flex items-start justify-between">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border bg-white"><BrandLogo id={i.id} name={i.name} size={22} /></div>
              {i.connected && <Badge tone="green"><Check size={11} />Connected</Badge>}
            </div>
            <div className="mt-3 font-medium">{i.name}</div>
            <div className="mt-0.5 flex-1 text-[13px] text-soft">{i.blurb}</div>
            <div className="mt-2 flex flex-wrap gap-1">{i.does.map((d) => <Badge key={d} tone="gray">{d}</Badge>)}</div>
            <div className="mt-4 flex gap-2">
              <Button size="sm" variant={i.connected ? 'secondary' : 'primary'} onClick={() => start(i)}>{i.connected ? 'Edit' : 'Connect'}</Button>
              {i.connected && <Button size="sm" variant="ghost" className="text-bad" onClick={() => remove(i)}>Disconnect</Button>}
            </div>
          </Card>
        ))}
      </div>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={open ? `Connect ${open.name}` : ''} description={open?.blurb}>
        {open && (
          <div className="space-y-3">
            {open.info && <p className="rounded-lg bg-accent-soft p-3 text-sm text-accent">{open.info}</p>}
            {open.fields.map((f) => (
              <Field key={f.key} label={f.label + (f.optional ? ' (optional)' : '')} hint={f.hint ? <span className="text-xs text-soft">{f.hint}</span> : undefined}>
                <Input type={f.secret ? 'password' : 'text'} autoComplete="off" value={vals[f.key] ?? ''} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
              </Field>
            ))}
            <Button variant="primary" className="w-full" disabled={busy} onClick={save}>{busy ? 'Checking…' : 'Check and connect'}</Button>
            <p className="text-xs text-soft">We test the details with {open.name} before saving them.</p>
          </div>
        )}
      </Dialog>
    </>
  )
}
