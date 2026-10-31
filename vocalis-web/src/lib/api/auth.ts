import { http } from './http'
import type { components } from './schema'

export type Me = components['schemas']['MeOut']
export type WorkspaceInfo = components['schemas']['WorkspaceOut']

export const authApi = {
  me: () => http<Me>('/me'),
  signup: (b: components['schemas']['SignupBody']) => http<Me>('/auth/signup', { method: 'POST', json: b }),
  login: (b: components['schemas']['LoginBody'] & { code?: string }) => http<Me | { setup_required: true }>('/auth/login', { method: 'POST', json: b }),
  handoffStart: (to: 'product' | 'classic') => http<{ code: string }>('/auth/handoff', { method: 'POST', json: { to } }),
  handoffRedeem: (code: string) => http<{ ok: boolean }>('/auth/handoff/redeem', { method: 'POST', json: { code, to: 'product' } }),
  config: () => http<{ google_client_id: string | null }>('/auth/config'),
  google: (credential: string) => http<Me | { setup_required: true }>('/auth/google', { method: 'POST', json: { credential } }),
  forgot: (email: string) => http<{ ok: boolean; message: string }>('/auth/forgot', { method: 'POST', json: { email } }),
  reset: (token: string, password: string) => http<{ ok: boolean }>('/auth/reset', { method: 'POST', json: { token, password } }),
  verify: (token: string) => http<{ ok: boolean }>('/auth/verify', { method: 'POST', json: { token } }),
  logout: () => http<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  createWorkspace: (name: string) => http<WorkspaceInfo>('/workspaces', { method: 'POST', json: { name } }),
}
