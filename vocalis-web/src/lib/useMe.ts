import { useQuery } from '@tanstack/react-query'
import { authApi, ApiError, USE_MOCKS } from '@/lib/api'
import { useUI } from '@/store/ui'

/** The signed-in user + workspaces. Disabled in mock mode (no backend). */
export function useMe() {
  const mode = useUI((s) => s.mode)
  const workspaceId = useUI((s) => s.workspaceId)
  const q = useQuery({
    queryKey: ['me', mode, workspaceId],
    queryFn: authApi.me,
    enabled: !USE_MOCKS,
    retry: false,
  })
  return { ...q, signedOut: q.error instanceof ApiError && q.error.status === 401 }
}
