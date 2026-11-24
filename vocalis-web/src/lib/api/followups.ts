import { http } from './http'

export type Followup = {
  id: string; name: string; enabled: boolean; source: 'all' | 'agent' | 'ivr'; source_id: string | null; source_name: string | null; trigger: string
  message: string; link: string | null; delay_minutes: number; cooldown_hours: number; consent: boolean; sent: number; failed: number
}
export type FollowupIn = Partial<Omit<Followup, 'id' | 'source_name' | 'sent' | 'failed'>>
export type FollowupStatus = { whatsapp_ready: boolean; test_number: string | null; variables: string[]; triggers: string[]; daily_cap: number }
export type FollowupSend = { phone: string; status: 'sent' | 'failed' | 'skipped'; reason: string; call: string; at: string | null }

export const followupsApi = {
  status: () => http<FollowupStatus>('/followups/status'),
  list: () => http<Followup[]>('/followups'),
  create: (b: FollowupIn & { name: string }) => http<Followup>('/followups', { method: 'POST', json: b }),
  change: (id: string, b: FollowupIn) => http<Followup>(`/followups/${id}`, { method: 'PATCH', json: b }),
  remove: (id: string) => http<void>(`/followups/${id}`, { method: 'DELETE' }),
  test: (id: string) => http<{ ok: boolean; preview: string }>(`/followups/${id}/test`, { method: 'POST' }),
  sends: (id: string) => http<FollowupSend[]>(`/followups/${id}/sends`),
}
