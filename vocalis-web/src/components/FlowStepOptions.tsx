import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button, Field, Input, Select, Switch, Textarea } from './ui'

type Raw = Record<string, unknown>
type Variable = { name: string; type: string; prompt?: string }

/** The step settings the platform's own editor offers, in plain words. Values live on the step's saved data. */
export function StepOptions({ kind, data, set }: { kind: string; data: Raw; set: (key: string, value: unknown) => void }) {
  const vars = (data.extraction_variables as Variable[] | undefined) ?? []
  const [payload, setPayload] = React.useState(() => (data.payload_template ? JSON.stringify(data.payload_template, null, 2) : ''))
  const [payloadErr, setPayloadErr] = React.useState(false)
  const row = (label: string, hint: string, key: string, def: boolean) => (
    <div className="flex items-center justify-between gap-3"><div><div className="text-[13px] font-medium">{label}</div><div className="text-xs text-soft">{hint}</div></div>
      <Switch checked={(data[key] as boolean | undefined) ?? def} onChange={(v) => set(key, v)} label={label} /></div>)

  if (kind === 'webhook') return (
    <div className="space-y-3 border-t pt-3">
      {row('Send this', 'Turn off to pause without deleting', 'enabled', true)}
      <Field label="Web address"><Input value={(data.endpoint_url as string) ?? ''} onChange={(e) => set('endpoint_url', e.target.value)} placeholder="https://example.com/hooks/calls" /></Field>
      <Field label="Method"><Select value={(data.http_method as string) ?? 'POST'} onChange={(e) => set('http_method', e.target.value)}>{['POST', 'PUT', 'PATCH'].map((m) => <option key={m}>{m}</option>)}</Select></Field>
      <Field label="What to send (JSON)" hint={payloadErr ? <span className="text-xs text-bad">That isn't valid JSON</span> : <span className="text-xs text-soft">Use {'{{variables}}'} you collect.</span>}>
        <Textarea className="min-h-[100px] font-mono text-xs" value={payload} onChange={(e) => { setPayload(e.target.value); try { set('payload_template', e.target.value.trim() ? JSON.parse(e.target.value) : null); setPayloadErr(false) } catch { setPayloadErr(true) } }} /></Field>
    </div>
  )
  if (kind === 'global' || kind === 'condition' || kind === 'advanced') return null
  return (
    <div className="space-y-3 border-t pt-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-soft">More options</div>
      {kind !== 'end' && row('Callers can interrupt', 'It stops talking when the caller speaks', 'allow_interrupt', true)}
      {kind === 'greeting' && (<>
        {row('Wait a moment before speaking', 'Gives the line time to settle', 'delayed_start', false)}
        {Boolean(data.delayed_start) && <Field label="Wait (seconds)"><Input type="number" min={0} max={10} step={0.5} value={Number(data.delayed_start_duration ?? 1)} onChange={(e) => set('delayed_start_duration', Number(e.target.value))} /></Field>}
      </>)}
      {row('Collect details here', 'Pull things like name or date out of the conversation', 'extraction_enabled', false)}
      {Boolean(data.extraction_enabled) && (
        <div className="space-y-2">
          {vars.map((v, i) => (
            <div key={i} className="space-y-1.5 rounded-lg border p-2">
              <div className="flex gap-2"><Input value={v.name} placeholder="caller_name" aria-label="Detail name" onChange={(e) => set('extraction_variables', vars.map((x, j) => (j === i ? { ...x, name: e.target.value.replace(/[^a-z0-9_]/gi, '_').toLowerCase() } : x)))} />
                <Select className="w-28" value={v.type} onChange={(e) => set('extraction_variables', vars.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>{['string', 'number', 'boolean'].map((t) => <option key={t}>{t}</option>)}</Select>
                <Button size="sm" variant="ghost" aria-label="Remove detail" onClick={() => set('extraction_variables', vars.filter((_, j) => j !== i))}><Trash2 size={14} /></Button></div>
              <Input value={v.prompt ?? ''} placeholder="What to look for, in words" onChange={(e) => set('extraction_variables', vars.map((x, j) => (j === i ? { ...x, prompt: e.target.value } : x)))} />
            </div>))}
          <Button size="sm" onClick={() => set('extraction_variables', [...vars, { name: '', type: 'string', prompt: '' }])}><Plus size={14} />Add a detail</Button>
        </div>
      )}
    </div>
  )
}
