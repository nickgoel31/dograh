import { http } from './http'
import type { components } from './schema'
import type { Agent } from '@/mock/types'

type AgentOut = components['schemas']['AgentOut']

/** Product agent -> the shape the pages already use. */
export function toAgent(a: AgentOut, prev?: Agent): Agent {
  return {
    id: a.id, name: a.name, emoji: a.emoji, color: a.color, role: a.role,
    status: a.status as Agent['status'],
    callsToday: a.calls_today ?? 0, successRate: a.success_rate ?? 0, spark: a.spark ?? [0, 0, 0, 0, 0, 0, 0, 0],
    voiceId: a.voice_id ?? '', brain: a.brain as Agent['brain'], tone: a.tone, business: a.business,
    whatYouDo: a.what_you_do,
    // The list endpoint omits the prompt; keep what we already loaded.
    prompt: a.prompt ?? prev?.prompt ?? '',
    numbers: prev?.numbers ?? [],
    version: a.version, brainApplies: a.brain_applies, style: a.style,
  }
}

/** Page field names -> API field names. Only fields the backend owns are sent. */
export function toPatch(p: Partial<Agent>): components['schemas']['AgentPatch'] {
  const m: components['schemas']['AgentPatch'] = {}
  if (p.name !== undefined) m.name = p.name
  if (p.emoji !== undefined) m.emoji = p.emoji
  if (p.color !== undefined) m.color = p.color
  if (p.role !== undefined) m.role = p.role
  if (p.tone !== undefined) m.tone = p.tone
  if (p.business !== undefined) m.business = p.business
  if (p.whatYouDo !== undefined) m.what_you_do = p.whatYouDo
  if (p.brain !== undefined) m.brain = p.brain
  if (p.voiceId) m.voice_id = p.voiceId
  if (p.prompt !== undefined) m.prompt = p.prompt
  return m
}

export const agentsApi = {
  list: () => http<AgentOut[]>('/agents'),
  get: (id: string) => http<AgentOut>(`/agents/${id}`),
  create: (b: components['schemas']['AgentCreate']) => http<AgentOut>('/agents', { method: 'POST', json: b }),
  patch: (id: string, p: Partial<Agent>, version?: number) =>
    http<AgentOut>(`/agents/${id}`, {
      method: 'PATCH', json: toPatch(p), headers: version !== undefined ? { 'If-Match': String(version) } : undefined,
    }),
  duplicate: (id: string) => http<AgentOut>(`/agents/${id}/duplicate`, { method: 'POST' }),
  pause: (id: string) => http<AgentOut>(`/agents/${id}/pause`, { method: 'POST' }),
  resume: (id: string) => http<AgentOut>(`/agents/${id}/resume`, { method: 'POST' }),
  publish: (id: string) => http<AgentOut>(`/agents/${id}/publish`, { method: 'POST' }),
  flow: (id: string) => http<components['schemas']['FlowOut']>(`/agents/${id}/flow`),
  saveFlow: (id: string, definition: unknown, version?: number) =>
    http<components['schemas']['FlowOut']>(`/agents/${id}/flow`, {
      method: 'PUT', json: definition, headers: version !== undefined ? { 'If-Match': String(version) } : undefined,
    }),
  versions: (id: string) => http<components['schemas']['VersionOut'][]>(`/agents/${id}/versions`),
  versionDiff: (id: string, n: number) => http<components['schemas']['DiffOut']>(`/agents/${id}/versions/${n}/diff`),
  restoreVersion: (id: string, n: number) => http<AgentOut>(`/agents/${id}/versions/${n}/restore`, { method: 'POST' }),
  readiness: (id: string) => http<components['schemas']['CheckOut'][]>(`/agents/${id}/readiness`),
}
