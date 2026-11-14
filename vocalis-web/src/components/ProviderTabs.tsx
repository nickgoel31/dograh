import * as React from 'react'
import { cn } from '@/lib/utils'

/** Voices come from a few providers. Tabs keep them apart, with a line on what each one is good for. */
export const PROVIDER_INFO: Record<string, { title: string; blurb: string }> = {
  Falcon: { title: 'Falcon', blurb: 'Natural voices for Indian languages: Hindi, Tamil, Telugu, Marathi, Bengali and more. Fast, built for phone calls.' },
  Studio: { title: 'Studio', blurb: 'Expressive voices that listen, think and speak in one step. Best for lively, human conversations.' },
  Gemini: { title: 'Gemini', blurb: 'Google live voices that handle many languages in the same call.' },
  Swarvo: { title: 'Swarvo', blurb: 'Our own voices for natural Hindi on calls, and 20% off every minute. Coming soon.' },
}
const ORDER = ['Falcon', 'Studio', 'Gemini', 'Swarvo']
export const providerRank = (p?: string) => ORDER.includes(p ?? '') ? ORDER.indexOf(p ?? '') : 99
const rank = (p: string) => { const i = ORDER.indexOf(p); return i < 0 ? 99 : i }

type V = { provider?: string; available?: boolean }

export function providersOf(voices: V[]) {
  const by = new Map<string, { count: number; ready: number }>()
  for (const v of voices) {
    const p = v.provider || 'Other'
    const e = by.get(p) ?? { count: 0, ready: 0 }
    e.count += 1; if (v.available !== false) e.ready += 1
    by.set(p, e)
  }
  return [...by.entries()].map(([name, e]) => ({ name, ...e })).sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
}

export function ProviderTabs({ voices, value, onChange, className }: { voices: V[]; value: string; onChange: (p: string) => void; className?: string }) {
  const list = React.useMemo(() => providersOf(voices), [voices])
  if (list.length < 2) return null
  const info = value ? PROVIDER_INFO[value] : undefined
  const pill = (on: boolean) => cn('shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13px] transition', on ? 'border-ink bg-ink text-surface' : 'bg-surface text-soft hover:border-soft/50 hover:text-ink')
  return (
    <div className={className}>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Voice provider">
        <button role="tab" aria-selected={!value} onClick={() => onChange('')} className={pill(!value)}>All voices<span className="ml-1.5 opacity-60">{voices.length}</span></button>
        {list.map((p) => (
          <button key={p.name} role="tab" aria-selected={value === p.name} onClick={() => onChange(p.name)} className={pill(value === p.name)}>
            {PROVIDER_INFO[p.name]?.title ?? p.name}<span className="ml-1.5 opacity-60">{p.count}</span>{p.ready === 0 && <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 py-px text-[10px] font-semibold text-accent">Soon</span>}
          </button>))}
      </div>
      {info && <p className="mt-2 text-[13px] text-soft">{info.blurb}</p>}
    </div>
  )
}
