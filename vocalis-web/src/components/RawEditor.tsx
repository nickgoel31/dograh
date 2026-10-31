import * as React from 'react'
import { Button, Textarea } from './ui'

/** Every setting of a step as JSON, for the settings the friendly fields don't cover. The server checks the flow when it is saved. */
export function RawEditor({ value, onApply }: { value: Record<string, unknown>; onApply: (obj: Record<string, unknown>) => void }) {
  const [text, setText] = React.useState(() => JSON.stringify(value, null, 2))
  const [bad, setBad] = React.useState(false)
  return (
    <details className="border-t pt-3"><summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-soft">All settings (JSON)</summary>
      <Textarea className="mt-2 min-h-[160px] font-mono text-xs" value={text} onChange={(e) => { setText(e.target.value); setBad(false) }} aria-label="All settings as JSON" />
      {bad && <p className="mt-1 text-xs text-bad">That isn't valid JSON</p>}
      <Button size="sm" className="mt-2" onClick={() => { try { const o = JSON.parse(text); if (o && typeof o === 'object' && !Array.isArray(o)) { onApply(o); setBad(false) } else setBad(true) } catch { setBad(true) } }}>Apply</Button></details>
  )
}
