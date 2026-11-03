import * as React from 'react'
import { CalendarCheck } from '@/components/icons'
import { toast } from 'sonner'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Card, Field, Input } from '@/components/ui'
import { http } from '@/lib/api/http'

/** Let agents book appointments on the customer's Cal.com calendar. */
export function CalendarCard() {
  const qc = useQueryClient()
  const st = useQuery({ queryKey: ['calendar'], queryFn: () => http<{ connected: boolean; event_type_id: number | null; timezone: string | null }>('/integrations/calendar') })
  const [open, setOpen] = React.useState(false)
  const [f, setF] = React.useState({ api_key: '', event_type_id: '', timezone: 'Asia/Kolkata' })
  const done = () => { qc.invalidateQueries({ queryKey: ['calendar'] }); qc.invalidateQueries({ queryKey: ['tools'] }) }
  const say = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
  const connect = useMutation({ mutationFn: () => http('/integrations/calendar', { method: 'PUT', json: { ...f, event_type_id: Number(f.event_type_id) } }), onSuccess: () => { toast.success('Connected. Two tools were added: attach them to an agent.'); setOpen(false); setF({ ...f, api_key: '' }); done() }, onError: say })
  const remove = useMutation({ mutationFn: () => http('/integrations/calendar', { method: 'DELETE' }), onSuccess: () => { toast.success('Disconnected'); done() }, onError: say })
  const on = st.data?.connected
  return (
    <Card className="mb-6 p-5">
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent"><CalendarCheck size={22} /></span>
        <div className="min-w-0 flex-1"><div className="flex items-center gap-2 font-semibold">Appointment booking with Cal.com {on && <Badge tone="green">Connected</Badge>}</div>
          <p className="text-[13px] text-soft">Your agent checks free times and books the caller into your calendar while talking. Google Calendar and Calendly can be linked to Cal.com.</p></div>
        {on ? <Button onClick={() => remove.mutate()}>Disconnect</Button> : <Button variant="primary" onClick={() => setOpen(!open)}>Connect</Button>}
      </div>
      {open && !on && (
        <div className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-3">
          <Field label="Cal.com API key" hint={<span className="text-xs text-soft">Cal.com → Settings → Developer → API keys</span>}><Input type="password" value={f.api_key} onChange={(e) => setF({ ...f, api_key: e.target.value })} autoComplete="off" /></Field>
          <Field label="Event type number" hint={<span className="text-xs text-soft">The number in the event's web address</span>}><Input inputMode="numeric" value={f.event_type_id} onChange={(e) => setF({ ...f, event_type_id: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Your time zone"><Input value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></Field>
          <div className="sm:col-span-3"><Button variant="primary" disabled={f.api_key.length < 10 || !f.event_type_id || connect.isPending} onClick={() => connect.mutate()}>{connect.isPending ? 'Checking…' : 'Connect and check'}</Button></div>
        </div>)}
    </Card>
  )
}
