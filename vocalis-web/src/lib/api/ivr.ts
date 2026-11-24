import { http } from './http'

export type IvrNode = {
  type: 'menu' | 'say' | 'hours' | 'collect' | 'transfer' | 'voicemail' | 'agent' | 'hangup'
  label?: string; say?: string; next?: string | null; open?: string | null; closed?: string | null
  options?: Record<string, string>; keywords?: Record<string, string>; retries?: number; invalid?: string; on_fail?: string | null; agent_id?: string | null
  digits?: number; var?: string; number?: string; fail_say?: string; seconds?: number
}
export type IvrFlow = { start: string; nodes: Record<string, IvrNode> }
export type IvrSettings = { voice: string; language: string; pulse: 30 | 60; max_seconds: number | null; hours: { enabled: boolean; tz: string; windows: { days: number[]; start: string; end: string }[]; closed_message: string } | null; paused_message: string }
export type Ivr = { id: string; name: string; status: 'draft' | 'live' | 'paused'; flow: IvrFlow; settings: IvrSettings; problems: string[]; numbers: string[]; calls: number; pulse_locked?: boolean; updated: string | null }
export type IvrOptions = { voices: { id: string; label: string; languages: string[] }[]; languages: Record<string, string>; types: string[]; pricing: { pulse: number; per_minute: number }[] }
export type IvrCall = { id: number; ivr: string; ivr_id: string; from: string; to: string; started: string | null; seconds: number; outcome: string; path: string[]; voicemail_url: string | null; cost: number; billed: boolean }
export type IvrStep = { say: string[]; then: { kind: string; node?: string; prompt?: string; digits?: boolean; speech?: boolean; number?: string; agent_id?: string; tries?: number }; trail: string[] }
export type IvrOverview = { menus: number; calls: number; outcomes: Record<string, number>; spent: number }

export const ivrApi = {
  options: () => http<IvrOptions>('/ivr/options'),
  overview: () => http<IvrOverview>('/ivr/overview'),
  list: () => http<Ivr[]>('/ivr'),
  get: (id: string) => http<Ivr>(`/ivr/${id}`),
  create: (name: string, starter: boolean) => http<Ivr>('/ivr', { method: 'POST', json: { name, starter } }),
  change: (id: string, b: { name?: string; flow?: IvrFlow; settings?: Partial<IvrSettings> }) => http<Ivr>(`/ivr/${id}`, { method: 'PATCH', json: b }),
  status: (id: string, status: 'live' | 'paused' | 'draft') => http<Ivr>(`/ivr/${id}/status?status=${status}`, { method: 'POST' }),
  remove: (id: string) => http<void>(`/ivr/${id}`, { method: 'DELETE' }),
  simulate: (id: string, b: { node?: string; digits?: string; speech?: string; tries?: number; vars?: Record<string, string>; open?: boolean }) => http<IvrStep>(`/ivr/${id}/simulate`, { method: 'POST', json: b }),
  calls: (id?: string) => http<IvrCall[]>(id ? `/ivr/${id}/calls` : '/ivr/calls'),
  attach: (numberId: string, ivrId: string | null) => http(`/numbers/${numberId}/ivr`, { method: 'POST', json: { ivr_id: ivrId } }),
}
