import * as React from 'react'
import { toast } from 'sonner'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Field, Input, Switch, Textarea } from './ui'
import { http } from '@/lib/api/http'

type Settings = Record<string, unknown> & { ip_allowlist?: string[]; sso_domain?: string | null; sso_required?: boolean }
const say = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.')

/** Company sign-in (Google, for one email domain) and the list of networks that may use the workspace. */
export function NetworkSecurity({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['settings-security'], queryFn: () => http<Settings>('/team/settings') })
  const [ips, setIps] = React.useState('')
  const [domain, setDomain] = React.useState('')
  React.useEffect(() => { if (q.data) { setIps((q.data.ip_allowlist ?? []).join('\n')); setDomain(q.data.sso_domain ?? '') } }, [q.data])
  if (!q.data) return null
  const put = async (patch: Partial<Settings>, ok: string) => {
    const { notes: _n, ...base } = q.data as Settings & { notes?: unknown }
    try { await http('/team/settings', { method: 'PUT', json: { ...base, ...patch } }); toast.success(ok); qc.invalidateQueries({ queryKey: ['settings-security'] }) } catch (e) { say(e) }
  }
  const list = ips.split('\n').map((x) => x.trim()).filter(Boolean)
  return (
    <div className="space-y-5 border-t pt-5">
      <div>
        <div className="flex items-center gap-2 font-medium">Company sign-in with Google {q.data.sso_required && <Badge tone="green">On</Badge>}</div>
        <p className="mb-3 text-[13px] text-soft">Everyone with your company email signs in with Google, and joins this workspace as a viewer. Passwords stop working for that domain.</p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Company email domain"><Input className="w-56" placeholder="yourcompany.com" value={domain} disabled={!canEdit} onChange={(e) => setDomain(e.target.value)} /></Field>
          <Button disabled={!canEdit} onClick={() => put({ sso_domain: domain }, 'Saved')}>Save domain</Button>
          <div className="flex items-center gap-2 pb-2"><Switch checked={!!q.data.sso_required} onChange={(v) => put({ sso_domain: domain, sso_required: v }, v ? 'Company sign-in is on' : 'Company sign-in is off')} label="Require Google sign-in" /><span className="text-sm">Require it</span></div>
        </div>
        <p className="mt-2 text-xs text-soft">Google sign-in must be set up for the platform, and you need to be signed in with an email at that domain yourself.</p>
      </div>
      <div>
        <div className="flex items-center gap-2 font-medium">Allowed networks {list.length > 0 && q.data.ip_allowlist?.length ? <Badge tone="green">On</Badge> : null}</div>
        <p className="mb-3 text-[13px] text-soft">Only these internet addresses can use this workspace. Leave empty to allow everywhere. We check that it still includes you before saving.</p>
        <Field label="One address or range per line"><Textarea className="min-h-[90px] font-mono text-xs" placeholder={'203.0.113.7\n198.51.100.0/24'} value={ips} disabled={!canEdit} onChange={(e) => setIps(e.target.value)} /></Field>
        <Button className="mt-2" disabled={!canEdit} onClick={() => put({ ip_allowlist: list }, list.length ? 'Allowed networks saved' : 'Anyone can sign in again')}>Save networks</Button>
      </div>
    </div>
  )
}
