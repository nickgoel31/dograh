/**
 * Converts between the Call Flow editor's steps and the platform's conversation graph.
 * Pure functions, no React: see flowConvert.test.ts for the round-trip guarantees.
 *
 * Mapping
 *   greeting  -> startCall   (text = the spoken greeting; the agent's main prompt is never touched here)
 *   ask/tool/condition/transfer -> agentNode (text = that step's instructions)
 *   end       -> endCall
 *   condition -> an agentNode whose two outgoing edges carry "yes" / "no" conditions
 *   anything else (webhook, qa, trigger, global, ...) -> "advanced" step, kept byte-for-byte
 *
 * The platform drops unknown fields, so a step's kind is encoded in its id
 * ("ask-3") and an edge's yes/no branch in its id ("a>b#yes"). Whatever the
 * platform stored for a step (tools, extraction, ...) is kept in `data.raw` and
 * written back, so editing one field never loses the others.
 */

export type Kind = 'greeting' | 'ask' | 'tool' | 'condition' | 'transfer' | 'end' | 'global' | 'webhook' | 'trigger' | 'qa' | 'advanced'

export interface FlowNode {
  id: string
  type?: string
  position: { x: number; y: number }
  data: { kind: Kind; label: string; text: string; raw?: DefNode; [k: string]: unknown }
  [k: string]: unknown
}
export interface FlowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  label?: string
  data?: { condition?: string; raw?: Record<string, unknown> }
  [k: string]: unknown
}
export interface Flow { nodes: FlowNode[]; edges: FlowEdge[] }

export interface DefNode { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }
export interface DefEdge { id: string; source: string; target: string; data: Record<string, unknown> }
export interface Definition { nodes: DefNode[]; edges: DefEdge[] }

const KIND_FROM_ID = /^(greeting|ask|tool|condition|transfer|end|global|webhook|trigger|qa)-/
const DEFAULT_LABEL: Record<Exclude<Kind, 'advanced'>, string> = {
  greeting: 'Greeting', ask: 'Ask a question', tool: 'Do something', condition: 'Yes / No check', transfer: 'Hand to a human', end: 'Close', global: 'Rules for every step', webhook: 'Send call data', trigger: 'API trigger', qa: 'Call quality check',
}

export const newStepId = (kind: Kind, n: number) => `${kind}-${n}`
export const edgeId = (source: string, target: string, handle?: string | null) => `${source}>${target}${handle ? `#${handle}` : ''}`

function kindOf(n: DefNode): Kind {
  const m = KIND_FROM_ID.exec(n.id)
  if (m) return m[1] as Kind
  if (n.type === 'startCall') return 'greeting'
  if (n.type === 'endCall') return 'end'
  if (n.type === 'globalNode') return 'global'
  if (n.type === 'webhook') return 'webhook'
  if (n.type === 'trigger') return 'trigger'
  if (n.type === 'qa') return 'qa'
  if (n.type === 'agentNode') return 'ask' // a plain conversation step stays editable
  return 'advanced'
}

function handleOf(e: DefEdge): string | null {
  const m = /#(yes|no)$/.exec(e.id)
  return m ? m[1] : null
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

export function fromWorkflowDefinition(def: Definition): Flow {
  const nodes: FlowNode[] = (def.nodes ?? []).map((n) => {
    const kind = kindOf(n)
    const d = n.data ?? {}
    const text = kind === 'greeting' ? str(d.greeting) : kind === 'advanced' || kind === 'webhook' || kind === 'trigger' || kind === 'qa' ? '' : str(d.prompt)
    const label = str(d.name) || (kind === 'advanced' ? n.type : DEFAULT_LABEL[kind])
    return { id: n.id, type: 'step', position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 }, data: { kind, label, text, raw: n } }
  })
  const edges: FlowEdge[] = (def.edges ?? []).map((e) => {
    const handle = handleOf(e)
    return {
      id: e.id, source: e.source, target: e.target, sourceHandle: handle,
      label: handle === 'yes' ? 'Yes' : handle === 'no' ? 'No' : undefined,
      data: { condition: str(e.data?.condition), raw: e.data },
    }
  })
  return { nodes, edges }
}

export function toWorkflowDefinition(flow: Flow): Definition {
  const byId = new Map(flow.nodes.map((n) => [n.id, n]))
  const nodes: DefNode[] = flow.nodes.map((n) => {
    const { kind, label, text, raw } = n.data
    const position = { x: n.position.x, y: n.position.y }
    if (kind === 'advanced' && raw) return { ...raw, position } // untouched apart from where it sits
    const base = { ...(raw?.data ?? {}) }
    const type = kind === 'greeting' ? 'startCall' : kind === 'end' ? 'endCall' : kind === 'global' ? 'globalNode' : kind === 'webhook' ? 'webhook' : kind === 'trigger' ? 'trigger' : kind === 'qa' ? 'qa' : 'agentNode'
    const data: Record<string, unknown> = { ...base, name: label }
    if (kind === 'webhook' || kind === 'trigger') { if (data.enabled === undefined) data.enabled = true }
    if (kind === 'webhook' || kind === 'trigger' || kind === 'qa') return { id: n.id, type, position, data }
    if (kind === 'greeting') {
      data.greeting = text
      data.greeting_type = 'text'
      data.is_start = true
      // A brand-new start step needs some prompt; an existing one keeps the agent's own.
      if (!str(base.prompt)) data.prompt = text
    } else {
      data.prompt = text
      if (kind === 'end') data.is_end = true
    }
    if (data.allow_interrupt === undefined) data.allow_interrupt = kind !== 'end'
    if (data.add_global_prompt === undefined) data.add_global_prompt = false
    return { id: n.id, type: raw?.type && raw.type === type ? raw.type : type, position, data }
  })

  const edges: DefEdge[] = flow.edges.map((e) => {
    const src = byId.get(e.source)
    const tgt = byId.get(e.target)
    const handle = e.sourceHandle === 'yes' || e.sourceHandle === 'no' ? e.sourceHandle : null
    const id = e.id.includes('>') || !handle ? e.id : edgeId(e.source, e.target, handle)
    const fallbackLabel = handle ? (handle === 'yes' ? 'Yes' : 'No') : tgt?.data.label || 'Next'
    const condition = e.data?.condition
      || (handle ? `The answer to "${src?.data.text ?? ''}" is ${handle}` : `Continue to "${tgt?.data.label ?? 'the next step'}"`)
    const label = (typeof e.label === 'string' && e.label) || str(e.data?.raw?.label) || fallbackLabel
    return { id, source: e.source, target: e.target, data: { ...(e.data?.raw ?? {}), label, condition } }
  })
  return { nodes, edges }
}
