import * as React from 'react'
import { toast } from 'sonner'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input } from '@/components/ui'
import { http } from '@/lib/api/http'
import { USE_MOCKS } from '@/lib/api/env'
import { useUI } from '@/store/ui'

export interface VerifyStatus { required: boolean; verified: boolean; phone: string | null; pending_phone: string | null; bonus: number }
const say = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.')

/** Asked once of every new account: prove you own a WhatsApp number. It stops one person collecting the free money many times. */
export function useVerify() {
  const workspaceId = useUI((s) => s.workspaceId)
  return useQuery({ queryKey: ['verify', workspaceId], queryFn: () => http<VerifyStatus>('/verify'), enabled: !USE_MOCKS, retry: false })
}

export function VerifyPhone({ status }: { status: VerifyStatus }) {
  const qc = useQueryClient()
  const [phone, setPhone] = React.useState('+91 ')
  const [code, setCode] = React.useState('')
  const [asking, setAsking] = React.useState(!status.pending_phone)
  const done = (s: VerifyStatus) => qc.setQueryData(['verify', useUI.getState().workspaceId], s)
  const start = useMutation({ mutationFn: () => http<VerifyStatus>('/verify/start', { method: 'POST', json: { phone } }), onSuccess: (s) => { done(s); setAsking(false); setCode(''); toast.success('Code sent on WhatsApp') }, onError: say })
  const check = useMutation({ mutationFn: () => http<VerifyStatus>('/verify/check', { method: 'POST', json: { code } }), onSuccess: (s) => { done(s); qc.invalidateQueries(); toast.success(status.bonus ? `Verified. ₹${status.bonus} added to your wallet` : 'Number verified') }, onError: say })
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-[420px] rounded-3xl border bg-surface p-6 sm:p-8">
        <h1 className="text-xl font-semibold">Verify your WhatsApp number</h1>
        <p className="mt-1.5 text-sm text-soft">{status.bonus ? `This keeps free credit fair for everyone. Once verified, ₹${status.bonus} goes into your wallet.` : 'This keeps your account safe and free credit fair for everyone.'}</p>
        {asking ? (
          <form className="mt-6 space-y-3" onSubmit={(e) => { e.preventDefault(); start.mutate() }}>
            <label className="block text-[13px] font-medium" htmlFor="wa">WhatsApp number</label>
            <Input id="wa" type="tel" inputMode="tel" autoComplete="tel" placeholder="+91 98111 12222" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <Button variant="primary" className="w-full" disabled={phone.replace(/\D/g, '').length < 10 || start.isPending}>{start.isPending ? 'Sending…' : 'Send code on WhatsApp'}</Button>
            {status.pending_phone && <button type="button" className="w-full text-center text-[13px] text-soft hover:text-ink" onClick={() => setAsking(false)}>I already have a code</button>}
          </form>
        ) : (
          <form className="mt-6 space-y-3" onSubmit={(e) => { e.preventDefault(); check.mutate() }}>
            <label className="block text-[13px] font-medium" htmlFor="otp">6-digit code sent to {status.pending_phone ?? 'your number'}</label>
            <Input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="text-center text-lg tracking-[0.4em]" />
            <Button variant="primary" className="w-full" disabled={code.length < 6 || check.isPending}>{check.isPending ? 'Checking…' : 'Verify'}</Button>
            <button type="button" className="w-full text-center text-[13px] text-soft hover:text-ink" onClick={() => setAsking(true)}>Use a different number or send again</button>
          </form>
        )}
      </div>
    </div>
  )
}
