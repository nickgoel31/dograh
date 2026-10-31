import * as React from 'react'
import { motion } from 'framer-motion'
import { Check, Copy, HelpCircle, Mic, Pause, Play } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import { Badge, Button, Card, Dialog, Skeleton, Tip, type Tone } from './ui'
import { useUI } from '@/store/ui'
import { cn, seeded } from '@/lib/utils'

/* ---------- async helper ---------- */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  // Cached per call site (function source) + deps, and per workspace/mode so a
  // switch never shows the previous environment's data.
  const mode = useUI((s) => s.mode)
  const workspaceId = useUI((s) => s.workspaceId)
  const q = useQuery({ queryKey: ['async', String(fn), ...deps, mode, workspaceId], queryFn: fn })
  return { data: (q.data ?? null) as T | null, loading: q.isPending, error: q.error }
}

/* ---------- layout bits ---------- */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-line/70 pb-6">
      <div>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-[15px] text-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Sparkline({ data, color = 'hsl(var(--accent))', h = 36 }: { data: number[]; color?: string; h?: number }) {
  const id = React.useId().replace(/:/g, '')
  return (
    <div style={{ height: h }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data.map((v, i) => ({ v, i }))} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
          <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.3} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#${id})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function StatCard({ label, value, delta, hint, loading, spark }: { label: string; value: React.ReactNode; delta?: string; hint?: string; loading?: boolean; spark?: number[] }) {
  return (
    <Card className="card-lift relative overflow-hidden p-5">
      <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-accent/[.06] blur-2xl" aria-hidden />
      <div className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-soft">{label}{hint && <HelpTooltip text={hint} />}</div>
      {loading ? <Skeleton className="mt-3 h-8 w-24" /> : <div className="num mt-2.5 text-[32px] font-bold leading-none tracking-tight">{value}</div>}
      {delta && !loading && <div className={cn('mt-1 text-xs font-medium', delta.startsWith('-') ? 'text-bad' : 'text-ok')}>{delta} <span className="font-normal text-soft">vs last week</span></div>}
      {spark && !loading && <div className="mt-2"><Sparkline data={spark} /></div>}
    </Card>
  )
}

export function Illustration({ emoji }: { emoji: string }) {
  return (
    <div className="relative mx-auto mb-5 h-24 w-24">
      <svg viewBox="0 0 96 96" className="absolute inset-0" aria-hidden>
        <circle cx="48" cy="48" r="46" fill="hsl(var(--accent-soft))" />
        <circle cx="48" cy="48" r="34" fill="hsl(var(--surface))" stroke="hsl(var(--line))" />
        <circle cx="14" cy="26" r="4" fill="hsl(var(--accent))" opacity=".5" /><circle cx="84" cy="70" r="5" fill="hsl(var(--warn))" opacity=".5" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-4xl">{emoji}</div>
    </div>
  )
}
export function EmptyState({ emoji, title, text, action }: { emoji: string; title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed bg-surface/60 px-6 py-14 text-center">
      <Illustration emoji={emoji} />
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-sm text-soft">{text}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

const statusMap: Record<string, [Tone, string]> = {
  live: ['green', 'Live'], draft: ['gray', 'Draft'], paused: ['orange', 'Paused'],
  booked: ['green', 'Booked'], resolved: ['green', 'Solved'], qualified: ['accent', 'Good lead'], transferred: ['accent', 'Sent to human'],
  voicemail: ['gray', 'Voicemail'], failed: ['red', 'Needs a look'], 'no-answer': ['gray', 'No answer'],
  ready: ['green', 'Ready'], learning: ['orange', 'Learning…'], active: ['green', 'Active'], pending: ['orange', 'Setting up'],
  running: ['green', 'Running'], done: ['gray', 'Finished'], scheduled: ['accent', 'Scheduled'],
  Paid: ['green', 'Paid'], Due: ['orange', 'Due'], Clean: ['green', 'Clean'], Watch: ['orange', 'Watch'], Flagged: ['red', 'Flagged'],
}
export function StatusBadge({ status }: { status: string }) {
  const [tone, label] = statusMap[status] ?? ['gray', status]
  const dot = status === 'live' || status === 'running' || status === 'active'
  return <Badge tone={tone}>{dot && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}{label}</Badge>
}

export const sentimentEmoji = ['', '😡', '🙁', '😐', '🙂', '😄']

/* ---------- Simple / Advanced ---------- */
export function SimpleAdvanced({ simple, advanced }: { simple?: React.ReactNode; advanced?: React.ReactNode }) {
  const view = useUI((s) => s.view)
  return <motion.div key={view} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>{view === 'simple' ? simple : advanced}</motion.div>
}
/** Shows children only in Advanced view. */
export function AdvancedOnly({ children }: { children: React.ReactNode }) {
  return useUI((s) => s.view) === 'advanced' ? <>{children}</> : null
}

export function HelpTooltip({ text }: { text: string }) {
  return <Tip text={text}><button type="button" aria-label="What is this?" className="text-soft/70 hover:text-ink"><HelpCircle size={14} /></button></Tip>
}
/** Friendly label with the technical term tucked into a tooltip. */
export const Friendly = ({ label, tech }: { label: string; tech: string }) => <>{label}<HelpTooltip text={`Technical name: ${tech}`} /></>

/* ---------- copy / code ---------- */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = React.useState(false)
  return (
    <Button size="sm" variant="ghost" aria-label={label} onClick={() => { navigator.clipboard?.writeText(text); setDone(true); toast.success('Copied!'); setTimeout(() => setDone(false), 1500) }}>
      {done ? <Check size={14} className="text-ok" /> : <Copy size={14} />}{label !== 'Copy' || done ? '' : ''}
    </Button>
  )
}

function highlight(src: string) {
  const esc = src.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return esc
    .replace(/("(?:\\.|[^"\\])*")(\s*:)?/g, (_m, s, c) => (c ? `<span class="tok-k">${s}</span>${c}` : `<span class="tok-s">${s}</span>`))
    .replace(/\b(-?\d+\.?\d*|true|false|null)\b/g, '<span class="tok-n">$1</span>')
}
export function CodeBlock({ code, json, className }: { code: string; json?: boolean; className?: string }) {
  return (
    <div className={cn('group relative rounded-xl border bg-muted/60', className)}>
      <div className="absolute right-2 top-2"><CopyButton text={code} /></div>
      <pre className="overflow-x-auto p-4 pr-12 font-mono text-[12.5px] leading-relaxed"><code dangerouslySetInnerHTML={{ __html: json ? highlight(code) : code.replace(/&/g, '&amp;').replace(/</g, '&lt;') }} /></pre>
    </div>
  )
}

export function ConfirmDialog({ open, onOpenChange, title, text, confirm = 'Yes, do it', danger, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; text: string; confirm?: string; danger?: boolean; onConfirm: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      <p className="text-soft">{text}</p>
      <div className="mt-6 flex justify-end gap-2">
        <Button onClick={() => onOpenChange(false)}>Not now</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={() => { onConfirm(); onOpenChange(false) }}>{confirm}</Button>
      </div>
    </Dialog>
  )
}

/* ---------- audio-ish visuals ---------- */
export function Bars({ n = 5, active = true, className }: { n?: number; active?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex h-4 items-end gap-[2px]', className)} aria-hidden>
      {Array.from({ length: n }, (_, i) => <span key={i} className={cn('w-[3px] origin-bottom rounded-full bg-current', active && 'animate-wave')} style={{ height: '100%', animationDelay: `${i * 0.12}s`, transform: active ? undefined : 'scaleY(.3)' }} />)}
    </span>
  )
}

export function WaveformPlayer({ duration, time, playing, onToggle, onSeek, segments, seed = 7 }: { duration: number; time: number; playing: boolean; onToggle: () => void; onSeek: (t: number) => void; segments?: { who: 'agent' | 'caller'; t: number; end: number }[]; seed?: number }) {
  const bars = React.useMemo(() => { const r = seeded(seed); return Array.from({ length: 90 }, () => 0.15 + r() * 0.85) }, [seed])
  const who = (p: number) => segments?.find((s) => p * duration >= s.t && p * duration <= s.end)?.who
  return (
    <div className="flex items-center gap-4">
      <Button variant="primary" size="icon" className="h-11 w-11 rounded-full" onClick={onToggle} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}</Button>
      <div role="slider" tabIndex={0} aria-label="Seek" aria-valuenow={Math.round(time)} aria-valuemax={Math.round(duration)}
        className="flex h-14 flex-1 cursor-pointer items-center gap-[2px]"
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onSeek(((e.clientX - r.left) / r.width) * duration) }}
        onKeyDown={(e) => { if (e.key === 'ArrowRight') onSeek(time + 5); if (e.key === 'ArrowLeft') onSeek(time - 5) }}>
        {bars.map((h, i) => {
          const p = i / bars.length
          const played = p * duration <= time
          const w = who(p)
          return <span key={i} className={cn('flex-1 rounded-full transition-colors', played ? (w === 'caller' ? 'bg-warn' : 'bg-accent') : 'bg-line')} style={{ height: `${h * 100}%` }} />
        })}
      </div>
    </div>
  )
}

export function VoiceOrb({ state = 'idle', size = 160 }: { state?: 'idle' | 'listening' | 'speaking' | 'thinking'; size?: number }) {
  const live = state !== 'idle'
  const color = state === 'listening' ? 'var(--ok)' : 'var(--accent)'
  return (
    <div className="relative mx-auto flex items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={`Agent is ${state}`}>
      {[0, 1, 2].map((i) => (
        <motion.span key={i} className="absolute inset-0 rounded-full" style={{ background: `hsl(${color} / .18)` }}
          animate={live ? { scale: [1, 1.35 + i * 0.12, 1], opacity: [0.7, 0, 0.7] } : { scale: 1, opacity: 0.35 }}
          transition={{ duration: state === 'speaking' ? 1.1 : 2, repeat: Infinity, delay: i * 0.35 }} />
      ))}
      <motion.div className="relative z-10 flex items-center justify-center rounded-full text-white shadow-pop"
        style={{ width: size * 0.62, height: size * 0.62, background: `radial-gradient(circle at 30% 25%, hsl(${color} / .75), hsl(${color}))` }}
        animate={{ scale: state === 'speaking' ? [1, 1.07, 0.97, 1.05, 1] : state === 'thinking' ? [1, 0.94, 1] : 1 }}
        transition={{ duration: state === 'thinking' ? 0.9 : 0.8, repeat: live ? Infinity : 0 }}>
        {state === 'speaking' ? <Bars n={5} className="h-8 text-white" /> : <Mic size={size * 0.2} />}
      </motion.div>
    </div>
  )
}

/* ---------- speech helpers ---------- */
export const speechSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window
export function speak(text: string, opts: { rate?: number; female?: boolean; lang?: string; onEnd?: () => void } = {}) {
  if (!speechSupported()) { setTimeout(() => opts.onEnd?.(), Math.min(4000, text.length * 55)); return }
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.rate = opts.rate ?? 1
  if (opts.lang) u.lang = opts.lang
  const vs = window.speechSynthesis.getVoices()
  const pick = vs.find((v) => /en/i.test(v.lang) && (opts.female === undefined || (opts.female ? /female|zira|samantha|susan|heera|google uk english female/i.test(v.name) : /male|david|mark|daniel|google uk english male/i.test(v.name))))
  if (pick) u.voice = pick
  u.onend = () => opts.onEnd?.()
  u.onerror = () => opts.onEnd?.()
  window.speechSynthesis.speak(u)
}
export const stopSpeaking = () => speechSupported() && window.speechSynthesis.cancel()

export function CardSkeletons({ n = 6, h = 'h-40' }: { n?: number; h?: string }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: n }, (_, i) => <div key={i} className={cn('skeleton', h)} />)}</div>
}
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return <div className="space-y-2 p-4">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
}

export function UnsavedBar({ show, onSave, onDiscard }: { show: boolean; onSave: () => void; onDiscard: () => void }) {
  return (
    <motion.div initial={false} animate={{ y: show ? 0 : 120, opacity: show ? 1 : 0 }} className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-4 rounded-xl border bg-ink px-4 py-2.5 text-bg shadow-pop">
        <span className="text-sm">You have unsaved changes</span>
        <Button size="sm" variant="ghost" className="text-bg/80 hover:bg-white/10 hover:text-bg" onClick={onDiscard}>Discard</Button>
        <Button size="sm" variant="primary" onClick={onSave}>Save changes</Button>
      </div>
    </motion.div>
  )
}

export const Row = ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={cn('flex items-center justify-between gap-4', className)}>{children}</div>
export const Section = ({ title, hint, children, right }: { title: string; hint?: string; children: React.ReactNode; right?: React.ReactNode }) => (
  <Card className="p-6"><div className="mb-4 flex items-start justify-between gap-3"><div><h3 className="font-semibold">{title}</h3>{hint && <p className="mt-0.5 text-[13px] text-soft">{hint}</p>}</div>{right}</div>{children}</Card>
)
