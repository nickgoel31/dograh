import * as React from 'react'
import { toast } from 'sonner'
import { Button, Dialog, Field, Input, Select } from './ui'
import { http } from '@/lib/api/http'

/** Use a phone number the customer already owns on their own Twilio or Plivo account. */
export function BringNumber({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [f, setF] = React.useState({ carrier: 'twilio', number: '', account_id: '', auth_token: '' })
  const [busy, setBusy] = React.useState(false)
  const twilio = f.carrier === 'twilio'
  const go = async () => {
    setBusy(true)
    try { await http('/numbers/bring', { method: 'POST', json: { ...f, number: f.number.replace(/[\s()-]/g, '') } }); toast.success('Number connected!'); setF({ ...f, auth_token: '' }); onDone(); onClose() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'We could not connect that number.') } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Bring your own number" description="Keep your number with your own Twilio or Plivo account. We point its incoming calls at your agent. It stays yours, and you pay your carrier directly.">
      <div className="space-y-3">
        <Field label="Your carrier"><Select value={f.carrier} onChange={(e) => setF({ ...f, carrier: e.target.value })}><option value="twilio">Twilio</option><option value="plivo">Plivo</option></Select></Field>
        <Field label="Your number" hint={<span className="text-xs text-soft">With the country code, like +14155550123</span>}><Input value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></Field>
        <Field label={twilio ? 'Account SID' : 'Auth ID'}><Input autoComplete="off" value={f.account_id} onChange={(e) => setF({ ...f, account_id: e.target.value })} /></Field>
        <Field label="Auth token"><Input type="password" autoComplete="off" value={f.auth_token} onChange={(e) => setF({ ...f, auth_token: e.target.value })} /></Field>
        <Button variant="primary" className="w-full" disabled={busy || !f.number || !f.account_id || !f.auth_token} onClick={go}>{busy ? 'Connecting…' : 'Connect my number'}</Button>
        <p className="text-xs text-soft">We check the details with {twilio ? 'Twilio' : 'Plivo'}, and change only this number's incoming-call address. Removing the number here never deletes it from your carrier.</p>
      </div>
    </Dialog>
  )
}
