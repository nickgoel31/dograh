/**
 * Swarvo AI: a tiny TypeScript client for the public API. One file, no dependencies (uses fetch).
 *
 *   import { Swarvo } from './swarvo'
 *   const client = new Swarvo('sk_test_...', 'https://app.swarvoai.com/api/v1')
 *   const { calls } = await client.calls({ limit: 10 })
 *
 * Keys that start with sk_test_ read your Test data; sk_live_ keys read your Live data.
 */

export class SwarvoError extends Error {
  constructor(public status: number, public code: string, message: string) { super(`${status} ${code}: ${message}`) }
}

export class Swarvo {
  constructor(private apiKey: string, private baseUrl = 'https://app.swarvoai.com/api/v1', private retries = 2) {}

  private async get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const qs = Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')
    const url = `${this.baseUrl.replace(/\/$/, '')}/public${path}${qs ? '?' + qs : ''}`
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' } })
      if (res.ok) return (await res.json()) as T
      if ([429, 502, 503, 504].includes(res.status) && attempt < this.retries) { await new Promise((r) => setTimeout(r, 2 ** attempt * 1000)); continue }
      const d = ((await res.json().catch(() => ({}))) as { detail?: { code?: string; message?: string } | string }).detail
      throw new SwarvoError(res.status, typeof d === 'object' ? d?.code ?? 'error' : 'error', typeof d === 'object' ? d?.message ?? res.statusText : String(d ?? res.statusText))
    }
  }

  me() { return this.get<{ workspace: string; environment: string }>('/me') }
  agents() { return this.get<{ id: string; name: string; status: string }[]>('/agents') }
  calls(o: { page?: number; limit?: number; agent?: string } = {}) { return this.get<{ calls: Record<string, unknown>[]; total: number; page: number; limit: number }>('/calls', o) }
  call(id: string) { return this.get<Record<string, unknown>>(`/calls/${id}`) }
}

/** Check a webhook really came from Swarvo. `header` is the signature header: t=<unix time>,v1=<hex>. Works in Node 18+ and edge runtimes. */
export async function verifyWebhook(secret: string, header: string, body: string, toleranceSeconds = 300): Promise<boolean> {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=', 2) as [string, string]))
  const ts = Number(parts.t)
  if (!ts || !parts.v1 || Math.abs(Date.now() / 1000 - ts) > toleranceSeconds) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${body}`))
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return hex.length === parts.v1.length && hex === parts.v1
}
