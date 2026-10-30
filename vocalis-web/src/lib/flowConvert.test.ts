import { describe, expect, it } from 'vitest'
import { edgeId, fromWorkflowDefinition, toWorkflowDefinition, type Definition, type Flow } from './flowConvert'

const edgeStyle = {}
const step = (id: string, kind: any, label: string, text: string, x = 0, y = 0) =>
  ({ id, type: 'step', position: { x, y }, data: { kind, label, text } }) as Flow['nodes'][number]

const editorFlow = (): Flow => ({
  nodes: [
    step('greeting-1', 'greeting', 'Hello', 'Hi, thanks for calling!', 0, 0),
    step('ask-2', 'ask', 'Qualify', 'Ask what they need.', 280, 0),
    step('condition-3', 'condition', 'Wants a person?', 'Did the caller ask for a person?', 560, 0),
    step('tool-4', 'tool', 'Book', 'Check the calendar and book.', 860, -90),
    step('transfer-5', 'transfer', 'Human', 'Connect them to a teammate.', 860, 90),
    step('end-6', 'end', 'Close', 'Thanks, goodbye!', 1140, 0),
  ],
  edges: [
    { id: edgeId('greeting-1', 'ask-2'), source: 'greeting-1', target: 'ask-2', ...edgeStyle },
    { id: edgeId('ask-2', 'condition-3'), source: 'ask-2', target: 'condition-3' },
    { id: edgeId('condition-3', 'tool-4', 'no'), source: 'condition-3', target: 'tool-4', sourceHandle: 'no', label: 'No' },
    { id: edgeId('condition-3', 'transfer-5', 'yes'), source: 'condition-3', target: 'transfer-5', sourceHandle: 'yes', label: 'Yes' },
    { id: edgeId('tool-4', 'end-6'), source: 'tool-4', target: 'end-6' },
  ],
})

/** A graph as the platform stores it: unknown ids, tools, extraction, a webhook, extra edge fields. */
const platformDef = (): Definition => ({
  nodes: [
    { id: 'a1', type: 'startCall', position: { x: 0, y: 0 }, data: { name: 'Start', prompt: 'You are Priya, a receptionist.', greeting: 'Hello!', greeting_type: 'text', is_start: true, allow_interrupt: true, add_global_prompt: false, tool_uuids: ['t-1'] } },
    { id: 'b2', type: 'agentNode', position: { x: 300, y: 0 }, data: { name: 'Book', prompt: 'Book a slot.', allow_interrupt: false, add_global_prompt: true, extraction_enabled: true, extraction_variables: [{ name: 'when', type: 'string', prompt: 'When?' }], document_uuids: ['d-1'] } },
    { id: 'w3', type: 'webhook', position: { x: 600, y: 0 }, data: { name: 'Notify CRM', enabled: true, http_method: 'POST', endpoint_url: 'https://example.com/h', payload_template: { id: '{{workflow_run_id}}' } } },
    { id: 'e4', type: 'endCall', position: { x: 600, y: 200 }, data: { name: 'Goodbye', prompt: 'Say goodbye.', is_end: true, allow_interrupt: false, add_global_prompt: false } },
  ],
  edges: [
    { id: 'x1', source: 'a1', target: 'b2', data: { label: 'Wants booking', condition: 'The caller wants to book', transition_speech: 'Great, one moment.' } },
    { id: 'x2', source: 'b2', target: 'e4', data: { label: 'Done', condition: 'Booking is finished' } },
  ],
})

describe('flow -> definition -> flow', () => {
  it('round-trips the editor flow exactly (ids, kinds, text, positions, branches)', () => {
    const flow = editorFlow()
    const back = fromWorkflowDefinition(toWorkflowDefinition(flow))
    const strip = (f: Flow) => ({
      nodes: f.nodes.map((n) => ({ id: n.id, kind: n.data.kind, label: n.data.label, text: n.data.text, position: n.position })),
      edges: f.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, handle: e.sourceHandle ?? null })),
    })
    expect(strip(back)).toEqual(strip(flow))
  })

  it('produces a valid-looking graph: one start, an end, labelled edges with conditions', () => {
    const d = toWorkflowDefinition(editorFlow())
    expect(d.nodes.filter((n) => n.type === 'startCall')).toHaveLength(1)
    expect(d.nodes.filter((n) => n.type === 'endCall')).toHaveLength(1)
    expect(d.nodes.find((n) => n.id === 'condition-3')?.type).toBe('agentNode')
    for (const e of d.edges) {
      expect(String(e.data.label).length).toBeGreaterThan(0)
      expect(String(e.data.condition).length).toBeGreaterThan(0)
    }
    const yes = d.edges.find((e) => e.id.endsWith('#yes'))!
    expect(yes.data.condition).toContain('yes')
  })

  it('greeting text becomes the spoken greeting, and a new start step also gets a prompt', () => {
    const start = toWorkflowDefinition(editorFlow()).nodes.find((n) => n.type === 'startCall')!
    expect(start.data.greeting).toBe('Hi, thanks for calling!')
    expect(start.data.prompt).toBe('Hi, thanks for calling!')
  })
})

describe('definition -> flow -> definition (imported platform graphs)', () => {
  it('survives untouched: unknown ids, tools, extraction, webhook and edge extras', () => {
    const def = platformDef()
    expect(toWorkflowDefinition(fromWorkflowDefinition(def))).toEqual(def)
  })

  it('shows unsupported steps as an Advanced step and keeps them out of the way', () => {
    const flow = fromWorkflowDefinition(platformDef())
    const w = flow.nodes.find((n) => n.id === 'w3')!
    expect(w.data.kind).toBe('advanced')
    expect(w.data.label).toBe('Notify CRM')
  })

  it('editing one step changes only that step, and never the agent prompt', () => {
    const def = platformDef()
    const flow = fromWorkflowDefinition(def)
    flow.nodes.find((n) => n.id === 'a1')!.data.text = 'Hi there!'
    flow.nodes.find((n) => n.id === 'b2')!.data.text = 'Find a time that suits them.'
    const out = toWorkflowDefinition(flow)
    const a1 = out.nodes.find((n) => n.id === 'a1')!
    expect(a1.data.greeting).toBe('Hi there!')
    expect(a1.data.prompt).toBe('You are Priya, a receptionist.')
    expect(a1.data.tool_uuids).toEqual(['t-1'])
    const b2 = out.nodes.find((n) => n.id === 'b2')!
    expect(b2.data.prompt).toBe('Find a time that suits them.')
    expect(b2.data.extraction_variables).toEqual(def.nodes[1].data.extraction_variables)
    expect(out.nodes.find((n) => n.id === 'w3')).toEqual(def.nodes[2])
  })

  it('moving an advanced step only changes its position', () => {
    const def = platformDef()
    const flow = fromWorkflowDefinition(def)
    flow.nodes.find((n) => n.id === 'w3')!.position = { x: 5, y: 6 }
    const w = toWorkflowDefinition(flow).nodes.find((n) => n.id === 'w3')!
    expect(w).toEqual({ ...def.nodes[2], position: { x: 5, y: 6 } })
  })

  it('a connection the user draws gets a friendly label and a condition', () => {
    const flow = fromWorkflowDefinition(platformDef())
    flow.edges.push({ id: 'new', source: 'b2', target: 'w3' })
    const e = toWorkflowDefinition(flow).edges.find((x) => x.id === 'new')!
    expect(e.data.label).toBe('Notify CRM')
    expect(e.data.condition).toBe('Continue to "Notify CRM"')
  })
})
