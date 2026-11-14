import * as React from 'react'
import { toast } from 'sonner'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, Input, Select, Switch } from '@/components/ui'
import { http } from '@/lib/api/http'
import { useData } from '@/store/data'
import { agentsApi, toAgent } from '@/lib/api/agents'
import type { Agent } from '@/mock/types'
import type { components } from '@/lib/api/schema'

/** The platform's own call settings, set exactly as in the classic UI: concurrency, ambient noise, turn detection, context compaction and call limits. */
type Style = {
  call_ambient?: { enabled: boolean; volume: number }; call_turn_strategy?: 'transcription' | 'turn_analyzer'; call_turn_secs?: number; call_compaction?: boolean
  call_max_seconds?: number; call_idle_seconds?: number; call_concurrency?: number; voicemail_detect?: boolean; max_minutes?: number; silence_seconds?: number
}
type Form = { concurrency: string; ambient: { enabled: boolean; volume: number }; strategy: 'transcription' | 'turn_analyzer'; turnSecs: number; compaction: boolean; maxSecs: number; idleSecs: number; voicemail: boolean }

const fromStyle = (s: Style): Form => ({
  concurrency: s.call_concurrency ? String(s.call_concurrency) : '',
  ambient: s.call_ambient ?? { enabled: false, volume: 0.3 },
  strategy: s.call_turn_strategy ?? 'transcription',
  turnSecs: s.call_turn_secs ?? 2,
  compaction: s.call_compaction ?? false,
  maxSecs: s.call_max_seconds ?? (s.max_minutes ?? 15) * 60,
  idleSecs: s.call_idle_seconds ?? s.silence_seconds ?? 10,
  voicemail: s.voicemail_detect ?? false,
})

const H = ({ t, d }: { t: string; d: string }) => <div className="space-y-0.5"><h4 className="text-[13px] font-semibold">{t}</h4><p className="text-xs text-soft">{d}</p></div>
const Lbl = ({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) => <div className="mb-1.5 flex items-center justify-between"><label className="text-[13px] font-medium">{children}</label>{right}</div>
const Hint = ({ children }: { children: React.ReactNode }) => <p className="mt-1.5 text-xs text-soft">{children}</p>
const Row = ({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-4 rounded-xl border bg-surface px-4 py-3"><div className="min-w-0"><div className="text-[13px] font-semibold">{title}</div>{desc && <p className="text-xs text-soft">{desc}</p>}</div>{children}</div>
)

export function CallSettings({ agent, separate = false }: { agent: Agent; separate?: boolean }) {
  const upsert = useData((s) => s.upsertAgent)
  const style = (agent.style as Style) ?? {}
  const [f, setF] = React.useState<Form>(fromStyle(style))
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => setF(fromStyle((agent.style as Style) ?? {})), [agent.id, agent.version]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }))
  const org = useQuery({ queryKey: ['concurrency', agent.id], queryFn: () => http<{ org_limit: number | null; allocated_others: number }>(`/agents/${agent.id}/concurrency`), retry: false })
  const initial = fromStyle(style)
  const dirty = JSON.stringify(f) !== JSON.stringify(initial)
  const limit = f.concurrency === '' ? 0 : Number(f.concurrency)
  const exceeded = !!org.data && org.data.org_limit != null && limit > 0 && org.data.allocated_others + limit > org.data.org_limit

  const save = async () => {
    setBusy(true)
    try {
      const body: Style = { call_ambient: { enabled: f.ambient.enabled, volume: f.ambient.volume }, call_turn_strategy: f.strategy, call_turn_secs: f.turnSecs, call_compaction: f.compaction, call_max_seconds: f.maxSecs, call_idle_seconds: f.idleSecs, voicemail_detect: f.voicemail, call_concurrency: limit }
      const out = await http<components['schemas']['AgentOut']>(`/agents/${agent.id}`, { method: 'PATCH', json: { style: body }, headers: { 'If-Match': String(agent.version ?? 0) } })
      upsert(toAgent(out, agent)); toast.success('Call settings saved. Go live again for real calls to use them.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'We could not save that.') } finally { setBusy(false) }
  }
  void agentsApi
  const num = (v: string, parse: (s: string) => number, ok: (n: number) => boolean, apply: (n: number) => void) => { const n = parse(v); if (!isNaN(n) && ok(n)) apply(n) }

  return (
    <Card className="mt-6 space-y-6 p-6">
      <div><h3 className="font-semibold">Call settings</h3><p className="text-[13px] text-soft">Concurrency, ambient noise, turn detection and call limits, exactly as in the classic app.</p></div>

      <div>
        <Lbl right={<span className="text-[11px] font-medium text-soft">Org Limit: {org.data?.org_limit ?? '—'}</span>}>Concurrency Limit</Lbl>
        <Input type="number" min={1} inputMode="numeric" value={f.concurrency} placeholder="Leave empty for unlimited (up to org limit)" onChange={(e) => set({ concurrency: e.target.value === '' ? '' : String(parseInt(e.target.value, 10) || '') })} />
        {exceeded && <p className="mt-1.5 text-xs text-bad">The sum of agent concurrency limits exceeds the total limit allocated for your organization ({org.data?.org_limit}).</p>}
      </div>

      <Row title="Ambient Noise" desc="Add background ambient noise to make the conversation sound more natural.">
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden text-xs font-semibold sm:inline">Use Ambient Noise</span>
          <Switch label="Use Ambient Noise" checked={f.ambient.enabled} onChange={(v) => set({ ambient: { ...f.ambient, enabled: v } })} />
        </div>
      </Row>
      {f.ambient.enabled && (
        <div className="-mt-3 max-w-[200px]"><Lbl>Volume</Lbl>
          <Input type="number" step="0.1" min={0} max={1} value={f.ambient.volume} onChange={(e) => num(e.target.value, parseFloat, (n) => n >= 0 && n <= 1, (n) => set({ ambient: { ...f.ambient, volume: n } }))} /></div>
      )}

      <div className="space-y-4 border-t pt-5">
        <H t="Turn Detection" d="Configure how the agent detects when the user has finished speaking." />
        <div>
          <Lbl>Detection Strategy</Lbl>
          <Select value={f.strategy} onChange={(e) => set({ strategy: e.target.value as Form['strategy'] })}>
            <option value="turn_analyzer">Smart Turn Analyzer</option>
            <option value="transcription">Server VAD (Transcription-based)</option>
          </Select>
          <Hint>{f.strategy === 'transcription' ? 'Best for short responses (1-2 word statements). Ends turn when transcription indicates completion.' : 'Best for longer responses with natural pauses. Uses ML model to detect end of turn.'}</Hint>
        </div>
        <div>
          <Lbl>Incomplete Turn Timeout (seconds)</Lbl>
          <Input type="number" step="0.5" min={0.5} max={10} value={f.turnSecs} className="font-mono" onChange={(e) => num(e.target.value, parseFloat, (n) => n >= 0.5 && n <= 10, (n) => set({ turnSecs: n }))} />
          <Hint>Max silence duration before ending an incomplete turn. Default: 2 seconds</Hint>
        </div>
      </div>

      <div className="space-y-3 border-t pt-5">
        <H t="Voicemail" d="When an answering machine picks up, hang up instead of talking to a recording, so you do not pay for it. Works well with campaigns: set them to retry on voicemail." />
        <Row title="Hang up on answering machines" desc={separate ? undefined : 'This voice talks speech-to-speech, which cannot listen for answering machines. Pick a Swarvo or Falcon voice to use this.'}>
          <Switch label="Hang up on answering machines" checked={f.voicemail} onChange={(v) => set({ voicemail: v })} /></Row>
      </div>

      <div className="space-y-3 border-t pt-5">
        <H t="Context Compaction" d="Automatically summarize conversation context when transitioning between nodes. Not applicable in Realtime mode — the speech-to-speech service manages its own conversation state and this setting is ignored." />
        <Row title="Enable Context Compaction"><Switch label="Enable Context Compaction" checked={f.compaction} onChange={(v) => set({ compaction: v })} /></Row>
      </div>

      <div className="space-y-4 border-t pt-5">
        <H t="Call Management" d="Configure call duration limits and idle timeout settings." />
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Lbl>Max Call Duration (seconds)</Lbl>
            <Input type="number" min={1} step={1} value={f.maxSecs} className="font-mono" onChange={(e) => num(e.target.value, (s) => parseInt(s, 10), (n) => n > 0 && n <= 14400, (n) => set({ maxSecs: n }))} />
            <Hint>Default: 900 (15 minutes)</Hint></div>
          <div><Lbl>Max User Idle Timeout (seconds)</Lbl>
            <Input type="number" min={1} step={1} value={f.idleSecs} className="font-mono" onChange={(e) => num(e.target.value, (s) => parseInt(s, 10), (n) => n > 0 && n <= 3600, (n) => set({ idleSecs: n }))} />
            <Hint>Default: 10 seconds</Hint></div>
        </div>
      </div>

      <Button variant="primary" onClick={save} disabled={busy || !dirty || exceeded}>{busy ? 'Saving…' : 'Save call settings'}</Button>
    </Card>
  )
}
