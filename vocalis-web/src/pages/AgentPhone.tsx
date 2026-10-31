import * as React from 'react'
import { Link } from 'react-router-dom'
import { PhoneCall, PhoneForwarded } from 'lucide-react'
import { toast } from 'sonner'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Card, Field, Input, Switch, Textarea } from '@/components/ui'
import { http } from '@/lib/api/http'
import type { components } from '@/lib/api/schema'

type Num = components['schemas']['NumberOut']
const say = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.')

/** The agent's Phone tab: numbers that reach it, hand-over to a person, and a test call to your own phone. */
export function AgentPhone({ agentId, live }: { agentId: string; live: boolean }) {
  const qc = useQueryClient()
  const nums = useQuery({ queryKey: ['numbers'], queryFn: () => http<Num[]>('/numbers') })
  const ho = useQuery({ queryKey: ['handover', agentId], queryFn: () => http<{ enabled: boolean; number: string | null; when: string | null }>(`/tools/handover/${agentId}`) })
  const [form, setForm] = React.useState({ number: '', when: 'The caller asks to speak to a person, or the agent cannot help.' })
  const [phone, setPhone] = React.useState('')
  React.useEffect(() => { if (ho.data?.enabled) setForm({ number: ho.data.number ?? '', when: ho.data.when ?? form.when }) }, [ho.data?.enabled, ho.data?.number]) // eslint-disable-line react-hooks/exhaustive-deps
  const assign = useMutation({ mutationFn: (v: { id: string; to: string | null }) => http(`/numbers/${v.id}/assign`, { method: 'POST', json: { agent_id: v.to } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['numbers'] }), onError: say })
  const saveHo = useMutation({ mutationFn: () => http(`/tools/handover/${agentId}`, { method: 'PUT', json: form }), onSuccess: () => { toast.success('Saved. Go live again to use it on real calls.'); qc.invalidateQueries({ queryKey: ['handover', agentId] }) }, onError: say })
  const offHo = useMutation({ mutationFn: () => http(`/tools/handover/${agentId}`, { method: 'DELETE' }), onSuccess: () => { toast.success('Turned off'); qc.invalidateQueries({ queryKey: ['handover', agentId] }) }, onError: say })
  const callMe = useMutation({ mutationFn: () => http<{ message: string }>(`/agents/${agentId}/call-me`, { method: 'POST', json: { phone } }), onSuccess: (r) => toast.success(r.message), onError: say })

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <h3 className="font-semibold">Phone numbers</h3><p className="mb-3 text-[13px] text-soft">Calls to a number you switch on here are answered by this agent.</p>
        {nums.data?.length === 0 && <p className="text-sm text-soft">You don't have a number yet. <Link to="/numbers" className="font-medium text-accent hover:underline">Get one</Link>.</p>}
        <div className="space-y-2">{nums.data?.map((n) => {
          const mine = n.agent_id === agentId
          return <div key={n.id} className="flex items-center justify-between rounded-lg border p-3"><div><div className="num font-medium">{n.number}</div><div className="text-xs text-soft">{mine ? 'Answered by this agent' : n.agent_name ? `Answered by ${n.agent_name}` : 'Not connected to an agent'}</div></div>
            <Switch checked={mine} onChange={(v) => assign.mutate({ id: n.id, to: v ? agentId : null })} label={`Use ${n.number} for this agent`} /></div>
        })}</div>
      </Card>

      <Card className="p-6">
        <div className="flex items-start gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent"><PhoneForwarded size={17} /></span>
          <div className="flex-1"><h3 className="font-semibold">Hand over to a person</h3><p className="text-[13px] text-soft">When this happens, the agent says it will connect the caller and rings your number. Works on phone calls, not browser practice calls.</p></div>
          {ho.data?.enabled && <Badge tone="green">On</Badge>}</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Ring this number"><Input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="+919876543210" /></Field>
          <Field label="When should it hand over?"><Textarea className="min-h-[44px]" value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} /></Field></div>
        <div className="mt-3 flex gap-2"><Button variant="primary" disabled={!form.number.trim() || saveHo.isPending} onClick={() => saveHo.mutate()}>{ho.data?.enabled ? 'Update' : 'Turn on'}</Button>
          {ho.data?.enabled && <Button onClick={() => offHo.mutate()}>Turn off</Button>}</div>
      </Card>

      <Card className="p-6">
        <div className="flex items-start gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent"><PhoneCall size={17} /></span>
          <div className="flex-1"><h3 className="font-semibold">Hear it on your own phone</h3><p className="text-[13px] text-soft">We'll ring you and your live agent answers, so you hear what callers hear. Billed at your normal per-minute price.</p></div></div>
        {live ? (
          <div className="mt-4 flex max-w-md gap-2"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Your number, e.g. +919876543210" aria-label="Your phone number" />
            <Button variant="primary" disabled={!phone.trim() || callMe.isPending} onClick={() => callMe.mutate()}>{callMe.isPending ? 'Calling…' : 'Call me'}</Button></div>
        ) : <p className="mt-3 text-sm text-soft">Put this agent live first. Until then, use the Talk button to try it in your browser.</p>}
      </Card>
    </div>
  )
}
