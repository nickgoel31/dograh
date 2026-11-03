import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Mic, Phone, Sparkles, Wallet } from '@/components/icons'
import { Button, Dialog } from '@/components/ui'
import { MeshBadge } from '@/layout/Shell'
import { http } from '@/lib/api/http'
import { USE_MOCKS } from '@/lib/api/env'
import { useMe } from '@/lib/useMe'
import { useData } from '@/store/data'
import { cn, money } from '@/lib/utils'

type Welcome = { bonus: number; currency: string; minutes_available: number }

const KEY = (id: string) => `swarvo-welcome:${id}`
const seen = (id: string) => { try { return localStorage.getItem(KEY(id)) === '1' } catch { return true } }
const markSeen = (id: string) => { try { localStorage.setItem(KEY(id), '1') } catch { /* it just shows again next time */ } }

/** Shown once to a new account: the free starting balance, then a short walk through the product. */
export function WelcomeTour() {
  const me = useMe().data
  const userId = me?.user.id ?? ''
  const agents = useData((s) => s.agents)
  const agentsLoaded = useData((s) => s.agentsLoaded)
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => { const t = setTimeout(() => setReady(true), 1500); return () => clearTimeout(t) }, []) // let the balance in the header load first
  const q = useQuery({ queryKey: ['welcome'], queryFn: () => http<Welcome>('/billing/welcome'), enabled: !USE_MOCKS && !!userId && ready, staleTime: Infinity })
  const [open, setOpen] = React.useState(false)
  const [step, setStep] = React.useState(0)
  const decided = React.useRef(false)

  React.useEffect(() => {
    if (decided.current || !userId || !agentsLoaded || !q.data) return
    decided.current = true
    if (!seen(userId) && (q.data.bonus > 0 || agents.length === 0)) setOpen(true)
  }, [userId, agentsLoaded, q.data, agents.length])

  const w = q.data
  const steps = [
    ...(w && w.bonus > 0 ? [{
      icon: <Wallet size={26} />, title: `Welcome! ${money(w.bonus)} is on us`,
      text: `We added ${money(w.bonus)} to your wallet so you can try everything. That is about ${Math.floor(w.minutes_available).toLocaleString('en-IN')} minutes of calls. No card needed.`,
    }] : [{ icon: <Sparkles size={26} />, title: 'Welcome to Swarvo AI', text: 'Build a voice agent that answers your calls. Here is a quick look around.' }]),
    { icon: <Sparkles size={26} />, title: 'Just tell the assistant', text: 'Your home page is an assistant. Say what your business does and it builds an agent for you. It asks you before it changes anything.' },
    { icon: <Mic size={26} />, title: 'Talk to your agent first', text: 'Open the Testing Lab and press Talk to speak with your agent in the browser. Practice calls never reach real callers.' },
    { icon: <Phone size={26} />, title: 'Go live when you are ready', text: 'Publish your agent, then get a phone number or bring your own. Add money from Billing any time. The more your wallet holds, the lower your price per minute.' },
  ]
  const last = step === steps.length - 1
  const close = () => { if (userId) markSeen(userId); setOpen(false) }
  const s = steps[Math.min(step, steps.length - 1)]

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close() }} title={s.title} description={s.text}>
      <div className="flex flex-col items-center py-2">
        <MeshBadge className="h-16 w-16 rounded-full">{s.icon}</MeshBadge>
        <div className="mt-5 flex gap-1.5" aria-label={`Step ${step + 1} of ${steps.length}`}>
          {steps.map((_, i) => <span key={i} className={cn('h-1.5 rounded-full transition-all', i === step ? 'w-5 bg-ink' : 'w-1.5 bg-line')} />)}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={close}>{last ? 'Close' : 'Skip'}</Button>
        <div className="flex gap-2">
          {step > 0 && <Button onClick={() => setStep(step - 1)}>Back</Button>}
          <Button variant="primary" onClick={() => (last ? close() : setStep(step + 1))}>{last ? 'Start building' : 'Next'}</Button>
        </div>
      </div>
    </Dialog>
  )
}
