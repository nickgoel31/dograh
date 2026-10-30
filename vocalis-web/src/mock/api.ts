// Tiny fake API layer. Replace each body with a real fetch() later.
import { sleep } from '@/lib/utils'
import { calls } from './calls'
import { numbers, campaigns, knowledge, integrations, invoices, team, deliveries, reqLogs, days } from './misc'
import { voices } from './voices'
import type { Call } from './types'

export type Mode = 'test' | 'live'
const lag = async <T,>(v: T, ms = 450 + Math.random() * 350): Promise<T> => { await sleep(ms); return v }

export const api = {
  // Test mode shows a smaller, practice-only set of calls.
  calls: (m: Mode): Promise<Call[]> => lag(m === 'test' ? calls.filter((c) => c.test) : calls),
  call: (id: string) => lag(calls.find((c) => c.id === id) ?? null),
  kpis: (m: Mode) =>
    lag(m === 'test'
      ? { calls: 12, success: 83, minutes: 41, spend: 0 }
      : { calls: 305, success: 87, minutes: 1284, spend: 7704 }),
  days: (m: Mode) => lag(m === 'test' ? days.map((d) => ({ ...d, calls: Math.round(d.calls / 12), minutes: Math.round(d.minutes / 14) })) : days),
  numbers: () => lag(numbers),
  campaigns: () => lag(campaigns),
  knowledge: () => lag(knowledge),
  integrations: () => lag(integrations),
  invoices: () => lag(invoices),
  team: () => lag(team),
  deliveries: () => lag(deliveries),
  reqLogs: () => lag(reqLogs),
  voices: () => lag(voices, 200),
}
