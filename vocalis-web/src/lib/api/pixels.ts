import { http } from './http'
import type { Me } from './auth'

export type Pixel = {
  id: string; name: string; status: string; online: boolean; last_seen: string | null; fw: string
  agent_id: string | null; agent_name: string | null; sessions: number; minutes: number; minutes_today: number
}
export type PixelSession = { started: string; seconds: number; ended: string | null; reason: string; call_id: string | null }
export type MadePixel = { device_id: string; code: string }
export type AdminPixel = { device_id: string; name: string; status: string; batch: string; online: boolean; last_seen: string | null; claimed: boolean; fw: string }

export const pixelsApi = {
  login: (device_id: string, code: string) => http<Me>('/auth/pixel', { method: 'POST', json: { device_id, code } }),
  list: () => http<Pixel[]>('/pixels'),
  change: (id: string, b: { name?: string; agent_id?: string | null; clear_agent?: boolean }) => http<Pixel>(`/pixels/${encodeURIComponent(id)}`, { method: 'PATCH', json: b }),
  sessions: (id: string) => http<PixelSession[]>(`/pixels/${encodeURIComponent(id)}/sessions?limit=15`),
  // the owner's tools
  adminList: () => http<AdminPixel[]>('/admin/pixels'),
  adminMake: (b: { count: number; prefix: string; batch: string }) => http<MadePixel[]>('/admin/pixels', { method: 'POST', json: b }),
  adminSwitch: (id: string, on: boolean) => http<{ ok: boolean }>(`/admin/pixels/${encodeURIComponent(id)}/${on ? 'on' : 'off'}`, { method: 'POST' }),
  adminNewCode: (id: string) => http<MadePixel>(`/admin/pixels/${encodeURIComponent(id)}/new-code`, { method: 'POST' }),
}
