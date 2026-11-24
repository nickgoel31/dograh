import { http } from './http'

export type SubAccount = {
  id: string; name: string; billing: 'shared' | 'own'; suspended: boolean; month_minutes: number; month_value: number
  cap_value: number | null; cap_minutes: number | null; max_concurrent: number | null; members: number; agents: number; created: string | null
}
export type SubUsage = { period: string; currency: string; accounts: { id: string; name: string; calls: number; minutes: number; value: number; billing: string; suspended: boolean }[]; total_calls: number; total_minutes: number; total_value: number }
export type SubCreate = { name: string; billing: 'shared' | 'own'; cap_value?: number | null; cap_minutes?: number | null; max_concurrent?: number | null }
export type SubChange = Partial<{ name: string; billing: 'shared' | 'own'; cap_value: number; cap_minutes: number; max_concurrent: number; clear_cap_value: boolean; clear_cap_minutes: boolean; clear_max_concurrent: boolean }>

export const subApi = {
  list: () => http<SubAccount[]>('/subaccounts'),
  create: (b: SubCreate) => http<SubAccount>('/subaccounts', { method: 'POST', json: b }),
  change: (id: string, b: SubChange) => http<SubAccount>(`/subaccounts/${id}`, { method: 'PATCH', json: b }),
  pause: (id: string) => http<SubAccount>(`/subaccounts/${id}/pause`, { method: 'POST' }),
  resume: (id: string) => http<SubAccount>(`/subaccounts/${id}/resume`, { method: 'POST' }),
  usage: (period?: string) => http<SubUsage>(`/subaccounts/usage${period ? `?period=${period}` : ''}`),
  csvUrl: (period?: string) => `/subaccounts/usage.csv${period ? `?period=${period}` : ''}`,
}
