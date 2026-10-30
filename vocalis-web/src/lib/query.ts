import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api/http'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      // Don't retry auth/permission/not-found problems; retry transient ones once.
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 1,
    },
  },
})
