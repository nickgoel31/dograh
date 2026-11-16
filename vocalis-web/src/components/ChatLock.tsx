import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageCircle } from '@/components/icons'
import { Badge, Button } from '@/components/ui'
import { CHAT_LOCKED } from '@/config/features'

/** Chat Agents is finished but not open to customers yet: the page stays visible behind a blur, with a message on top. */
export function ChatLock({ children }: { children: React.ReactNode }) {
  const nav = useNavigate()
  if (!CHAT_LOCKED) return <>{children}</>
  return (
    <div className="relative min-h-[calc(100dvh-9rem)]">
      <div aria-hidden ref={(el) => el?.setAttribute("inert", "")} className="pointer-events-none select-none blur-[7px] saturate-75">{children}</div>
      <div className="absolute inset-0 z-20 flex items-start justify-center bg-surface/40 px-4 pt-[12vh] backdrop-blur-[2px]">
        <div role="dialog" aria-modal="true" aria-labelledby="chat-lock-title" className="w-full max-w-md rounded-2xl border bg-surface p-7 text-center shadow-[0_24px_70px_-20px_hsl(var(--shadow)/.5)]">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent"><MessageCircle size={26} /></div>
          <Badge className="mt-4">Coming soon</Badge>
          <h2 id="chat-lock-title" className="mt-3 text-[22px] font-semibold tracking-[-0.02em]">Chat Agents are almost here</h2>
          <p className="mt-2 text-sm leading-relaxed text-soft">We're putting the finishing touches on website and WhatsApp chat agents. They will open for everyone very soon, and we'll let you know the moment they do.</p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button variant="primary" onClick={() => nav('/')}>Back to Voice Agents</Button>
            <Button onClick={() => nav('/help')}>Ask for early access</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
