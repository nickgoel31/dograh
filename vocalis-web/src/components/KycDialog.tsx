import * as React from 'react'
import { FileCheck2, ShieldCheck, Upload } from '@/components/icons'
import { toast } from 'sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Dialog, Field, Input, Select } from './ui'
import { http } from '@/lib/api/http'

export type Kyc = { required_for: string[]; status: 'none' | 'submitted' | 'approved' | 'rejected'; note?: string | null; data: Record<string, string>; documents: { kind: string; label: string; name: string }[]; submitted_at?: string | null; auto?: boolean }

export const useKyc = (enabled = true) => useQuery({ queryKey: ['kyc'], queryFn: () => http<Kyc>('/kyc'), enabled })

const DOCS = [['pan', 'PAN card', true], ['address_proof', 'Address proof (utility bill, rent agreement, bank statement)', true], ['business_proof', 'Business registration (company, partnership or shop licence)', false], ['gst', 'GST certificate', false]] as const

const toB64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = () => rej(new Error('We could not read that file.')); r.readAsDataURL(f) })

/** Identity verification for buying numbers where the carrier requires it. */
export function KycDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const k = useKyc(open)
  const [f, setF] = React.useState<Record<string, string>>({ business_type: 'company', pan: '' })
  const [files, setFiles] = React.useState<Record<string, File | null>>({})
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => { if (k.data?.data && Object.keys(k.data.data).length) setF((x) => ({ ...x, ...k.data!.data, pan: '' })) }, [k.data])
  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [key]: e.target.value })
  const have = new Set((k.data?.documents ?? []).map((d) => d.kind))
  const locked = k.data?.status === 'approved'
  const biz = !!k.data?.auto && (f.business_type === 'company' || f.business_type === 'partnership')
  const need = biz && (!(files.business_proof || have.has('business_proof')) || !(files.gst || have.has('gst')) || !(f.gstin ?? '').trim()) || ['business_name', 'contact_name', 'contact_email', 'contact_phone', 'address', 'city', 'state', 'postal_code', 'pan'].some((x) => !(f[x] ?? '').trim()) || !(files.pan || have.has('pan')) || !(files.address_proof || have.has('address_proof'))
  const send = async () => {
    setBusy(true)
    try {
      const documents = await Promise.all(Object.entries(files).filter(([, v]) => v).map(async ([kind, file]) => ({ kind, name: file!.name, mime: file!.type, data_b64: await toB64(file!) })))
      await http('/kyc', { method: 'PUT', json: { ...f, gstin: f.gstin || null, documents } })
      toast.success('Sent! We will review it and let you know.'); qc.invalidateQueries({ queryKey: ['kyc'] }); onClose()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'We could not send that.') } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} wide title="Verify your identity" description="Phone companies require this before numbers in India can be switched on. We send it for you and show the answer here, usually within a day or two.">
      <div className="space-y-4">
        {k.data?.status === 'approved' && <p className="flex items-center gap-2 rounded-xl border border-ok/25 bg-ok/10 px-4 py-3 text-sm text-ok"><ShieldCheck size={16} />You're verified. You can buy numbers.</p>}
        {k.data?.status === 'submitted' && <p className="rounded-xl border border-warn/25 bg-warn/10 px-4 py-3 text-sm text-warn">Under review. You can send updated details below if something was wrong.</p>}
        {k.data?.status === 'rejected' && <p className="rounded-xl border border-bad/25 bg-bad/10 px-4 py-3 text-sm text-bad"><b>Needs changes:</b> {k.data.note}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Business or your full name"><Input value={f.business_name ?? ''} disabled={locked} onChange={set('business_name')} /></Field>
          <Field label="Type"><Select value={f.business_type} disabled={locked} onChange={set('business_type')}><option value="individual">Individual</option><option value="sole_proprietor">Sole proprietor</option><option value="partnership">Partnership</option><option value="company">Company</option></Select></Field>
          <Field label="Contact person"><Input value={f.contact_name ?? ''} disabled={locked} onChange={set('contact_name')} /></Field>
          <Field label="Contact phone"><Input value={f.contact_phone ?? ''} disabled={locked} onChange={set('contact_phone')} placeholder="+91…" /></Field>
          <Field label="Contact email"><Input type="email" value={f.contact_email ?? ''} disabled={locked} onChange={set('contact_email')} /></Field>
          <Field label="PAN" hint={<span className="text-xs text-soft">{k.data?.data?.pan ? `On file: ${k.data.data.pan}. Enter it again to change.` : 'Like ABCDE1234F'}</span>}><Input value={f.pan ?? ''} disabled={locked} maxLength={10} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} /></Field>
          <Field label="GST number (optional)"><Input value={f.gstin ?? ''} disabled={locked} maxLength={15} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} /></Field>
          <div />
          <Field label="Address" ><Input value={f.address ?? ''} disabled={locked} onChange={set('address')} /></Field>
          <Field label="City"><Input value={f.city ?? ''} disabled={locked} onChange={set('city')} /></Field>
          <Field label="State"><Input value={f.state ?? ''} disabled={locked} onChange={set('state')} /></Field>
          <Field label="PIN code"><Input value={f.postal_code ?? ''} disabled={locked} onChange={set('postal_code')} /></Field>
        </div>
        <div className="space-y-2">
          <div className="text-[13px] font-medium">Documents (PDF, JPG or PNG, up to 2.5 MB each)</div>
          {DOCS.map(([kind, label, must0]) => { const must = must0 || (biz && (kind === 'business_proof' || kind === 'gst')); return (

            <label key={kind} className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition hover:bg-muted/50">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">{files[kind] || have.has(kind) ? <FileCheck2 size={16} /> : <Upload size={16} />}</span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{label} {must ? <Badge tone="orange">Required</Badge> : null}</span><span className="block truncate text-xs text-soft">{files[kind]?.name ?? (have.has(kind) ? 'Already uploaded. Choose a file to replace it.' : 'Choose a file')}</span></span>
              <input type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" disabled={locked} onChange={(e) => setFiles({ ...files, [kind]: e.target.files?.[0] ?? null })} />
            </label>
          ) })}
        </div>
        <Button variant="primary" className="w-full" disabled={locked || busy || need} onClick={send}>{busy ? 'Sending…' : k.data?.status === 'none' || !k.data ? 'Send for review' : 'Send again'}</Button>
        <p className="text-xs text-soft">Your documents are used only to verify you with the phone company and are never shown to other customers.</p>
      </div>
    </Dialog>
  )
}
