import * as React from 'react'
import { Button, Dialog, Field, Input, Select, Textarea } from '@/components/ui'
import { Bot, Clock, GitBranch, MessageCircle, Mic2, Pencil, PhoneForwarded, PhoneOff, Plus, Trash2 } from '@/components/icons'
import type { IvrFlow, IvrNode } from '@/lib/api/ivr'
import { cn } from '@/lib/utils'

type Agent = { id: string; name: string; status: string }
type Kind = IvrNode['type']
type Slot = { k: 'next' | 'open' | 'closed' | 'on_fail' | 'opt' | 'kw'; key?: string; label: string }
type Drag = { kind: 'new'; type: Kind } | { kind: 'move'; id: string }
export type Change = (fn: (f: IvrFlow) => string | void) => string | void

export const TYPE: Record<Kind, { name: string; hint: string }> = {
  say: { name: 'Say something', hint: 'Play a message' },
  menu: { name: 'Menu', hint: 'Press 1 for sales, 2 for support' },
  hours: { name: 'Open or closed?', hint: 'Check your business hours' },
  collect: { name: 'Ask for a number', hint: 'Like an account number' },
  transfer: { name: 'Call a person', hint: 'Ring another phone' },
  voicemail: { name: 'Take a message', hint: 'Record a voicemail' },
  agent: { name: 'AI voice agent', hint: 'Let an AI agent talk' },
  hangup: { name: 'End the call', hint: 'Say goodbye and hang up' },
}
const ICON: Record<Kind, React.ComponentType<{ size?: number | string; className?: string }>> = { say: MessageCircle, menu: GitBranch, hours: Clock, collect: Pencil, transfer: PhoneForwarded, voicemail: Mic2, agent: Bot, hangup: PhoneOff }
const ORDER: Kind[] = ['say', 'menu', 'hours', 'collect', 'transfer', 'voicemail', 'agent', 'hangup']
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '*', '#']
const newId = () => 's' + Math.random().toString(36).slice(2, 7)

const slotsOf = (n: IvrNode): Slot[] => {
  switch (n.type) {
    case 'menu': return [...Object.keys(n.options ?? {}).map((k) => ({ k: 'opt' as const, key: k, label: `Press ${k}` })), ...Object.keys(n.keywords ?? {}).map((k) => ({ k: 'kw' as const, key: k, label: `Says “${k}”` })), { k: 'on_fail', label: 'If they don’t answer' }]
    case 'say': case 'collect': case 'voicemail': return [{ k: 'next', label: 'Then' }]
    case 'hours': return [{ k: 'open', label: 'When you’re open' }, { k: 'closed', label: 'When you’re closed' }]
    case 'transfer': return [{ k: 'on_fail', label: 'If nobody picks up' }]
    default: return []
  }
}
const linkOf = (n: IvrNode, s: Slot): string | null | undefined => (s.k === 'opt' ? n.options?.[s.key!] : s.k === 'kw' ? n.keywords?.[s.key!] : n[s.k])
const withLink = (n: IvrNode, s: Slot, to: string | null): IvrNode => {
  if (s.k === 'opt') return { ...n, options: { ...(n.options ?? {}), [s.key!]: to ?? '' } }
  if (s.k === 'kw') return { ...n, keywords: { ...(n.keywords ?? {}), [s.key!]: to ?? '' } }
  return { ...n, [s.k]: to }
}
/** Take every link to `id` away (a menu key that led there is removed with it). */
const detach = (f: IvrFlow, id: string) => {
  for (const n of Object.values(f.nodes)) {
    for (const m of [n.options, n.keywords]) if (m) for (const [a, b] of Object.entries(m)) if (b === id) delete m[a]
    for (const p of ['next', 'open', 'closed', 'on_fail'] as const) if (n[p] === id) n[p] = null
  }
}
const base = (type: Kind): IvrNode => (({
  say: { type: 'say', say: 'Thank you for calling.', next: null }, menu: { type: 'menu', say: 'Press 1 for sales, or press 2 for support.', options: {}, keywords: {}, retries: 2 },
  hours: { type: 'hours' }, collect: { type: 'collect', say: 'Please type your number, then press hash.', digits: 4, var: 'code', next: null },
  transfer: { type: 'transfer', number: '', say: 'Connecting you now.' }, voicemail: { type: 'voicemail', say: 'Please leave a message after the beep.', seconds: 60, next: null },
  agent: { type: 'agent', agent_id: '', say: '' }, hangup: { type: 'hangup', say: 'Goodbye.' },
} as Record<Kind, IvrNode>)[type])
/** A new step, with what it needs to be valid: a menu starts with two keys, each leading to a message you can change. */
function addStep(f: IvrFlow, type: Kind): string {
  const id = newId()
  f.nodes[id] = { ...base(type), label: TYPE[type].name }
  if (type === 'menu') {
    for (const k of ['1', '2']) { const c = newId(); f.nodes[c] = { type: 'say', label: `Option ${k}`, say: `You pressed ${k}.`, next: null }; f.nodes[id].options = { ...(f.nodes[id].options ?? {}), [k]: c } }
  }
  return id
}
const nameOf = (n: IvrNode) => n.label || TYPE[n.type].name
const short = (t?: string, n = 56) => ((t ?? '').length > n ? (t ?? '').slice(0, n - 1) + '…' : t ?? '')
const summary = (n: IvrNode, agents: Agent[]) => {
  switch (n.type) {
    case 'menu': return Object.keys(n.options ?? {}).length ? `Press ${Object.keys(n.options ?? {}).join(', ')}` : short(n.say)
    case 'hours': return 'Checks your opening hours'
    case 'collect': return `Asks for ${n.digits ?? 4} digits`
    case 'transfer': return n.number || 'Add a phone number'
    case 'voicemail': return `Records up to ${n.seconds ?? 60} seconds`
    case 'agent': return agents.find((a) => a.id === n.agent_id)?.name ?? 'Choose an agent'
    default: return short(n.say) || 'Add a message'
  }
}

/* ---------------- the editor ---------------- */
export function IvrFlowEditor({ flow, agents, selected: sel, onSelect, onChange }: { flow: IvrFlow; agents: Agent[]; selected: string; onSelect: (id: string) => void; onChange: Change }) {
  const [picker, setPicker] = React.useState<{ owner: string; slot: Slot } | 'tray' | null>(null)
  const [over, setOver] = React.useState<string | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const nodes = flow.nodes
  const reachable = React.useMemo(() => {
    const seen = new Set<string>(), todo = [flow.start]
    while (todo.length) { const k = todo.pop()!; if (seen.has(k) || !nodes[k]) continue; seen.add(k); for (const s of slotsOf(nodes[k])) { const t = linkOf(nodes[k], s); if (t) todo.push(t) } }
    return seen
  }, [flow, nodes])
  const loose = Object.keys(nodes).filter((k) => !reachable.has(k))
  const selected = nodes[sel] ? sel : flow.start
  const setSel = onSelect

  const place = (owner: string, slot: Slot, d: Drag) => {
    const id = onChange((f) => {
      let id: string
      if (d.kind === 'new') id = addStep(f, d.type)
      else { id = d.id; if (id === f.start || id === owner) return; detach(f, id) }
      f.nodes[owner] = withLink(f.nodes[owner], slot, id)
      return id
    })
    if (id) setSel(id)
  }
  const drop = (e: React.DragEvent, owner: string, slot: Slot) => {
    e.preventDefault(); setOver(null); setDragging(false)
    try { place(owner, slot, JSON.parse(e.dataTransfer.getData('text/plain')) as Drag) } catch { /* not ours */ }
  }
  const startDrag = (e: React.DragEvent, d: Drag) => { e.dataTransfer.setData('text/plain', JSON.stringify(d)); e.dataTransfer.effectAllowed = 'move'; setDragging(true) }
  const firstEmpty = (): { owner: string; slot: Slot } | null => {
    const order = [selected, ...reachable]
    for (const k of order) for (const s of slotsOf(nodes[k] ?? ({ type: 'hangup' } as IvrNode))) if (s.k !== 'opt' && s.k !== 'kw' && !linkOf(nodes[k], s)) return { owner: k, slot: s }
    return null
  }
  const addFromPalette = (type: Kind) => {
    const target = firstEmpty()
    if (target) place(target.owner, target.slot, { kind: 'new', type })
    else { const id = onChange((f) => addStep(f, type)); if (id) setSel(id) } // nowhere free: it waits below, to be dragged into place
  }
  const remove = (id: string) => { if (removeStep(onChange, id)) setSel(flow.start) }

  const seen = new Set<string>()
  const renderSlot = (owner: string, slot: Slot): React.ReactNode => {
    const to = linkOf(nodes[owner], slot)
    const key = `${owner}:${slot.k}:${slot.key ?? ''}`
    return (
      <div key={key} className="relative ml-3 border-l-2 border-line/70 pl-4 pt-2">
        <span className="absolute -left-px top-[22px] h-0.5 w-3 bg-line/70" aria-hidden />
        <div className="mb-1.5 inline-block rounded-full bg-muted px-2.5 py-0.5 text-[11.5px] font-medium text-soft">{slot.label}</div>
        {to && nodes[to] ? renderNode(to) : (
          <div onDragOver={(e) => { e.preventDefault(); setOver(key) }} onDragLeave={() => setOver((o) => (o === key ? null : o))} onDrop={(e) => drop(e, owner, slot)}
            className={cn('flex items-center justify-between gap-2 rounded-xl border-2 border-dashed px-3 py-2.5 text-[13px] transition', over === key ? 'border-accent bg-accent-soft text-accent' : dragging ? 'border-accent/50 text-soft' : 'border-line text-soft')}>
            <span>{slot.k === 'on_fail' || slot.k === 'next' ? 'Nothing here: the call ends. Drop a step, or' : 'Drop a step here, or'}</span>
            <button type="button" onClick={() => setPicker({ owner, slot })} className="flex items-center gap-1 rounded-lg bg-surface px-2 py-1 font-medium text-ink shadow-sm hover:bg-muted"><Plus size={13} />Add</button>
          </div>)}
      </div>
    )
  }
  function renderNode(id: string): React.ReactNode {
    const n = nodes[id]
    if (seen.has(id)) return <button type="button" onClick={() => setSel(id)} className="rounded-xl border border-dashed px-3 py-2 text-left text-[13px] text-soft hover:bg-muted/50">↪ goes to <b className="text-ink">{nameOf(n)}</b></button>
    seen.add(id)
    const Icon = ICON[n.type], on = id === selected
    return (
      <div>
        <div draggable={id !== flow.start} onDragStart={(e) => startDrag(e, { kind: 'move', id })} onDragEnd={() => setDragging(false)}
          className={cn('rounded-xl border bg-surface transition', on ? 'border-accent ring-2 ring-accent/20' : 'hover:border-ink/30', id !== flow.start && 'cursor-grab active:cursor-grabbing')}>
          <button type="button" onClick={() => setSel(id)} className="flex w-full items-center gap-3 p-3 text-left" aria-pressed={on}>
            <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', on ? 'bg-accent text-accent-fg' : 'bg-muted text-ink')}><Icon size={17} /></span>
            <span className="min-w-0"><span className="block truncate text-[14px] font-semibold">{nameOf(n)}</span><span className="block truncate text-[12.5px] text-soft">{summary(n, agents)}</span></span>
            {id === flow.start && <span className="ml-auto shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">Start</span>}
          </button>
        </div>
        {slotsOf(n).map((s) => renderSlot(id, s))}
      </div>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[168px_1fr]">
      <div className="lg:sticky lg:top-4 lg:self-start">
        <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-soft">Add a step</div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
          {ORDER.map((t) => { const Icon = ICON[t]; return (
            <button key={t} type="button" draggable onDragStart={(e) => startDrag(e, { kind: 'new', type: t })} onDragEnd={() => setDragging(false)} onClick={() => addFromPalette(t)} title={TYPE[t].hint}
              className="flex cursor-grab items-center gap-2.5 rounded-xl border bg-surface px-3 py-2 text-left text-[13px] font-medium transition hover:border-accent hover:bg-accent-soft active:cursor-grabbing">
              <Icon size={15} className="shrink-0 text-soft" />{TYPE[t].name}
            </button>) })}
        </div>
        <p className="mt-2 hidden text-xs leading-snug text-soft lg:block">Drag a step into a dashed spot, or click it to add it next.</p>
      </div>
      <div className="min-w-0 space-y-4">
        {renderNode(flow.start)}
        {loose.length > 0 && (
          <div className="rounded-xl border border-dashed p-3">
            <div className="mb-2 text-[13px] font-medium">Not connected yet <span className="font-normal text-soft">· drag these into a dashed spot above</span></div>
            <div className="space-y-2">{loose.map((k) => { const n = nodes[k], Icon = ICON[n.type]; return (
              <div key={k} draggable onDragStart={(e) => startDrag(e, { kind: 'move', id: k })} onDragEnd={() => setDragging(false)} className={cn('flex cursor-grab items-center gap-3 rounded-xl border bg-surface p-2.5 active:cursor-grabbing', k === selected && 'border-accent ring-2 ring-accent/20')}>
                <button type="button" onClick={() => setSel(k)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted"><Icon size={15} /></span><span className="min-w-0"><span className="block truncate text-[13.5px] font-medium">{nameOf(n)}</span><span className="block truncate text-xs text-soft">{summary(n, agents)}</span></span></button>
                <button type="button" onClick={() => remove(k)} className="rounded-md p-1.5 text-soft hover:bg-muted hover:text-bad" aria-label="Delete step"><Trash2 size={14} /></button>
              </div>) })}</div>
          </div>)}
      </div>
      <Dialog open={!!picker} onOpenChange={(o) => !o && setPicker(null)} title="Add a step" description="What should happen here?">
        <div className="grid gap-2 sm:grid-cols-2">{ORDER.map((t) => { const Icon = ICON[t]; return (
          <button key={t} type="button" onClick={() => { if (picker && picker !== 'tray') place(picker.owner, picker.slot, { kind: 'new', type: t }); setPicker(null) }} className="flex items-center gap-3 rounded-xl border p-3 text-left transition hover:bg-muted/50">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted"><Icon size={16} /></span><span><span className="block text-[14px] font-medium">{TYPE[t].name}</span><span className="block text-xs text-soft">{TYPE[t].hint}</span></span>
          </button>) })}</div>
      </Dialog>
    </div>
  )
}

/** Delete a step and every link to it. The first step stays. Returns true when something was deleted. */
export function removeStep(onChange: Change, id: string): boolean {
  let done = false
  onChange((f) => { if (id === f.start || Object.keys(f.nodes).length < 2) return; detach(f, id); delete f.nodes[id]; done = true })
  return done
}

/** The editor for the selected step: only that step's own settings, in plain words. */
export function StepEditor({ id, flow, agents, onChange, onRemove }: { id: string; flow: IvrFlow; agents: Agent[]; onChange: Change; onRemove: (id: string) => void }) {
  const n = flow.nodes[id]
  if (!n) return <p className="text-sm text-soft">Click a step to edit it.</p>
  const Icon = ICON[n.type]
  const set = (p: Partial<IvrNode>) => { onChange((f) => { f.nodes[id] = { ...f.nodes[id], ...p } }) }
  const opts = Object.entries(n.options ?? {}), kws = Object.entries(n.keywords ?? {})
  const rekey = (m: Record<string, string>, from: string, to: string) => Object.fromEntries(Object.entries(m).map(([k, v]) => (k === from ? [to, v] : [k, v])))
  const addKey = () => onChange((f) => {
    const cur = f.nodes[id]; const free = DIGITS.find((d) => !(d in (cur.options ?? {}))); if (!free) return
    const c = newId(); f.nodes[c] = { type: 'say', label: `Option ${free}`, say: `You pressed ${free}.`, next: null }
    f.nodes[id] = { ...cur, options: { ...(cur.options ?? {}), [free]: c } }
  })
  const addWords = () => onChange((f) => {
    const cur = f.nodes[id]; const c = newId(); f.nodes[c] = { type: 'say', label: 'When they say it', say: 'Okay.', next: null }
    f.nodes[id] = { ...cur, keywords: { ...(cur.keywords ?? {}), [`word${Object.keys(cur.keywords ?? {}).length + 1}`]: c } }
  })
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-fg"><Icon size={17} /></span>
        <div className="min-w-0 flex-1"><div className="text-[12px] text-soft">{TYPE[n.type].name}</div><Input className="h-8 border-transparent px-1 text-[15px] font-semibold hover:border-line focus:border-line" value={n.label ?? ''} onChange={(e) => set({ label: e.target.value })} placeholder={TYPE[n.type].name} aria-label="Step name" /></div></div>
      {['menu', 'say', 'collect', 'transfer', 'voicemail', 'agent', 'hangup'].includes(n.type) && (
        <Field label={n.type === 'collect' ? 'What to ask' : n.type === 'voicemail' ? 'Before the beep' : n.type === 'transfer' ? 'Say before ringing' : n.type === 'agent' ? 'Say before the AI agent starts (optional)' : 'What callers hear'}>
          <Textarea rows={3} value={n.say ?? ''} onChange={(e) => set({ say: e.target.value })} placeholder="Type what to say…" />
        </Field>)}
      {n.type === 'menu' && <>
        <div><div className="mb-1.5 text-[13px] font-medium">When they press a key</div>
          <div className="space-y-1.5">{opts.map(([k, target], i) => (
            <div key={i} className="flex items-center gap-2"><Select className="w-20" value={k} onChange={(e) => onChange((f) => { f.nodes[id] = { ...f.nodes[id], options: rekey(f.nodes[id].options ?? {}, k, e.target.value) } })} aria-label="Key">{DIGITS.filter((d) => d === k || !(d in (n.options ?? {}))).map((d) => <option key={d}>{d}</option>)}</Select>
              <span className="min-w-0 flex-1 truncate text-[13px] text-soft">goes to <b className="text-ink">{flow.nodes[target] ? nameOf(flow.nodes[target]) : '—'}</b></span>
              <button type="button" onClick={() => onChange((f) => { const o = { ...(f.nodes[id].options ?? {}) }; delete o[k]; f.nodes[id] = { ...f.nodes[id], options: o } })} className="rounded-md p-1.5 text-soft hover:bg-muted hover:text-bad" aria-label="Remove key"><Trash2 size={14} /></button></div>))}</div>
          <Button size="sm" variant="ghost" className="mt-1" onClick={addKey}><Plus size={13} />Add a key</Button></div>
        <div><div className="mb-1.5 text-[13px] font-medium">Or when they say a word <span className="font-normal text-soft">(callers can also speak)</span></div>
          <div className="space-y-1.5">{kws.map(([k, target], i) => (
            <div key={i} className="flex items-center gap-2"><Input className="flex-1" value={k.startsWith('word') && /^word\d+$/.test(k) ? '' : k} placeholder="sales, price, buy" onChange={(e) => onChange((f) => { f.nodes[id] = { ...f.nodes[id], keywords: rekey(f.nodes[id].keywords ?? {}, k, e.target.value || k) } })} aria-label="Words" />
              <span className="shrink-0 text-xs text-soft">→ {flow.nodes[target] ? short(nameOf(flow.nodes[target]), 14) : '—'}</span>
              <button type="button" onClick={() => onChange((f) => { const o = { ...(f.nodes[id].keywords ?? {}) }; delete o[k]; f.nodes[id] = { ...f.nodes[id], keywords: o } })} className="rounded-md p-1.5 text-soft hover:bg-muted hover:text-bad" aria-label="Remove words"><Trash2 size={14} /></button></div>))}</div>
          <Button size="sm" variant="ghost" className="mt-1" onClick={addWords}><Plus size={13} />Add words</Button></div>
        <details className="rounded-xl border p-3 text-[13px]"><summary className="cursor-pointer font-medium">More options</summary>
          <div className="mt-3 space-y-3">
            <Field label="If they say something else, let an AI agent answer"><Select value={n.agent_id ?? ''} onChange={(e) => set({ agent_id: e.target.value || null })}><option value="">No, ask again</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
            <Field label="How many times to ask again"><Input type="number" min={0} max={5} value={n.retries ?? 2} onChange={(e) => set({ retries: Number(e.target.value) })} /></Field>
            <Field label="What to say when they don’t get it right"><Input value={n.invalid ?? ''} onChange={(e) => set({ invalid: e.target.value })} placeholder="Sorry, I didn’t get that." /></Field>
          </div></details>
      </>}
      {n.type === 'collect' && <div className="grid grid-cols-2 gap-3"><Field label="How many digits"><Input type="number" min={1} max={20} value={n.digits ?? 4} onChange={(e) => set({ digits: Number(e.target.value) })} /></Field><Field label="Remember it as"><Input value={n.var ?? 'code'} onChange={(e) => set({ var: e.target.value })} /></Field></div>}
      {n.type === 'transfer' && <><Field label="Phone number to ring"><Input value={n.number ?? ''} onChange={(e) => set({ number: e.target.value })} placeholder="+919876543210" /></Field><Field label="Say if nobody picks up"><Input value={n.fail_say ?? ''} onChange={(e) => set({ fail_say: e.target.value })} placeholder="Sorry, nobody is free right now." /></Field></>}
      {n.type === 'voicemail' && <Field label="Longest message (seconds)"><Input type="number" min={10} max={180} value={n.seconds ?? 60} onChange={(e) => set({ seconds: Number(e.target.value) })} /></Field>}
      {n.type === 'agent' && <Field label="Which AI agent takes the call"><Select value={n.agent_id ?? ''} onChange={(e) => set({ agent_id: e.target.value })}><option value="">Choose an agent…</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.status !== 'live' ? ' (not live yet)' : ''}</option>)}</Select></Field>}
      {n.type === 'hours' && <p className="rounded-xl bg-muted/50 p-3 text-[13px] text-soft">Callers go one way when you’re open and another way when you’re closed. Set your opening hours in Settings.</p>}
      {id !== flow.start && <Button variant="ghost" size="sm" className="text-bad" onClick={() => onRemove(id)}><Trash2 size={13} />Delete this step</Button>}
    </div>
  )
}
