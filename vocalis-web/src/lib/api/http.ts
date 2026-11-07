import { API_URL } from './env'
import { useUI } from '@/store/ui'

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}

const FALLBACK = 'Something went wrong on our side. Please try again in a moment.'

/** Every request carries the session cookie plus the active workspace and Test/Live mode. */
export async function http<T>(path: string, init: RequestInit & { json?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const { workspaceId, mode } = useUI.getState()
  const headers = new Headers(init.headers)
  if (!headers.has('X-Environment')) headers.set('X-Environment', mode)
  if (workspaceId) headers.set('X-Workspace', workspaceId)
  let body = init.body
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(init.json)
  }
  let res: Response
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), init.timeoutMs ?? 60000) // a request that never answers becomes an error, not a page that loads forever
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers, body, credentials: 'include', signal: init.signal ?? ctl.signal })
  } catch (e) {
    if (ctl.signal.aborted) throw new ApiError(0, 'timeout', 'This is taking too long. Please try again in a moment.')
    throw new ApiError(0, 'offline', "We can't reach the server. Check your connection and try again.")
  } finally { clearTimeout(timer) }
  if (!res.ok) {
    let code = 'unknown', message = FALLBACK
    try {
      const d = (await res.json()).detail
      if (d && typeof d === 'object') { code = d.code ?? code; message = d.message ?? message }
      else if (typeof d === 'string' && res.status < 500) message = d
      else if (Array.isArray(d) && res.status === 422) {
        // Request-validation errors arrive as a list; tell the user which field to fix.
        const field = String(d[0]?.loc?.at(-1) ?? 'details').replace(/_/g, ' ')
        code = 'invalid_input'; message = `Please check your ${field} and try again.`
      }
    } catch { /* non-JSON error body: keep the friendly fallback */ }
    throw new ApiError(res.status, code, message)
  }
  if (res.status === 204 || res.status === 205) return undefined as T // "done, nothing to send back" (deleting something)
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}
