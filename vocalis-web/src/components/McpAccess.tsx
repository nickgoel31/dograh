import * as React from 'react'
import { toast } from 'sonner'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plug, Plus, ShieldCheck, Trash2 } from '@/components/icons'
import { Badge, Button, Card, Chip, Dialog, Field, Input } from '@/components/ui'
import { CodeBlock, ConfirmDialog, CopyButton } from '@/components/shared'
import { http } from '@/lib/api/http'
import { API_URL } from '@/lib/api/env'

type Token = { id: string; name: string; access: 'read' | 'full'; hint: string; created: string; last_used: string | null; token?: string | null; url?: string | null }
const say = (e: unknown) => toast.error(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
const root = () => new URL(API_URL.replace(/\/product$/, ''), window.location.origin).href.replace(/\/$/, '')
const urlFor = (t: string) => `${root()}/swarvo-mcp/t/${t}/`
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'never')

/** Let an AI assistant (Claude, ChatGPT and others) run this workspace through MCP. */
export function McpAccess() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['mcp-tokens'], queryFn: () => http<Token[]>('/developers/mcp-tokens'), retry: false })
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [access, setAccess] = React.useState<'full' | 'read'>('full')
  const [made, setMade] = React.useState<Token | null>(null)
  const [drop, setDrop] = React.useState<Token | null>(null)
  const create = useMutation({
    mutationFn: () => http<Token>('/developers/mcp-tokens', { method: 'POST', json: { name: name.trim(), access } }),
    onSuccess: (t) => { setMade(t); setOpen(false); setName(''); qc.invalidateQueries({ queryKey: ['mcp-tokens'] }) }, onError: say,
  })
  const url = made?.token ? urlFor(made.token) : ''
  return (
    <Card className="mb-6 p-6">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><Plug size={19} /></span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">Connect Claude, ChatGPT or any AI assistant (MCP)</h3>
          <p className="mt-1 text-[13px] text-soft">Give an assistant a token and it can run this workspace for you: build and publish agents, change voices, read conversations, manage numbers, knowledge, campaigns, API keys and more. It acts as you, so your role and limits apply.</p>
        </div>
        <Button variant="primary" onClick={() => setOpen(true)}><Plus size={15} />New token</Button>
      </div>

      {list.data && list.data.length > 0 && (
        <div className="mt-4 divide-y rounded-xl border">
          {list.data.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1"><div className="font-medium">{t.name}</div><div className="text-xs text-soft"><code>{t.hint}</code> · last used {when(t.last_used)}</div></div>
              <Badge tone={t.access === 'full' ? 'accent' : 'gray'}>{t.access === 'full' ? 'Full access' : 'Read-only'}</Badge>
              <Button size="sm" variant="ghost" className="hover:text-bad" aria-label={`Revoke ${t.name}`} onClick={() => setDrop(t)}><Trash2 size={14} /></Button>
            </div>))}
        </div>)}
      {list.data?.length === 0 && <p className="mt-4 text-[13px] text-soft">No tokens yet.</p>}

      <Dialog open={open} onOpenChange={setOpen} title="New MCP token" description="Name it after the assistant that will use it.">
        <div className="space-y-4">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Claude" autoFocus /></Field>
          <div>
            <div className="mb-2 text-[13px] font-medium">What can it do?</div>
            <div className="flex flex-wrap gap-2"><Chip active={access === 'full'} onClick={() => setAccess('full')}>Full access</Chip><Chip active={access === 'read'} onClick={() => setAccess('read')}>Read-only</Chip></div>
            <p className="mt-2 text-xs text-soft">{access === 'full' ? 'It can change anything you can, including publishing agents, buying numbers and starting campaigns. Start with read-only if you only want it to look.' : 'It can look at everything but change nothing.'}</p>
          </div>
          <div className="flex justify-end"><Button variant="primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>Create token</Button></div>
        </div>
      </Dialog>

      <Dialog open={!!made} onOpenChange={(o) => !o && setMade(null)} title="Your MCP connection" description="Copy it now. For safety it is shown only once." wide>
        {made && (
          <div className="space-y-5">
            <div className="flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-[13px]"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-accent" />Treat this address like a password. Anyone who has it can use this workspace with {made.access === 'full' ? 'full access' : 'read-only access'}. You can revoke it any time.</div>
            <div><div className="mb-1.5 text-[13px] font-medium">Connector address</div><div className="flex items-center gap-2"><div className="min-w-0 flex-1 overflow-x-auto rounded-lg border bg-muted/40 px-3 py-2 font-mono text-xs">{url}</div><CopyButton text={url} /></div></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border p-4"><div className="text-[13px] font-semibold">Claude</div><ol className="mt-2 list-decimal space-y-1 pl-4 text-[13px] text-soft"><li>Settings, then Connectors</li><li>Add custom connector</li><li>Paste the address above</li></ol></div>
              <div className="rounded-xl border p-4"><div className="text-[13px] font-semibold">ChatGPT</div><ol className="mt-2 list-decimal space-y-1 pl-4 text-[13px] text-soft"><li>Settings, then Connectors (turn on developer mode)</li><li>Create, choose MCP server</li><li>Paste the address, no sign-in needed</li></ol></div>
            </div>
            <div><div className="mb-1.5 text-[13px] font-medium">Claude Code, Cursor and other tools</div><CodeBlock code={`claude mcp add --transport http swarvo ${url}`} /></div>
            <div><div className="mb-1.5 text-[13px] font-medium">Or use a header instead of the address</div><CodeBlock code={`URL:    ${root()}/swarvo-mcp/\nHeader: Authorization: Bearer ${made.token}`} /></div>
          </div>)}
      </Dialog>

      <ConfirmDialog open={!!drop} onOpenChange={(o) => !o && setDrop(null)} danger confirm="Revoke" title={`Revoke ${drop?.name ?? 'this token'}?`} text="The assistant using it loses access straight away. You can make a new token any time."
        onConfirm={() => { const d = drop; if (d) http(`/developers/mcp-tokens/${d.id}`, { method: 'DELETE' }).then(() => { toast.success('Revoked'); qc.invalidateQueries({ queryKey: ['mcp-tokens'] }) }).catch(say) }} />
    </Card>
  )
}
