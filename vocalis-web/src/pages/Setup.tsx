import * as React from 'react'
import { toast } from 'sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BRAND } from '@/config/brand'
import { Button, Card } from '@/components/ui'
import { http } from '@/lib/api/http'
import { authApi } from '@/lib/api'
import { useUI } from '@/store/ui'
import type { components } from '@/lib/api/schema'

/** Shown to someone who is signed in but isn't in a workspace yet (typically an account from the classic UI). */
export default function SetupPage() {
  const qc = useQueryClient()
  const set = useUI((s) => s.set)
  const { data, isPending } = useQuery({ queryKey: ['import-candidates'], queryFn: () => http<components['schemas']['Candidate'][]>('/import/candidates'), retry: false })
  const [busy, setBusy] = React.useState<string | null>(null)
  const done = () => { set({ workspaceId: null }); qc.invalidateQueries({ queryKey: ['me'] }) }
  const bring = async (id: string) => {
    setBusy(id)
    try {
      const r = await http<{ imported: number }>('/import', { method: 'POST', json: { organization_id: id } })
      toast.success(`Done! ${r.imported} agent${r.imported === 1 ? '' : 's'} brought over.`); done()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.') } finally { setBusy(null) }
  }
  const fresh = async () => {
    setBusy('new')
    try { await authApi.createWorkspace('My workspace'); done() } catch (e) { toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.') } finally { setBusy(null) }
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <Card className="w-full max-w-lg p-6">
        <h1 className="text-xl font-semibold">Welcome to {BRAND}</h1>
        <p className="mt-1 text-sm text-soft">Your account is ready. Choose how to start.</p>
        {isPending ? <p className="mt-6 text-sm text-soft">Looking for your existing setup…</p> : (data?.length ?? 0) > 0 && (
          <div className="mt-6 space-y-3">
            <h2 className="text-sm font-medium">Bring over what you already have</h2>
            {data!.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-lg border p-3">
                <div className="flex-1"><div className="font-medium">{c.name}</div><div className="text-xs text-soft">{c.agents} agent{c.agents === 1 ? '' : 's'}. They keep working as they do now, and your phone numbers and settings stay put.</div></div>
                <Button variant="primary" disabled={!!busy} onClick={() => bring(c.id)}>{busy === c.id ? 'Bringing over…' : 'Bring over'}</Button>
              </div>))}
          </div>)}
        <div className="mt-6 border-t pt-4"><Button className="w-full" disabled={!!busy} onClick={fresh}>{busy === 'new' ? 'Setting up…' : 'Start with a fresh workspace'}</Button></div>
        <p className="mt-3 text-center text-xs text-soft">You can switch back to the classic view any time.</p>
      </Card>
    </div>
  )
}
