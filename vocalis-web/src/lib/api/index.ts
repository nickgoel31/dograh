import { api as mockApi } from '@/mock/api'
import { USE_MOCKS } from './env'

export { USE_MOCKS } from './env'
export { ApiError } from './http'
export { authApi } from './auth'
export type { Me, WorkspaceInfo } from './auth'

/**
 * The data layer the pages call. Signatures match the demo's mock layer.
 *
 * Phase 2 only makes sign-in, workspaces and Test/Live real. Everything else
 * still comes from the mock layer until its module is built (see
 * docs/PRODUCT_ASSUMPTIONS.md). Move a function into `real` as it goes live;
 * nothing here silently falls back once a function is listed in `real`.
 */
const real: Partial<typeof mockApi> = {}

export const api: typeof mockApi = USE_MOCKS ? mockApi : { ...mockApi, ...real }
