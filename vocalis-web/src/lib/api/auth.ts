import { http } from './http'
import type { components } from './schema'

export type Me = components['schemas']['MeOut']
export type WorkspaceInfo = components['schemas']['WorkspaceOut']

export const authApi = {
  me: () => http<Me>('/me'),
  signup: (b: components['schemas']['SignupBody']) => http<Me>('/auth/signup', { method: 'POST', json: b }),
  login: (b: components['schemas']['LoginBody']) => http<Me>('/auth/login', { method: 'POST', json: b }),
  logout: () => http<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  createWorkspace: (name: string) => http<WorkspaceInfo>('/workspaces', { method: 'POST', json: { name } }),
}
