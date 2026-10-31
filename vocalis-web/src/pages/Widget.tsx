/** The call window inside a customer's website (loaded in an iframe by widget.js). No sign-in. */
import * as React from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Mic, PhoneOff } from 'lucide-react'
import { Button } from '@/components/ui'
import { useAgentCall } from '@/lib/call'
import { BRAND } from '@/config/brand'

export default function WidgetPage() {
  const { agentId = '' } = useParams()
  const [sp] = useSearchParams()
  const widget = React.useMemo(() => ({ embedder: sp.get('embedder') ?? '' }), [sp])
  const { status, error, lines, start, end } = useAgentCall(agentId, widget)
  const live = status === 'live' || status === 'connecting'
  return (
    <div className="flex h-screen flex-col bg-bg p-4 text-fg">
      <div className="flex-1 space-y-2 overflow-y-auto">
        {lines.length === 0 && !error && <p className="mt-10 text-center text-sm text-soft">{status === 'idle' ? 'Press the button and say hello.' : status === 'connecting' ? 'Connecting…' : ''}</p>}
        {lines.map((l) => <div key={l.id} className={l.who === 'agent' ? 'max-w-[85%] rounded-2xl bg-muted px-3 py-2 text-sm' : 'ml-auto max-w-[85%] rounded-2xl bg-accent px-3 py-2 text-sm text-accent-fg'}>{l.text}</div>)}
        {error && <p role="alert" className="text-center text-sm text-bad">{error}</p>}
        {status === 'ended' && <p className="text-center text-sm text-soft">The call has ended.</p>}
      </div>
      <div className="pt-3">
        {live ? <Button className="w-full" onClick={end}><PhoneOff size={16} />End call</Button> : <Button variant="primary" className="w-full" onClick={start}><Mic size={16} />{status === 'idle' ? 'Start talking' : 'Talk again'}</Button>}
        <p className="mt-2 text-center text-[11px] text-soft">Powered by {BRAND}</p>
      </div>
    </div>
  )
}
