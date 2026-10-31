import { api as mockApi } from '@/mock/api'
import { USE_MOCKS } from './env'
import { toVoice, voicesApi } from './voices'
import { callsApi } from './calls'

export { USE_MOCKS } from './env'
export { ApiError } from './http'
export { authApi } from './auth'
export type { Me, WorkspaceInfo } from './auth'

/**
 * The data layer the pages call. Signatures match the demo's mock layer.
 *
 * Real so far: sign-in, workspaces, Test/Live, agents (via the store) and voices. Everything else
 * still comes from the mock layer until its module is built (see
 * docs/PRODUCT_ASSUMPTIONS.md). Move a function into `real` as it goes live;
 * nothing here silently falls back once a function is listed in `real`.
 */
const real: Partial<typeof mockApi> = {
  voices: async () => (await voicesApi.list()).map(toVoice),
  // The server scopes calls to the active Test/Live mode itself.
  calls: (mode) => callsApi.list(mode === 'test'),
  call: (id: string) => callsApi.get(id),
}

export const api: typeof mockApi = USE_MOCKS ? mockApi : { ...mockApi, ...real }
