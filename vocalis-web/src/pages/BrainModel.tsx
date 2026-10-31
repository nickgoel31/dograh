import * as React from 'react'
import { toast } from 'sonner'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, Field, Select } from '@/components/ui'
import { toAgent } from '@/lib/api/agents'
import { http } from '@/lib/api/http'
import { useData } from '@/store/data'
import type { Agent } from '@/mock/types'
import type { components } from '@/lib/api/schema'

const LEVEL: Record<string, string> = { fast: 'Fast', balanced: 'Balanced', smartest: 'Smartest' }

/** Pick the exact AI model instead of a Fast / Balanced / Smartest level. */
export function BrainModel({ agent }: { agent: Agent }) {
  const upsert = useData((s) => s.upsertAgent)
  const models = useQuery({ queryKey: ['ai-models'], queryFn: () => http<{ id: string; label: string; level: string | null }[]>('/agents/models') })
  const current = String((agent.style as Record<string, unknown> | undefined)?.model ?? '')
  const [pick, setPick] = React.useState(current)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => setPick(current), [current, agent.id])
  const save = async () => {
    setBusy(true)
    try {
      const out = await http<components['schemas']['AgentOut']>(`/agents/${agent.id}`, { method: 'PATCH', json: { style: { model: pick } }, headers: { 'If-Match': String(agent.version ?? 0) } })
      upsert(toAgent(out, agent)); toast.success('Saved. Go live again for real calls to use it.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'We could not save that.') } finally { setBusy(false) }
  }
  return (
    <Card className="mt-6 p-6">
      <h3 className="font-semibold">Exact AI model</h3>
      <p className="mb-4 text-[13px] text-soft">Leave on Automatic to follow the level you picked above, or choose a specific model.</p>
      <div className="flex max-w-lg flex-wrap items-end gap-3">
        <Field label="Model" className="min-w-[260px] flex-1"><Select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="AI model">
          <option value="">Automatic (from the level above)</option>
          {models.data?.map((m) => <option key={m.id} value={m.id}>{m.label}{m.level ? ` · ${LEVEL[m.level]}` : ''}</option>)}</Select></Field>
        <Button variant="primary" disabled={busy || pick === current} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </Card>
  )
}
