/** Developers, Team & Settings and Help. Types are written by hand to match the API; run the OpenAPI export to regenerate schema.d.ts. */
import { http } from './http'

export interface ApiKey { id: string; name: string; environment: string; hint: string; created: string; last_used: string | null; key: string | null }
export interface ApiLog { time: string; method: string; path: string; status: number; ms: number; key: string | null }
export interface Hook { id: string; url: string; events: string[]; active: boolean; secret: string | null; failing: boolean }
export interface Delivery { id: string; event: string; status: string; attempts: number; response_code: number | null; error: string | null; time: string; next_attempt: string | null }
export interface EventInfo { name: string; available: boolean; note: string | null }
export interface Member { id: string; email: string | null; name: string | null; role: string; you: boolean }
export interface Invite { id: string; email: string; role: string; expires: string; token: string | null }
export interface Team { members: Member[]; invites: Invite[] }
export interface PrivacySettings { record_calls: boolean; consent_announcement: string | null; redact_pii: boolean; retention_days: number | null; widget_origins: string[]; notes?: string[] }
export interface AuditRow { time: string; who: string | null; action: string; target: string | null; detail: Record<string, unknown> | null }
export interface Article { id: string; title: string; section: string; body: string }
export interface StatusItem { name: string; state: 'ok' | 'down' | 'not_set_up'; detail: string }
export interface Ask { answer: string; articles: Article[]; from_ai: boolean }

const D = '/developers', T = '/team', H = '/help'

export const platformApi = {
  keys: () => http<ApiKey[]>(`${D}/keys`),
  createKey: (name: string) => http<ApiKey>(`${D}/keys`, { method: 'POST', json: { name } }),
  revokeKey: (id: string) => http(`${D}/keys/${id}`, { method: 'DELETE' }),
  logs: () => http<ApiLog[]>(`${D}/logs`),
  events: () => http<{ events: EventInfo[]; signature_header: string }>(`${D}/events`),
  hooks: () => http<Hook[]>(`${D}/webhooks`),
  createHook: (url: string, events: string[]) => http<Hook>(`${D}/webhooks`, { method: 'POST', json: { url, events } }),
  deleteHook: (id: string) => http(`${D}/webhooks/${id}`, { method: 'DELETE' }),
  testHook: (id: string) => http<Delivery>(`${D}/webhooks/${id}/test`, { method: 'POST' }),
  deliveries: (id: string) => http<Delivery[]>(`${D}/webhooks/${id}/deliveries`),
  resend: (id: string) => http<Delivery>(`${D}/webhooks/deliveries/${id}/resend`, { method: 'POST' }),
  sendNow: () => http<{ queued: number; sent: number }>(`${D}/webhooks/send-now`, { method: 'POST' }),

  team: () => http<Team>(T),
  invite: (email: string, role: string) => http<Invite>(`${T}/invites`, { method: 'POST', json: { email, role } }),
  revokeInvite: (id: string) => http(`${T}/invites/${id}`, { method: 'DELETE' }),
  acceptInvite: (token: string) => http<{ workspace: string; name: string; role: string }>(`${T}/invites/accept`, { method: 'POST', json: { token } }),
  setRole: (id: string, role: string) => http(`${T}/members/${id}`, { method: 'PATCH', json: { role } }),
  removeMember: (id: string) => http(`${T}/members/${id}`, { method: 'DELETE' }),
  audit: () => http<AuditRow[]>(`${T}/audit`),
  settings: () => http<PrivacySettings>(`${T}/settings`),
  saveSettings: (s: PrivacySettings) => http<PrivacySettings>(`${T}/settings`, { method: 'PUT', json: s }),
  purge: () => http<{ cleared: number }>(`${T}/privacy/purge`, { method: 'POST' }),
  twoFa: () => http<{ enabled: boolean }>(`${T}/2fa`),
  twoFaSetup: () => http<{ secret: string; uri: string }>(`${T}/2fa/setup`, { method: 'POST' }),
  twoFaEnable: (code: string) => http<{ enabled: boolean }>(`${T}/2fa/enable`, { method: 'POST', json: { code } }),
  twoFaDisable: (code: string) => http<{ enabled: boolean }>(`${T}/2fa/disable`, { method: 'POST', json: { code } }),
  subAccounts: () => http<{ id: string; name: string }[]>(`${T}/sub-accounts`),
  newSubAccount: (name: string) => http<{ id: string; name: string }>(`${T}/sub-accounts`, { method: 'POST', json: { name } }),

  articles: (q: string) => http<Article[]>(`${H}/articles${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  status: () => http<StatusItem[]>(`${H}/status`),
  contact: (subject: string, body: string) => http<{ ok: boolean; message: string }>(`${H}/contact`, { method: 'POST', json: { subject, body } }),
  ask: (question: string) => http<Ask>(`${H}/ask`, { method: 'POST', json: { question } }),
}
