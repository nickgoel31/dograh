import { ApiError, http } from './http'
import type { components } from './schema'
import type { Call } from '@/mock/types'

type CallOut = components['schemas']['CallOut']
type CallDetail = components['schemas']['CallDetail']

const SPLIT_ORDER = ['Speech to text', 'AI brain', 'Voice', 'Phone']

/** Server call -> the shape the Conversations page already renders. */
export function toCall(c: CallOut | CallDetail): Call {
  const d = c as CallDetail
  return {
    id: c.id, time: c.time, caller: c.caller, phone: c.phone ?? '', agentId: c.agent_id ?? '', duration: c.duration,
    outcome: (c.outcome ?? 'resolved') as Call['outcome'],
    inProgress: c.outcome === null,
    sentiment: (c.sentiment ?? null) as Call['sentiment'],
    cost: c.cost, failReason: c.fail_reason ?? undefined,
    turns: (d.turns ?? []).map((t) => ({ who: t.who as 'agent' | 'caller', t: t.t, end: t.end, text: t.text, reply: t.reply != null ? Math.round(t.reply * 1000) : undefined, tool: t.tool ?? undefined })),
    summary: d.summary ?? '', extracted: d.extracted ?? {},
    costSplit: SPLIT_ORDER.map((n) => ({ name: n, value: Number(d.cost_split?.find((s) => s.name === n)?.value ?? 0) })),
    test: c.test, audioUrl: d.audio_url ?? undefined,
  }
}

/** Words to look for inside call transcripts (set by the Conversations page). */
export const callSearch = { text: '' }

export const callsApi = {
  // One page of the newest calls; the page filters within it.
  // `practice` shows calls made from an agent's Talk button; everything else is real calls.
  list: async (practice = false) => (await http<components['schemas']['CallPage']>(`/conversations?limit=100${callSearch.text.trim() ? `&text=${encodeURIComponent(callSearch.text.trim())}` : ''}`, practice ? { headers: { 'X-Environment': 'test' } } : {})).calls.map(toCall),
  // A call might be a practice call, which lives on the private test side: look there if it isn't among the real ones.
  get: async (id: string) => {
    try { return toCall(await http<CallDetail>(`/conversations/${id}`)) } catch (e) {
      if (e instanceof ApiError && e.code === 'call_not_found') return toCall(await http<CallDetail>(`/conversations/${id}`, { headers: { 'X-Environment': 'test' } }))
      throw e
    }
  },
}
