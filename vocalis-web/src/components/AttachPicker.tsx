import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui'
import { http } from '@/lib/api/http'
import type { components } from '@/lib/api/schema'

type Item = { id: string; title: string; note: string }

/** Tick the knowledge sources or tools an agent may use. Saves as you tick. */
export function AttachPicker({ kind, agentId }: { kind: 'knowledge' | 'tools'; agentId: string }) {
  const qc = useQueryClient()
  const key = ['attach', kind, agentId]
  const items = useQuery({
    queryKey: [...key, 'items'],
    queryFn: async (): Promise<Item[]> => kind === 'knowledge'
      ? (await http<components['schemas']['DocOut'][]>('/knowledge')).filter((d) => d.status === 'ready').map((d) => ({ id: d.id, title: d.title, note: d.kind }))
      : (await http<components['schemas']['ToolOut'][]>('/tools')).map((t) => ({ id: t.id, title: t.name, note: t.description })),
  })
  const attached = useQuery({ queryKey: [...key, 'on'], queryFn: () => http<string[]>(`/${kind}/agent/${agentId}`) })
  const [busy, setBusy] = React.useState(false)
  const on = attached.data ?? []
  const toggle = async (id: string) => {
    const next = on.includes(id) ? on.filter((x) => x !== id) : [...on, id]
    setBusy(true)
    try {
      qc.setQueryData([...key, 'on'], await http<string[]>(`/${kind}/agent/${agentId}`, { method: 'PUT', json: kind === 'knowledge' ? { document_ids: next } : { tool_ids: next } }))
      qc.invalidateQueries({ queryKey: ['agent-versions'] })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'We could not save that.') } finally { setBusy(false) }
  }
  if (items.isPending) return <p className="text-sm text-soft">Loading…</p>
  if (!items.data?.length) return <p className="text-sm text-soft">{kind === 'knowledge' ? 'Nothing to choose from yet. ' : 'You haven’t made any tools yet. '}<Link className="text-accent underline" to={kind === 'knowledge' ? '/knowledge' : '/tools'}>{kind === 'knowledge' ? 'Add knowledge' : 'Make a tool'}</Link></p>
  return (
    <div className="space-y-2">{items.data.map((i) => (
      <label key={i.id} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 hover:bg-muted">
        <input type="checkbox" checked={on.includes(i.id)} disabled={busy} onChange={() => toggle(i.id)} />
        <span className="flex-1"><span className="font-medium">{i.title}</span>{kind === 'tools' && <span className="block text-[13px] text-soft">{i.note}</span>}</span>
        {kind === 'knowledge' && <Badge>{i.note}</Badge>}
      </label>))}
      <p className="text-xs text-soft">Changes apply to your test copy straight away. They go live with “Go live”.</p></div>
  )
}
