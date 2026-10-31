import { http } from './http'
import type { components } from './schema'
import type { Voice } from '@/mock/types'

type VoiceOut = components['schemas']['VoiceOut']

/** Facts the catalogue doesn't know (gender, age, accent) stay empty rather than guessed. */
export function toVoice(v: VoiceOut): Voice {
  return {
    id: v.id, name: v.name, lang: v.language, style: v.style ?? '', provider: v.provider,
    gender: (v.gender ?? '') as Voice['gender'], age: (v.age ?? '') as Voice['age'], accent: v.accent ?? '',
    available: v.available, description: v.description ?? undefined, brainLevels: v.brain_levels, hasSample: v.has_sample,
  }
}

export const voicesApi = {
  list: () => http<VoiceOut[]>('/voices'),
  favorite: (id: string) => http<VoiceOut>(`/voices/${id}/favorite`, { method: 'PUT' }),
  unfavorite: (id: string) => http<VoiceOut>(`/voices/${id}/favorite`, { method: 'DELETE' }),
}
