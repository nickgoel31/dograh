import * as React from 'react'
import { cn } from '@/lib/utils'

/** Pairs of soft colours. An agent always gets the same pair, picked from its id. */
const PAIRS: [string, string, string][] = [
  ['#22d3ee', '#6366f1', '#a78bfa'], ['#f472b6', '#fb923c', '#fde047'], ['#34d399', '#06b6d4', '#60a5fa'], ['#a78bfa', '#ec4899', '#fb7185'],
  ['#fbbf24', '#f97316', '#ef4444'], ['#60a5fa', '#8b5cf6', '#e879f9'], ['#2dd4bf', '#84cc16', '#facc15'], ['#fb7185', '#a855f7', '#38bdf8'],
]
const pick = (id: string) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PAIRS[h % PAIRS.length] }

/** A round, glassy gradient avatar for an agent. */
export function AgentAvatar({ id, className, children }: { id: string; emoji?: string; className?: string; size?: number; children?: React.ReactNode }) {
  const [a, b, c] = pick(id)
  return (
    <span className={cn('relative flex shrink-0 items-center justify-center overflow-hidden rounded-full text-white', className)} style={{ background: b }}>
      <span aria-hidden className="absolute -left-1/4 -top-1/4 h-[90%] w-[90%] rounded-full blur-[8px]" style={{ background: a }} />
      <span aria-hidden className="absolute -bottom-1/3 -right-1/4 h-[95%] w-[95%] rounded-full blur-[9px]" style={{ background: c }} />
      <span aria-hidden className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_28%_22%,rgba(255,255,255,.55),transparent_52%)]" />
      <span aria-hidden className="absolute inset-0 rounded-full ring-1 ring-inset ring-white/45" />
      {children && <span className="relative flex items-center justify-center drop-shadow-[0_1px_2px_rgba(0,0,0,.25)]">{children}</span>}
    </span>
  )
}
