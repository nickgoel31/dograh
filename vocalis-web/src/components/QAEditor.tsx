import * as React from 'react'
import { MessageCircleQuestion, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, Textarea } from './ui'
import { http } from '@/lib/api/http'
import { toAgent } from '@/lib/api/agents'
import { useData } from '@/store/data'
import type { Agent } from '@/mock/types'
import type { components } from '@/lib/api/schema'

type Pair = { q: string; a: string }

/** Questions the agent should always answer the same way. They are added to the agent's global prompt, so every step of a call can use them. */
export function QAEditor({ agent }: { agent: Agent }) {
  const upsert = useData((s) => s.upsertAgent)
  const saved = React.useMemo<Pair[]>(() => (((agent.style as { qa?: Pair[] } | undefined)?.qa) ?? []), [agent.style])
  const [rows, setRows] = React.useState<Pair[]>(saved)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => setRows(saved), [saved, agent.id])
  const dirty = JSON.stringify(rows.filter((r) => r.q.trim() && r.a.trim())) !== JSON.stringify(saved)
  const set = (i: number, p: Partial<Pair>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)))
  const save = async () => {
    setBusy(true)
    try {
      const out = await http<components['schemas']['AgentOut']>(`/agents/${agent.id}`, { method: 'PATCH', json: { style: { qa: rows.filter((r) => r.q.trim() && r.a.trim()) } }, headers: { 'If-Match': String(agent.version ?? 0) } })
      upsert(toAgent(out, agent)); toast.success('Saved. Go live again for real calls to use it.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'We could not save that.') } finally { setBusy(false) }
  }
  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent ring-1 ring-inset ring-accent/15"><MessageCircleQuestion size={17} /></span>
          <div><h3 className="font-semibold">Questions and answers</h3><p className="text-[13px] text-soft">Things callers often ask, with the answer you want given. The agent can use them at any point in the call.</p></div></div>
        <div className="flex gap-2"><Button onClick={() => setRows([...rows, { q: '', a: '' }])}><Plus size={14} />Add a question</Button><Button variant="primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button></div>
      </div>
      {rows.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed p-8 text-center text-sm text-soft">No questions yet. Add the ones you answer all day, like opening hours, prices, parking or how to book.</div>
      ) : (
        <div className="mt-5 space-y-3">
          {rows.map((r, i) => (
            <div key={i} className="rounded-xl border bg-muted/30 p-3">
              <div className="flex items-start gap-2">
                <div className="grid flex-1 gap-2 md:grid-cols-2">
                  <Textarea className="min-h-[72px]" placeholder="When a caller asks… (e.g. What are your opening hours?)" aria-label="Question" maxLength={300} value={r.q} onChange={(e) => set(i, { q: e.target.value })} />
                  <Textarea className="min-h-[72px]" placeholder="The agent answers… (e.g. We are open 9 to 6, Monday to Saturday.)" aria-label="Answer" maxLength={1200} value={r.a} onChange={(e) => set(i, { a: e.target.value })} />
                </div>
                <Button size="icon" variant="ghost" className="text-bad" aria-label="Remove this question" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={15} /></Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-soft">{rows.filter((r) => r.q.trim() && r.a.trim()).length} of 60 used. These are kept in the agent's global prompt, which every step of the call reads. For long documents, use the Knowledge tab instead.</p>
    </Card>
  )
}
