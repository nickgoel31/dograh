import * as React from 'react'
import { toast } from 'sonner'
import { useQuery } from '@tanstack/react-query'
import { Button, Dialog, Field, Input, Select, Textarea } from './ui'
import { CopyButton } from './shared'
import { http } from '@/lib/api/http'

type Carrier = { id: string; name: string; auto: boolean; inbound_url: string; fields: { key: string; label: string; secret: boolean; optional: boolean }[] }

/** Use a phone number the customer already owns, with their own carrier account. */
export function BringNumber({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const q = useQuery({ queryKey: ['carriers'], queryFn: () => http<Carrier[]>('/numbers/carriers'), enabled: open })
  const [id, setId] = React.useState('twilio')
  const [number, setNumber] = React.useState('')
  const [d, setD] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const c = q.data?.find((x) => x.id === id)
  const missing = !number || (c?.fields ?? []).some((f) => !f.optional && !(d[f.key] ?? '').trim())
  const go = async () => {
    setBusy(true)
    try { await http('/numbers/bring', { method: 'POST', json: { carrier: id, number: number.replace(/[\s()-]/g, ''), details: d } }); toast.success('Number connected!'); setD({}); onDone(); onClose() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'We could not connect that number.') } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Bring your own number" description="Keep your number with your own carrier or phone system. Incoming calls reach your agent, and you pay your carrier directly.">
      <div className="space-y-3">
        <Field label="Your carrier"><Select value={id} onChange={(e) => { setId(e.target.value); setD({}) }}>{(q.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
        <Field label="Your number" hint={<span className="text-xs text-soft">With the country code, like +14155550123</span>}><Input value={number} onChange={(e) => setNumber(e.target.value)} /></Field>
        {c?.fields.map((f) => (
          <Field key={f.key} label={f.label + (f.optional ? ' (optional)' : '')}>
            {f.key === 'private_key' ? <Textarea className="min-h-[90px] font-mono text-xs" autoComplete="off" value={d[f.key] ?? ''} onChange={(e) => setD({ ...d, [f.key]: e.target.value })} />
              : <Input type={f.secret ? 'password' : 'text'} autoComplete="off" value={d[f.key] ?? ''} onChange={(e) => setD({ ...d, [f.key]: e.target.value })} />}
          </Field>
        ))}
        {c && !c.auto && (
          <div className="rounded-lg bg-muted p-3 text-[13px] text-soft">
            <div className="mb-1 font-medium text-ink">One step on your side</div>
            In {c.name}, set the incoming-call (answer) address for this number to:
            <div className="mt-2 flex items-center gap-2"><code className="min-w-0 flex-1 break-all rounded bg-surface px-2 py-1 text-xs text-ink">{c.inbound_url}</code><CopyButton text={c.inbound_url} /></div>
          </div>
        )}
        <Button variant="primary" className="w-full" disabled={busy || missing} onClick={go}>{busy ? 'Connecting…' : 'Connect my number'}</Button>
        <p className="text-xs text-soft">{c?.auto ? `We check the details with ${c.name} and set this number's incoming-call address for you.` : 'We save these details and check them where the carrier allows. Removing the number here never touches your carrier.'}</p>
      </div>
    </Dialog>
  )
}
