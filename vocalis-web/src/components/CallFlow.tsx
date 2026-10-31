import * as React from 'react'
import ReactFlow, {
  addEdge, Background, Controls, Handle, MarkerType, Position, useEdgesState, useNodesState, useReactFlow, ReactFlowProvider,
  type Connection, type Edge, type Node, type NodeProps,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { LayoutGrid, Play, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, Field, Input, Textarea } from './ui'
import { AdvancedOnly, CodeBlock } from './shared'
import { cn, sleep } from '@/lib/utils'
import { StepOptions } from './FlowStepOptions'
import { RawEditor } from './RawEditor'

export interface FlowData { nodes: Node[]; edges: Edge[] }
type Kind = 'greeting' | 'ask' | 'tool' | 'condition' | 'transfer' | 'end' | 'global' | 'webhook' | 'trigger' | 'qa' | 'advanced'
const kinds: Record<Kind, { emoji: string; name: string; hint: string; color: string; text: string }> = {
  greeting: { emoji: '👋', name: 'Greeting', hint: 'Say hello', color: '#6356f1', text: 'Hi, thanks for calling! How can I help?' },
  ask: { emoji: '❓', name: 'Ask a question', hint: 'Collect info', color: '#0ea5e9', text: 'May I have your name, please?' },
  tool: { emoji: '🔧', name: 'Do something', hint: 'Use a tool', color: '#10b981', text: 'Check the calendar and book a slot.' },
  condition: { emoji: '🔀', name: 'Yes / No check', hint: 'Branch the call', color: '#f59e0b', text: 'Did the caller ask for a person?' },
  transfer: { emoji: '🧑', name: 'Hand to a human', hint: 'Transfer', color: '#ef4444', text: 'Let me connect you with a teammate.' },
  end: { emoji: '✅', name: 'Close', hint: 'End the call', color: '#64748b', text: 'Thanks for calling. Have a lovely day!' },
  global: { emoji: '📌', name: 'Rules for every step', hint: 'Always-on instructions', color: '#8b5cf6', text: 'Always be polite and keep answers short. Never make up prices.' },
  webhook: { emoji: '📤', name: 'Send call data', hint: 'Send details to a web address', color: '#0d9488', text: 'Sends what we learned on the call to your web address when it ends.' },
  trigger: { emoji: '⚡', name: 'API trigger', hint: 'Start calls from your own software', color: '#eab308', text: 'Lets your own software start calls with this agent.' },
  qa: { emoji: '🧪', name: 'Call quality check', hint: 'Review every call automatically', color: '#06b6d4', text: 'Reads each finished call and scores how well the agent did.' },
  advanced: { emoji: '⚙️', name: 'Advanced step', hint: 'Set up outside this editor', color: '#475569', text: 'This step was set up elsewhere. You can move it, but its settings are kept as they are.' },
}

/** Steps that float on their own, with no connections in or out. */
const FREE = ['global', 'webhook', 'trigger', 'qa']

function StepNode({ data, selected }: NodeProps<{ kind: Kind; label: string; text: string; active?: boolean }>) {
  const k = kinds[data.kind]
  return (
    <div className={cn('w-56 rounded-xl border bg-surface p-3 shadow-card transition', selected ? 'border-accent ring-4 ring-accent/10' : 'border-line', data.active && 'scale-105 border-ok shadow-pop')}>
      {data.kind !== 'greeting' && !FREE.includes(data.kind) && <Handle type="target" position={Position.Left} />}
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
const mk = (id: string, kind: Kind, x: number, y: number, label?: string, text?: string): Node => ({ id, type: 'step', position: { x, y }, data: { kind, label: label ?? kinds[kind].name, text: text ?? kinds[kind].text } })

export const defaultFlow = (): FlowData => ({
  nodes: [mk('greeting-1', 'greeting', 0, 120), mk('ask-2', 'ask', 280, 120, 'Qualify', 'Ask what they need and for whom.'), mk('condition-3', 'condition', 560, 120, 'Wants a person?'), mk('tool-4', 'tool', 860, 30, 'Book', 'Check the calendar and book a slot.'), mk('transfer-5', 'transfer', 860, 230), mk('end-6', 'end', 1140, 30)],
  edges: [['greeting-1', 'ask-2'], ['ask-2', 'condition-3'], ['condition-3', 'tool-4', 'no'], ['condition-3', 'transfer-5', 'yes'], ['tool-4', 'end-6']].map(([s, t, h]) => ({ id: `${s}>${t}${h ? '#' + h : ''}`, source: s, target: t, sourceHandle: h, label: h === 'yes' ? 'Yes' : h === 'no' ? 'No' : undefined, ...edgeStyle })),
})

function Editor({ value, onChange, onSimulate }: { value: FlowData; onChange: (v: FlowData) => void; onSimulate?: () => void }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(value.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(value.edges)
  const [sel, setSel] = React.useState<string | null>(null)
  const [running, setRunning] = React.useState(false)
  const rf = useReactFlow()
  const n = nodes.find((x) => x.id === sel)
  const clean = (ns: Node[], es: Edge[]): FlowData => ({ nodes: ns.map(({ id, type, position, data }) => ({ id, type, position, data: { kind: data.kind, label: data.label, text: data.text, ...(data.raw ? { raw: data.raw } : {}) } })), edges: es.map(({ id, source, target, sourceHandle, label, data }) => ({ id, source, target, sourceHandle, label, ...(data ? { data } : {}), ...edgeStyle })) })
  React.useEffect(() => {
    const c = clean(nodes, edges)
    if (JSON.stringify(c) !== JSON.stringify(clean(value.nodes, value.edges))) onChange(c)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges])
  React.useEffect(() => { if (JSON.stringify(clean(nodes, edges)) !== JSON.stringify(clean(value.nodes, value.edges))) { setNodes(value.nodes); setEdges(value.edges) } /* eslint-disable-next-line */ }, [value])

  const connect = (c: Connection) => setEdges((es) => addEdge({ ...c, ...edgeStyle, label: c.sourceHandle === 'yes' ? 'Yes' : c.sourceHandle === 'no' ? 'No' : undefined }, es))
  const add = (kind: Kind) => {
    const id = `${kind}-${Date.now()}`
    const ns0 = nodes
    const p = rf.project({ x: 300, y: 200 })
    const base = mk(id, kind, p.x + ns0.length * 6, p.y + ns0.length * 6)
    const defaults: Record<string, Record<string, unknown>> = {
      trigger: { name: kinds.trigger.name, trigger_path: crypto.randomUUID(), enabled: true },
      qa: { name: kinds.qa.name, qa_enabled: true, qa_use_workflow_llm: true, qa_min_call_duration: 15, qa_sample_rate: 100 },
    }
    if (defaults[kind]) base.data = { ...base.data, raw: { id, type: kind, position: base.position, data: defaults[kind] } }
    setNodes((ns) => [...ns, { ...base, selected: true }]); setSel(id)
  }
  const typeFor = (k: string) => (k === 'greeting' ? 'startCall' : k === 'end' ? 'endCall' : k === 'global' ? 'globalNode' : k === 'webhook' ? 'webhook' : 'agentNode')
  const setRaw = (key: string, value: unknown) => setNodes((ns) => ns.map((x) => (x.id === sel ? { ...x, data: { ...x.data, raw: { id: x.id, type: x.data.raw?.type ?? typeFor(x.data.kind), position: x.position, data: { ...(x.data.raw?.data ?? {}), [key]: value } } } } : x)))
  const patch = (p: Record<string, string>) => setNodes((ns) => ns.map((x) => (x.id === sel ? { ...x, data: { ...x.data, ...p } } : x)))
  const remove = () => { if (!sel) return; setNodes((ns) => ns.filter((x) => x.id !== sel)); setEdges((es) => es.filter((e) => e.source !== sel && e.target !== sel)); setSel(null) }
  const tidy = () => {
    const depth: Record<string, number> = {}
    const walk = (id: string, d: number) => { if ((depth[id] ?? -1) >= d) return; depth[id] = d; edges.filter((e) => e.source === id).forEach((e) => walk(e.target, d + 1)) }
    nodes.filter((x) => !edges.some((e) => e.target === x.id)).forEach((x) => walk(x.id, 0))
    const rows: Record<number, number> = {}
    setNodes((ns) => ns.map((x) => { const d = depth[x.id] ?? 0; const r = (rows[d] = (rows[d] ?? -1) + 1); return { ...x, position: { x: d * 280, y: r * 150 + 40 } } }))
    setTimeout(() => rf.fitView({ duration: 300 }), 50)
  }
  const simulate = async () => {
    const start = nodes.find((x) => x.data.kind === 'greeting') ?? nodes[0]
    if (!start) return toast('Add a Greeting first')
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
    setRunning(false); toast.success('Simulated call finished')
  }
  const issues = [
    !nodes.some((x) => x.data.kind === 'greeting') && 'Add a Greeting so your agent knows how to start.',
    !nodes.some((x) => ['end', 'transfer'].includes(x.data.kind)) && 'Add a Close step so calls end politely.',
    nodes.some((x) => x.data.kind !== 'greeting' && !FREE.includes(x.data.kind) && !edges.some((e) => e.target === x.id)) && 'Some steps are not connected to anything.',
  ].filter(Boolean) as string[]

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <div className="relative h-[680px] overflow-hidden rounded-xl border bg-muted/40">
          <div className="absolute left-3 top-3 z-10 max-h-[calc(100%-1.5rem)] w-44 overflow-y-auto rounded-xl border bg-surface p-1.5 shadow-pop">
            {(Object.keys(kinds) as Kind[]).filter((k) => k !== 'advanced').map((k) => (
              <button key={k} onClick={() => add(k)} title={kinds[k].hint} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium transition hover:bg-muted">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs" style={{ background: kinds[k].color + '22' }}>{kinds[k].emoji}</span><span className="truncate">{kinds[k].name}</span>
              </button>
            ))}
          </div>
          <div className="absolute right-3 top-3 z-10 flex gap-1.5">
            <Button size="sm" onClick={tidy}><LayoutGrid size={14} />Tidy up</Button>
            <Button size="sm" onClick={() => { const f = defaultFlow(); setNodes(f.nodes); setEdges(f.edges); setSel(null); toast('Back to the starter flow') }}><RotateCcw size={14} />Reset</Button>
            <Button size="sm" variant="primary" disabled={running} onClick={onSimulate ?? simulate}><Play size={14} />{running ? 'Running…' : onSimulate ? 'Try a call' : 'Simulate a call'}</Button>
          </div>
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={connect}
            onNodeClick={(_, x) => setSel(x.id)} onPaneClick={() => setSel(null)} fitView fitViewOptions={{ padding: 0.3, minZoom: 0.6, maxZoom: 1 }} deleteKeyCode={['Backspace', 'Delete']} proOptions={{ hideAttribution: true }}>
            <Background gap={22} size={1.2} /><Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <Card className="flex max-h-[680px] flex-col overflow-y-auto p-4">
          {n ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between"><div className="text-sm font-semibold">{kinds[n.data.kind as Kind].emoji} Edit step</div><Button size="sm" variant="ghost" className="text-bad" onClick={remove} aria-label="Delete step"><Trash2 size={14} />Delete</Button></div>
              <Field label="Step name"><Input value={n.data.label} onChange={(e) => patch({ label: e.target.value })} /></Field>
              <Field label="What should the agent say or do?"><Textarea className="min-h-[120px]" value={n.data.text} disabled={n.data.kind === 'advanced'} onChange={(e) => patch({ text: e.target.value })} /></Field>
              {n.data.kind === 'greeting' && <Field label="Main instructions" hint={<span className="text-xs text-soft">Who the agent is and how it behaves. The same text as the Personality tab.</span>}><Textarea className="min-h-[140px]" value={String((n.data.raw?.data as Record<string, unknown> | undefined)?.prompt ?? '')} onChange={(e) => setRaw('prompt', e.target.value)} /></Field>}
              {n.data.kind !== 'advanced' && <StepOptions kind={n.data.kind} data={(n.data.raw?.data ?? {}) as Record<string, unknown>} set={setRaw} />}
              <AdvancedOnly><RawEditor key={n.id} value={(n.data.raw?.data ?? {}) as Record<string, unknown>} onApply={(obj) => setNodes((ns) => ns.map((x) => (x.id === sel ? { ...x, data: { ...x.data, raw: { id: x.id, type: x.data.raw?.type ?? typeFor(x.data.kind), position: x.position, data: obj } } } : x)))} /></AdvancedOnly>
              {n.data.kind === 'condition' && <p className="text-xs text-soft">Drag from the green dot for “Yes” and the red dot for “No”.</p>}
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="font-semibold">How this works</div>
              <ul className="list-disc space-y-1.5 pl-4 text-soft"><li>Pick a step on the left to add it.</li><li>Click a step to edit what it says.</li><li>Drag from a dot to connect steps.</li><li>Press Delete to remove a step.</li></ul>
              {issues.length === 0 ? <div className="rounded-lg bg-ok/10 p-2.5 text-ok">✓ Your flow looks complete.</div> : issues.map((i) => <div key={i} className="rounded-lg bg-warn/10 p-2.5 text-warn">{i}</div>)}
            </div>
          )}
          <div className="mt-auto pt-4"><div className="rounded-xl bg-muted p-3 text-[12.5px] text-soft"><div className="mb-0.5 font-semibold text-ink">💡 Tips</div>Use the person's name and details in what the agent says. Short sentences sound more natural on a call.</div></div>
        </Card>
      </div>
      <AdvancedOnly><CodeBlock json code={JSON.stringify(clean(nodes, edges), null, 2)} className="max-h-72 overflow-auto" /></AdvancedOnly>
    </div>
  )
}

export function CallFlowEditor(p: { value: FlowData; onChange: (v: FlowData) => void; onSimulate?: () => void }) {
  return <ReactFlowProvider><Editor {...p} /></ReactFlowProvider>
}
