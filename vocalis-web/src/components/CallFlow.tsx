import * as React from 'react'
import ReactFlow, {
  addEdge, Background, Controls, Handle, MarkerType, Position, useEdgesState, useNodesState, useReactFlow, ReactFlowProvider,
  type Connection, type Edge, type Node, type NodeProps,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Globe, LayoutGrid, Maximize2, Minimize2, Phone, Play, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, Field, Input, Textarea } from './ui'
import { AdvancedOnly, CodeBlock } from './shared'
import { cn, sleep } from '@/lib/utils'
import { StepOptions } from './FlowStepOptions'
import { RawEditor } from './RawEditor'

export interface FlowData { nodes: Node[]; edges: Edge[] }
type Kind = 'greeting' | 'ask' | 'tool' | 'condition' | 'transfer' | 'end' | 'global' | 'webhook' | 'trigger' | 'qa' | 'advanced'
const kinds: Record<Kind, { emoji: string; name: string; hint: string; color: string; text: string }> = {
  greeting: { emoji: '📞', name: 'Start call', hint: 'How the call begins', color: '#10b981', text: 'Hi, thanks for calling! How can I help?' },
  ask: { emoji: '❓', name: 'Ask a question', hint: 'Collect info', color: '#0ea5e9', text: 'May I have your name, please?' },
  tool: { emoji: '🔧', name: 'Do something', hint: 'Use a tool', color: '#10b981', text: 'Check the calendar and book a slot.' },
  condition: { emoji: '🔀', name: 'Yes / No check', hint: 'Branch the call', color: '#f59e0b', text: 'Did the caller ask for a person?' },
  transfer: { emoji: '🧑', name: 'Hand to a human', hint: 'Transfer', color: '#ef4444', text: 'Let me connect you with a teammate.' },
  end: { emoji: '✅', name: 'Close', hint: 'End the call', color: '#64748b', text: 'Thanks for calling. Have a lovely day!' },
  global: { emoji: '🌐', name: 'Global rules', hint: 'Always-on instructions', color: '#8b5cf6', text: 'Always be polite and keep answers short. Never make up prices.' },
  webhook: { emoji: '📤', name: 'Send call data', hint: 'Send details to a web address', color: '#0d9488', text: 'Sends what we learned on the call to your web address when it ends.' },
  trigger: { emoji: '⚡', name: 'API trigger', hint: 'Start calls from your own software', color: '#eab308', text: 'Lets your own software start calls with this agent.' },
  qa: { emoji: '🧪', name: 'Call quality check', hint: 'Review every call automatically', color: '#06b6d4', text: 'Reads each finished call and scores how well the agent did.' },
  advanced: { emoji: '⚙️', name: 'Advanced step', hint: 'Set up outside this editor', color: '#475569', text: 'This step was set up elsewhere. You can move it, but its settings are kept as they are.' },
}

/** Steps that float on their own, with no connections in or out. */
const FREE = ['global', 'webhook', 'trigger', 'qa']
type NodeData = { kind: Kind; label: string; text: string; active?: boolean; raw?: { data?: Record<string, unknown>; type?: string } }

function StepNode({ data, selected }: NodeProps<NodeData>) {
  const k = kinds[data.kind]
  const ring = selected ? 'border-accent ring-4 ring-accent/10' : 'border-line'
  const live = data.active && 'scale-105 border-ok shadow-pop'
  if (data.kind === 'greeting') {
    const prompt = String(data.raw?.data?.prompt ?? '')
    return (
      <div className={cn('w-64 overflow-hidden rounded-2xl border bg-surface shadow-card transition', ring, live)}>
        <div className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-emerald-500 px-3 py-2 text-[12px] font-semibold text-white"><Phone size={13} />Start call</div>
        <div className="p-3">
          <div className="truncate text-[13.5px] font-semibold">{data.label}</div>
          <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-soft">“{data.text}”</p>
          {prompt && <p className="mt-2 line-clamp-2 rounded-md bg-muted px-2 py-1 text-[10.5px] text-soft">Instructions: {prompt}</p>}
        </div>
        <Handle type="source" position={Position.Right} />
      </div>
    )
  }
  if (data.kind === 'global') {
    return (
      <div className={cn('w-64 rounded-2xl border-2 border-dashed bg-violet-500/5 p-3 transition', selected ? 'border-violet-500 ring-4 ring-violet-500/10' : 'border-violet-400/60', live)}>
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-600"><Globe size={13} />Global · every step</div>
        <div className="mt-1.5 truncate text-[13.5px] font-semibold">{data.label}</div>
        <p className="mt-0.5 line-clamp-3 text-[11.5px] leading-snug text-soft">{data.text}</p>
      </div>
    )
  }
  return (
    <div className={cn('w-56 rounded-xl border bg-surface p-3 shadow-card transition', ring, live)}>
      {!FREE.includes(data.kind) && <Handle type="target" position={Position.Left} />}
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-soft"><span className="flex h-5 w-5 items-center justify-center rounded-md text-[11px]" style={{ background: k.color + '22' }}>{k.emoji}</span>{k.name}</div>
      <div className="mt-2 truncate text-[13.5px] font-semibold">{data.label}</div>
      <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-soft">{data.text}</p>
      {data.kind === 'condition' ? (
        <>
          <Handle id="yes" type="source" position={Position.Right} style={{ top: '35%', background: '#10b981' }} />
          <Handle id="no" type="source" position={Position.Right} style={{ top: '75%', background: '#ef4444' }} />
          <div className="absolute -right-8 top-[22%] text-[10px] font-semibold text-ok">Yes</div><div className="absolute -right-6 top-[62%] text-[10px] font-semibold text-bad">No</div>
        </>
      ) : data.kind !== 'end' && data.kind !== 'transfer' && !FREE.includes(data.kind) ? <Handle type="source" position={Position.Right} /> : null}
    </div>
  )
}
const nodeTypes = { step: StepNode }

const edgeStyle = { type: 'smoothstep', animated: false, markerEnd: { type: MarkerType.ArrowClosed } }
const mk = (id: string, kind: Kind, x: number, y: number, label?: string, text?: string): Node => ({
  id, type: 'step', position: { x, y }, deletable: kind !== 'greeting', data: { kind, label: label ?? kinds[kind].name, text: text ?? kinds[kind].text },
})

export const defaultFlow = (): FlowData => ({
  nodes: [mk('greeting-1', 'greeting', 0, 120), mk('ask-2', 'ask', 330, 120, 'Qualify', 'Ask what they need and for whom.'), mk('condition-3', 'condition', 620, 120, 'Wants a person?'), mk('tool-4', 'tool', 920, 30, 'Book', 'Check the calendar and book a slot.'), mk('transfer-5', 'transfer', 920, 230), mk('end-6', 'end', 1200, 30), mk('global-7', 'global', 330, 340)],
  edges: [['greeting-1', 'ask-2'], ['ask-2', 'condition-3'], ['condition-3', 'tool-4', 'no'], ['condition-3', 'transfer-5', 'yes'], ['tool-4', 'end-6']].map(([s, t, h]) => ({ id: `${s}>${t}${h ? '#' + h : ''}`, source: s, target: t, sourceHandle: h, label: h === 'yes' ? 'Yes' : h === 'no' ? 'No' : undefined, ...edgeStyle })),
})

const clean = (ns: Node[], es: Edge[]): FlowData => ({
  nodes: ns.map(({ id, type, position, data, deletable }) => ({ id, type, position, ...(deletable === false ? { deletable: false } : {}), data: { kind: data.kind, label: data.label, text: data.text, ...(data.raw ? { raw: data.raw } : {}) } })),
  edges: es.map(({ id, source, target, sourceHandle, label, data }) => ({ id, source, target, sourceHandle, label, ...(data ? { data } : {}), ...edgeStyle })),
})
const sig = (f: FlowData) => JSON.stringify(f)
const typeFor = (k: string) => (k === 'greeting' ? 'startCall' : k === 'end' ? 'endCall' : k === 'global' ? 'globalNode' : k === 'webhook' ? 'webhook' : 'agentNode')

function Editor({ value, onChange, onSimulate }: { value: FlowData; onChange: (v: FlowData) => void; onSimulate?: () => void | Promise<void> }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(value.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(value.edges)
  const [sel, setSel] = React.useState<{ type: 'node' | 'edge'; id: string } | null>(null)
  const [running, setRunning] = React.useState(false)
  const [full, setFull] = React.useState(false)
  const rf = useReactFlow()
  const last = React.useRef(sig(clean(value.nodes, value.edges)))

  // Tell the page about edits (once things settle), and take in changes that came from outside, without echoing them back.
  React.useEffect(() => {
    const c = clean(nodes, edges)
    const s = sig(c)
    if (s === last.current) return
    const t = setTimeout(() => { last.current = s; onChange(c) }, 200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges])
  React.useEffect(() => {
    const s = sig(clean(value.nodes, value.edges))
    if (s === last.current) return
    last.current = s; setNodes(value.nodes); setEdges(value.edges); setSel(null)
    setTimeout(() => rf.fitView({ padding: 0.2, maxZoom: 1 }), 60)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  React.useEffect(() => {
    if (!full) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [full])
  React.useEffect(() => { const t = setTimeout(() => rf.fitView({ padding: 0.2, maxZoom: 1, duration: 200 }), 120); return () => clearTimeout(t) }, [full]) // eslint-disable-line react-hooks/exhaustive-deps

  const n = sel?.type === 'node' ? nodes.find((x) => x.id === sel.id) : undefined
  const edge = sel?.type === 'edge' ? edges.find((x) => x.id === sel.id) : undefined
  const hasStart = nodes.some((x) => x.data.kind === 'greeting')

  const connect = (c: Connection) => setEdges((es) => addEdge({ ...c, ...edgeStyle, label: c.sourceHandle === 'yes' ? 'Yes' : c.sourceHandle === 'no' ? 'No' : undefined }, es))
  const add = (kind: Kind) => {
    if (kind === 'greeting' && hasStart) { setSel({ type: 'node', id: nodes.find((x) => x.data.kind === 'greeting')!.id }); return toast('A call has one start. Edit it here.') }
    const id = `${kind}-${Date.now()}`
    const c = rf.project({ x: 320, y: 220 })
    const base = mk(id, kind, c.x + nodes.length * 8, c.y + nodes.length * 8)
    const defaults: Record<string, Record<string, unknown>> = {
      trigger: { name: kinds.trigger.name, trigger_path: crypto.randomUUID(), enabled: true },
      qa: { name: kinds.qa.name, qa_enabled: true, qa_use_workflow_llm: true, qa_min_call_duration: 15, qa_sample_rate: 100 },
    }
    if (defaults[kind]) base.data = { ...base.data, raw: { id, type: kind, position: base.position, data: defaults[kind] } }
    setNodes((ns) => [...ns.map((x) => ({ ...x, selected: false })), { ...base, selected: true }]); setSel({ type: 'node', id })
  }
  const setRaw = (key: string, v: unknown) => setNodes((ns) => ns.map((x) => (x.id === n?.id ? { ...x, data: { ...x.data, raw: { id: x.id, type: x.data.raw?.type ?? typeFor(x.data.kind), position: x.position, data: { ...(x.data.raw?.data ?? {}), [key]: v } } } } : x)))
  const patch = (p: Record<string, string>) => setNodes((ns) => ns.map((x) => (x.id === n?.id ? { ...x, data: { ...x.data, ...p } } : x)))
  const remove = () => {
    if (n && n.deletable !== false) { setNodes((ns) => ns.filter((x) => x.id !== n.id)); setEdges((es) => es.filter((e) => e.source !== n.id && e.target !== n.id)) }
    if (edge) setEdges((es) => es.filter((e) => e.id !== edge.id))
    setSel(null)
  }
  const setEdgeData = (p: Record<string, unknown>) => setEdges((es) => es.map((e) => (e.id === edge?.id ? { ...e, data: { ...(e.data ?? {}), ...p } } : e)))
  const tidy = () => {
    const depth: Record<string, number> = {}
    const walk = (id: string, d: number, seen: Set<string>) => { if (seen.has(id) || (depth[id] ?? -1) >= d) return; seen.add(id); depth[id] = d; edges.filter((e) => e.source === id).forEach((e) => walk(e.target, d + 1, seen)) }
    nodes.filter((x) => !FREE.includes(x.data.kind) && !edges.some((e) => e.target === x.id)).forEach((x) => walk(x.id, 0, new Set()))
    const rows: Record<number, number> = {}
    let free = 0
    setNodes((ns) => ns.map((x) => {
      if (FREE.includes(x.data.kind)) return { ...x, position: { x: free++ * 300, y: 420 } }
      const d = depth[x.id] ?? 0; const r = (rows[d] = (rows[d] ?? -1) + 1)
      return { ...x, position: { x: d * 320, y: r * 160 + 40 } }
    }))
    setTimeout(() => rf.fitView({ duration: 300, padding: 0.2, maxZoom: 1 }), 60)
  }
  const simulate = async () => {
    const start = nodes.find((x) => x.data.kind === 'greeting') ?? nodes[0]
    if (!start) return toast('Add a start step first')
    setRunning(true)
    let cur: string | undefined = start.id
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      seen.add(cur); const id: string = cur
      setNodes((ns) => ns.map((x) => ({ ...x, data: { ...x.data, active: x.id === id } })))
      await sleep(800)
      const outs = edges.filter((e) => e.source === id)
      cur = (outs.find((e) => e.sourceHandle === 'no') ?? outs[0])?.target
    }
    setNodes((ns) => ns.map((x) => ({ ...x, data: { ...x.data, active: false } })))
    setRunning(false); toast.success('Walk-through finished')
  }
  const tryCall = async () => { setRunning(true); try { await (onSimulate ? onSimulate() : simulate()) } finally { setRunning(false) } }
  const issues = [
    !hasStart && 'Add a Start call step so your agent knows how to begin.',
    !nodes.some((x) => ['end', 'transfer'].includes(x.data.kind)) && 'Add a Close step so calls end politely.',
    nodes.some((x) => x.data.kind !== 'greeting' && !FREE.includes(x.data.kind) && !edges.some((e) => e.target === x.id)) && 'Some steps are not connected to anything.',
  ].filter(Boolean) as string[]
  const raw = (n?.data.raw?.data ?? {}) as Record<string, unknown>
  const palette = (Object.keys(kinds) as Kind[]).filter((k) => k !== 'advanced')

  return (
    <div className={cn(full ? 'fixed inset-0 z-40 bg-bg p-2 md:p-3' : 'space-y-3')}>
      <div className={cn('grid gap-3 lg:grid-cols-[1fr_340px]', full && 'h-full grid-rows-[1fr_auto] lg:grid-rows-1')}>
        <div className={cn('relative overflow-hidden rounded-xl border bg-muted/40', full ? 'h-full min-h-0' : 'h-[calc(100dvh-230px)] min-h-[460px] lg:min-h-[600px]')}>
          <div className="absolute inset-x-2 top-2 z-10 flex gap-1 overflow-x-auto rounded-xl border bg-surface p-1.5 shadow-pop lg:inset-x-auto lg:left-3 lg:top-3 lg:max-h-[calc(100%-1.5rem)] lg:w-44 lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden">
            {palette.map((k) => (
              <button key={k} onClick={() => add(k)} title={kinds[k].hint} className="flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium transition hover:bg-muted lg:w-full">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs" style={{ background: kinds[k].color + '22' }}>{kinds[k].emoji}</span><span className="whitespace-nowrap lg:truncate">{kinds[k].name}</span>
              </button>
            ))}
          </div>
          <div className="absolute bottom-3 right-3 z-10 flex gap-1.5 lg:bottom-auto lg:top-3">
            <Button size="sm" onClick={tidy} aria-label="Tidy up"><LayoutGrid size={14} /><span className="hidden sm:inline">Tidy up</span></Button>
            <Button size="sm" onClick={() => { const f = defaultFlow(); setNodes(f.nodes); setEdges(f.edges); setSel(null); toast('Back to the starter flow'); setTimeout(() => rf.fitView({ padding: 0.2, maxZoom: 1 }), 60) }} aria-label="Reset"><RotateCcw size={14} /><span className="hidden sm:inline">Reset</span></Button>
            <Button size="sm" onClick={() => setFull((f) => !f)} aria-label={full ? 'Exit full screen' : 'Full screen'}>{full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</Button>
            <Button size="sm" variant="primary" disabled={running} onClick={tryCall}><Play size={14} />{running ? 'Working…' : 'Try a call'}</Button>
          </div>
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={connect}
            onNodeClick={(_, x) => setSel({ type: 'node', id: x.id })} onEdgeClick={(_, x) => setSel({ type: 'edge', id: x.id })} onPaneClick={() => setSel(null)}
            fitView fitViewOptions={{ padding: 0.25, maxZoom: 1 }} minZoom={0.2} deleteKeyCode={['Backspace', 'Delete']} proOptions={{ hideAttribution: true }}>
            <Background gap={22} size={1.2} /><Controls showInteractive={false} position="bottom-left" />
          </ReactFlow>
        </div>
        <Card className={cn('flex flex-col overflow-y-auto p-4', full ? 'max-h-[40dvh] lg:max-h-full' : 'lg:max-h-[calc(100dvh-230px)] lg:min-h-[600px]')}>
          {n ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between"><div className="text-sm font-semibold">{kinds[n.data.kind as Kind].emoji} {n.data.kind === 'greeting' ? 'Start call' : n.data.kind === 'global' ? 'Global rules' : 'Edit step'}</div>{n.deletable !== false && <Button size="sm" variant="ghost" className="text-bad" onClick={remove} aria-label="Delete step"><Trash2 size={14} />Delete</Button>}</div>
              <Field label="Name"><Input value={n.data.label} onChange={(e) => patch({ label: e.target.value })} /></Field>
              {n.data.kind === 'greeting' ? (<>
                <Field label="First thing the agent says"><Textarea className="min-h-[90px]" value={n.data.text} onChange={(e) => patch({ text: e.target.value })} /></Field>
                <Field label="Main instructions" hint={<span className="text-xs text-soft">Who the agent is and how it behaves. Same as the Personality tab.</span>}><Textarea className="min-h-[160px]" value={String(raw.prompt ?? '')} onChange={(e) => setRaw('prompt', e.target.value)} /></Field>
              </>) : n.data.kind === 'global' ? (
                <Field label="Rules that apply to every step" hint={<span className="text-xs text-soft">Added to every step's instructions.</span>}><Textarea className="min-h-[160px]" value={n.data.text} onChange={(e) => patch({ text: e.target.value })} /></Field>
              ) : (
                <Field label="What should the agent say or do?"><Textarea className="min-h-[120px]" value={n.data.text} disabled={n.data.kind === 'advanced'} onChange={(e) => patch({ text: e.target.value })} /></Field>
              )}
              {n.data.kind !== 'advanced' && <StepOptions kind={n.data.kind} data={raw} set={setRaw} />}
              <AdvancedOnly><RawEditor key={n.id} value={raw} onApply={(obj) => setNodes((ns) => ns.map((x) => (x.id === n.id ? { ...x, data: { ...x.data, raw: { id: x.id, type: x.data.raw?.type ?? typeFor(x.data.kind), position: x.position, data: obj } } } : x)))} /></AdvancedOnly>
              {n.data.kind === 'condition' && <p className="text-xs text-soft">Drag from the green dot for “Yes” and the red dot for “No”.</p>}
            </div>
          ) : edge ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between"><div className="text-sm font-semibold">Connection</div><Button size="sm" variant="ghost" className="text-bad" onClick={remove}><Trash2 size={14} />Delete</Button></div>
              <Field label="Label"><Input value={typeof edge.label === 'string' ? edge.label : ''} onChange={(e) => setEdges((es) => es.map((x) => (x.id === edge.id ? { ...x, label: e.target.value } : x)))} /></Field>
              <Field label="When should the agent move on?" hint={<span className="text-xs text-soft">In plain words, e.g. “the caller wants to book”.</span>}><Textarea className="min-h-[90px]" value={String((edge.data as { condition?: string } | undefined)?.condition ?? '')} onChange={(e) => setEdgeData({ condition: e.target.value })} /></Field>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="font-semibold">How this works</div>
              <ul className="list-disc space-y-1.5 pl-4 text-soft"><li>Pick a step to add it to the canvas.</li><li>Click a step or a line to edit it.</li><li>Drag from a dot to connect steps.</li><li>Press Delete to remove the selected step.</li></ul>
              {issues.length === 0 ? <div className="rounded-lg bg-ok/10 p-2.5 text-ok">✓ Your flow looks complete.</div> : issues.map((i) => <div key={i} className="rounded-lg bg-warn/10 p-2.5 text-warn">{i}</div>)}
            </div>
          )}
          <div className="mt-auto pt-4"><div className="rounded-xl bg-muted p-3 text-[12.5px] text-soft"><div className="mb-0.5 font-semibold text-ink">💡 Tips</div>Use the caller's name and details in what the agent says. Short sentences sound more natural on a call.</div></div>
        </Card>
      </div>
      {!full && <AdvancedOnly><CodeBlock json code={JSON.stringify(clean(nodes, edges), null, 2)} className="max-h-72 overflow-auto" /></AdvancedOnly>}
    </div>
  )
}

export function CallFlowEditor(p: { value: FlowData; onChange: (v: FlowData) => void; onSimulate?: () => void | Promise<void> }) {
  return <ReactFlowProvider><Editor {...p} /></ReactFlowProvider>
}
