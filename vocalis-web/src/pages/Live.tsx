import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { PhoneCall, Zap } from '@/components/icons'
import { AgentAvatar } from '@/components/AgentAvatar'
import { Badge, Card } from '@/components/ui'
import { EmptyState, PageHeader } from '@/components/shared'
import { http } from '@/lib/api/http'
import { useUI } from '@/store/ui'
import { fmtDur } from '@/lib/utils'

type Live = { calls: { id: string; caller: string; phone: string | null; agent_id: string | null; agent_name: string | null; started: string; seconds: number; direction: string }[]; now: string }

/** Calls happening right now. The list refreshes by itself; the timers tick every second. */
export default function LivePage() {
  const mode = useUI((s) => s.mode)
  const q = useQuery({ queryKey: ['live', mode], queryFn: () => http<Live>('/live'), refetchInterval: 5000 })
  const [, tick] = React.useState(0)
  React.useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t) }, [])
  const calls = q.data?.calls ?? []
  return (
    <>
      <PageHeader title="Live calls" subtitle={`Calls happening right now in ${mode === 'test' ? 'Test (practice calls)' : 'Live'} mode. This list updates by itself.`}
        actions={<span className="flex items-center gap-2 text-sm text-soft"><span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-ok" /></span>{calls.length} on a call</span>} />
      {q.isPending ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-28 rounded-2xl" />)}</div>
        : q.isError ? <EmptyState emoji="⚠️" title="We could not load live calls" text="Check your connection. We will keep trying." />
        : calls.length === 0 ? <EmptyState emoji="📞" title="No calls right now" text="When a call starts, it appears here within a few seconds. Finished calls move to Conversations." />
        : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {calls.map((c) => {
              const secs = Math.max(0, c.seconds + Math.floor((Date.now() - new Date(q.dataUpdatedAt).getTime()) / 1000))
              return (
                <Card key={c.id} className="rounded-2xl p-5 shadow-none">
                  <div className="flex items-center gap-3">
                    <AgentAvatar id={c.agent_id ?? c.id} className="h-11 w-11"><PhoneCall size={18} /></AgentAvatar>
                    <div className="min-w-0 flex-1"><div className="truncate font-semibold">{c.caller}</div><div className="truncate text-[13px] text-soft">{c.agent_name ?? 'Agent'}{c.phone && c.phone !== c.caller ? ` · ${c.phone}` : ''}</div></div>
                    <Badge tone="green"><Zap size={11} />Live</Badge>
                  </div>
                  <div className="mt-4 flex items-end justify-between"><div><div className="text-xs text-soft">On the call for</div><div className="num text-2xl font-semibold">{fmtDur(secs)}</div></div><Badge>{c.direction === 'outbound' ? 'Outbound' : 'Inbound'}</Badge></div>
                </Card>
              )
            })}
          </div>
        )}
      <p className="mt-6 text-xs text-soft">The words of a call appear under Conversations when it ends.</p>
    </>
  )
}
