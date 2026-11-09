import * as React from 'react'
import { Glyph } from '@/components/Glyph'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Command } from 'cmdk'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle, AlertTriangle, CheckCircle2, Coins, Globe, Info, Key, Loader2, Mail, BarChart3, BookOpen, Bell, Bot, ChevronDown, ChevronRight, Code2, CreditCard, FlaskConical, HelpCircle, Home, Megaphone, Menu as MenuIcon,
  MessageCircle, Mic2, Moon, Plus, Users, Wallet, PanelLeftClose, PanelLeftOpen, Phone, PhoneCall, Plug, Search, Settings, Sparkles, Sun, Check, ChevronsUpDown, Zap,
} from '@/components/icons'
import { Toaster, toast } from 'sonner'
import { Bubble } from '@typebot.io/react'
import { VerifyPhone, useVerify } from '@/components/VerifyPhone'
import { BRAND } from '@/config/brand'
import { useMe } from '@/lib/useMe'
import { http } from '@/lib/api/http'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { USE_MOCKS, authApi } from '@/lib/api'
import { BASE, CLASSIC_URL } from '@/lib/api/env'
import { queryClient } from '@/lib/query'
import { useUI } from '@/store/ui'
import { useData } from '@/store/data'
import { calls } from '@/mock/calls'
import { Button, Menu, MenuContent, MenuItem, MenuSep, MenuTrigger, Switch, TooltipProvider } from '@/components/ui'
import { PlaygroundModal } from '@/components/Playground'
import { AgentAvatar } from '@/components/AgentAvatar'
import { CHAT_LIVE } from '@/config/features'
import { GetStarted } from '@/components/GetStarted'
import { cn, money } from '@/lib/utils'

const main = [
  { to: '/', label: 'Home', icon: Home }, { to: '/agents', label: 'Agents', icon: Bot }, { to: '/conversations', label: 'Conversations', icon: PhoneCall }, { to: '/live', label: 'Live calls', icon: Zap }, { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/numbers', label: 'Phone Numbers', icon: Phone }, { to: '/campaigns', label: 'Campaigns', icon: Megaphone }, { to: '/knowledge', label: 'Knowledge', icon: BookOpen },
  { to: '/tools', label: 'Tools & Integrations', icon: Plug }, { to: '/voices', label: 'Voices', icon: Mic2 }, { to: '/testing', label: 'Testing Lab', icon: FlaskConical },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
]
const build = [{ to: '/developers', label: 'Developers', icon: Code2 }, { to: '/billing', label: 'Billing & Usage', icon: CreditCard }]
const all = Object.fromEntries([...main, ...build].map((n) => [n.to, n])) as Record<string, (typeof main)[number]>
const extra = [
  { to: '/chat', label: 'Overview', icon: MessageCircle }, { to: '/chat/inbox', label: 'Inbox', icon: Mail }, { to: '/chat/channels', label: 'Channels', icon: Globe }, { to: '/swarvo-api', label: 'Overview', icon: Code2 },
  { to: '/swarvo-api/docs', label: 'Documentation', icon: BookOpen }, { to: '/swarvo-api/models', label: 'Models', icon: Sparkles }, { to: '/swarvo-api/pricing', label: 'Pricing', icon: Coins },
  { to: '/developers', label: 'API keys & webhooks', icon: Key },
]
for (const n of extra) if (!all[n.to] || n.to === '/developers') all[n.to] = n.to === '/developers' ? all[n.to] : n
const pick = (...paths: string[]) => paths.map((p) => all[p])
type Group = { title?: string; items: (typeof main)[number][] }
const GROUPS: Record<'voice' | 'chat' | 'api', Group[]> = {
  voice: [
    { items: pick('/') },
    { title: 'Build', items: pick('/agents', '/voices', '/knowledge', '/tools', '/testing') },
    { title: 'Data', items: pick('/conversations', '/live', '/contacts', '/analytics') },
    { title: 'Reach', items: pick('/numbers', '/campaigns') },
    { title: 'Account', items: pick('/billing', '/developers') },
  ],
  chat: CHAT_LIVE ? [{ items: pick('/chat') }, { title: 'Conversations', items: pick('/chat/inbox') }, { title: 'Set up', items: pick('/chat/channels') }] : [{ items: [{ to: '/chat', label: 'Chat Agents', icon: MessageCircle }] }],
  api: [
    { items: pick('/swarvo-api') },
    { title: 'Build', items: [{ to: '/developers', label: 'API keys & webhooks', icon: Key }, ...pick('/swarvo-api/docs')] },
    { title: 'Platform', items: pick('/swarvo-api/models', '/swarvo-api/pricing') },
    { title: 'Account', items: pick('/billing') },
  ],
}
export const PLATFORMS = [
  { id: 'voice' as const, label: 'Voice Agents', blurb: 'Answer and make phone calls', icon: Mic2, home: '/' },
  { id: 'chat' as const, label: 'Chat Agents', blurb: CHAT_LIVE ? 'Website and WhatsApp chat' : 'Coming soon', icon: MessageCircle, home: '/chat' },
  { id: 'api' as const, label: 'Swarvo API', blurb: 'Keys, docs, models and pricing', icon: Code2, home: '/swarvo-api' },
]
/** Pages that belong to one platform only. Billing, settings and help are shared, so they keep whichever platform you are in. */
export const platformOf = (path: string): 'voice' | 'chat' | 'api' | null => {
  if (path.startsWith('/chat')) return 'chat'
  if (path.startsWith('/swarvo-api') || path.startsWith('/developers')) return 'api'
  if (['/billing', '/settings', '/help', '/welcome', '/invite', '/admin'].some((p) => path.startsWith(p))) return null
  return 'voice'
}
const bottom = [{ to: '/settings', label: 'Settings', icon: Settings }, { to: '/help', label: 'Help', icon: HelpCircle }]
const demoWorkspaces = ['Sunrise Dental', 'GlowUp Salon']

/** A small soft two-colour gradient tile, used for the organization, wallet and profile icons. */
export const MeshBadge = ({ className, children }: { className?: string; children?: React.ReactNode }) => (
  <span className={cn('relative flex shrink-0 items-center justify-center overflow-hidden bg-[#3b82f6] font-bold text-white', className)}>
    <span className="absolute -left-1/4 -top-1/4 h-[85%] w-[85%] rounded-full bg-[#22d3ee] blur-[7px]" aria-hidden />
    <span className="absolute -bottom-1/4 -right-1/4 h-[90%] w-[90%] rounded-full bg-[#7c3aed] blur-[8px]" aria-hidden />
    <span className="relative flex items-center justify-center [text-shadow:0_1px_2px_rgba(0,0,0,.35)]">{children}</span>
  </span>
)

export const Logo = ({ name, logo }: { name?: string | null; logo?: string | null }) => {
  const [own, setOwn] = React.useState(true)
  const src = logo || (own && !name ? `${import.meta.env.BASE_URL}swarvo-logo.webp` : null)
  return (
    <div className="flex items-center gap-2.5 font-['Sora'] text-[19px] font-semibold leading-6 tracking-[-0.03em]">
      {src ? <img src={src} alt="" onError={() => setOwn(false)} className={cn("h-6 w-6 rounded-md object-contain", !logo && "dark:invert")} /> : <div className="brand-gradient flex h-8 w-8 items-center justify-center rounded-[10px] text-accent-fg shadow-glow"><Mic2 size={16} /></div>}{name || BRAND}
    </div>
  )
}

/** '#0b5c4c' -> '166 80% 20%' so the whole app can take the brand colour. */
function hexToHsl(hex: string): string | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return null
  const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  const h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return `${Math.round((h * 60 + 360) % 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

function NavItem({ to, label, icon: Icon, collapsed, onClick }: (typeof main)[number] & { collapsed: boolean; onClick?: () => void }) {
  return (
    <NavLink to={to} end={to === '/'} onClick={onClick} title={collapsed ? label : undefined}
      className={({ isActive }) => cn('flex items-center gap-3 rounded-[10px] px-3 py-2 text-[13px] font-medium transition duration-150', isActive ? 'bg-[hsl(228_22%_93%)] text-ink dark:bg-[#262628] dark:text-white' : 'text-soft hover:bg-muted/60 hover:text-ink')}>
      {({ isActive }) => <><Icon size={16} strokeWidth={1.75} className={cn('shrink-0', isActive && 'text-[#3b5bdb]')} />{!collapsed && label}</>}
    </NavLink>
  )
}

function SidebarBody({ collapsed, close }: { collapsed: boolean; close?: () => void }) {
  const { workspace, workspaceId, view, set, platform } = useUI()
  const nav = useNavigate()
  const here = PLATFORMS.find((x) => x.id === platform) ?? PLATFORMS[0]
  const advancedOnly = new Set(['/developers', '/testing']) // shown only in Advanced view
  const { data: me } = useMe()
  // Real mode: the user's actual workspaces. Mock mode: the demo list.
  const list = USE_MOCKS ? demoWorkspaces.map((n, i) => ({ id: String(i), name: n })) : (me?.workspaces ?? [])
  const activeId = USE_MOCKS ? String(workspace) : (workspaceId ?? me?.current_workspace.id ?? '')
  const active = list.find((w) => w.id === activeId) ?? list[0] ?? { id: '', name: BRAND }
  const pick = (w: { id: string; name: string }) => { set(USE_MOCKS ? { workspace: Number(w.id) } : { workspaceId: w.id }); toast.success(`Switched to ${w.name}`) }
  return (
    <div className="flex h-full flex-col gap-5 px-3 pb-2 pt-5">
      <div className={cn('flex items-center px-1 pt-1', 'justify-between')}>{collapsed ? <img src={`${import.meta.env.BASE_URL}swarvo-logo.webp`} alt="" className="ml-1 h-6 w-6 rounded-md object-contain dark:invert" /> : <Logo name={me?.branding?.name} logo={me?.branding?.logo} />}</div>
      {!collapsed && (
        <Menu>
          <MenuTrigger asChild>
            <button className="flex w-full items-center gap-2.5 rounded-xl border border-line/80 bg-surface px-3 py-2 text-left text-sm transition hover:border-soft/40 hover:bg-muted">
              <MeshBadge className="h-7 w-7 rounded-lg text-xs">{active.name[0]}</MeshBadge>
              <span className="flex-1 truncate font-medium">{active.name}</span><ChevronsUpDown size={14} className="text-soft" />
            </button>
          </MenuTrigger>
          <MenuContent align="start" className="w-60">
            {list.map((w) => <MenuItem key={w.id} onSelect={() => pick(w)}>{w.name}{w.id === active.id && <Check size={14} className="ml-auto" />}</MenuItem>)}
          </MenuContent>
        </Menu>
      )}
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Main">
        {GROUPS[platform].map((g, gi) => {
          const shown = g.items.filter((n) => view === 'advanced' || !advancedOnly.has(n.to))
          if (!shown.length) return null
          return (
            <div key={gi} className="flex flex-col gap-1">
              {g.title && (collapsed ? <div className="my-2 h-px bg-line" /> : <div className="px-3 pb-1 pt-5 text-[12px] font-medium text-soft/70">{g.title}</div>)}
              {shown.map((n) => <NavItem key={n.to} {...n} collapsed={collapsed} onClick={close} />)}
            </div>
          )
        })}
        <div className="mt-auto pt-4">{(me?.is_admin ? [{ to: '/admin', label: 'Admin', icon: Key }, ...bottom] : bottom).map((n) => <NavItem key={n.to} {...n} collapsed={collapsed} onClick={close} />)}</div>
      </nav>
      {!collapsed && (
        <Menu>
          <MenuTrigger asChild>
            <button className="flex w-full items-center gap-2.5 rounded-xl border bg-surface px-2.5 py-2 text-left text-sm transition hover:bg-muted" aria-label="Switch platform">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink text-surface"><here.icon size={15} /></span>
              <span className="flex-1 truncate font-medium">{here.label}</span><ChevronsUpDown size={14} className="text-soft" />
            </button>
          </MenuTrigger>
          <MenuContent align="start" side="top" className="w-64">
            {PLATFORMS.map((x) => (
              <MenuItem key={x.id} onSelect={() => { set({ platform: x.id }); close?.(); nav(x.home) }} className="gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted"><x.icon size={16} /></span>
                <span className="min-w-0 flex-1"><span className="block text-[13.5px] font-medium">{x.label}</span><span className="block text-xs text-soft">{x.blurb}</span></span>
                {x.id === platform && <Check size={14} />}
              </MenuItem>))}
          </MenuContent>
        </Menu>
      )}
    </div>
  )
}

const crumbNames: Record<string, string> = { agents: 'Agents', conversations: 'Conversations', live: 'Live calls', contacts: 'Contacts', numbers: 'Phone Numbers', campaigns: 'Campaigns', knowledge: 'Knowledge', tools: 'Tools & Integrations', voices: 'Voices', testing: 'Testing Lab', analytics: 'Analytics', developers: 'Developers', billing: 'Billing & Usage', 'swarvo-api': 'Swarvo API', chat: 'Chat Agents', inbox: 'Inbox', channels: 'Channels', docs: 'Documentation', models: 'Models', pricing: 'Pricing', settings: 'Team & Settings', help: 'Help', new: 'New', templates: 'Templates' }
function Breadcrumbs() {
  const { pathname } = useLocation()
  const agents = useData((s) => s.agents)
  const parts = pathname.split('/').filter(Boolean)
  const name = (p: string, i: number) => crumbNames[p] ?? (parts[0] === 'agents' ? agents.find((a) => a.id === p)?.name : p) ?? p
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm text-soft [&>*:not(:last-child)]:max-sm:hidden">
      <Link to="/" className="hover:text-ink">{BRAND}</Link>
      {parts.map((p, i) => (
        <React.Fragment key={i}><ChevronRight size={13} />
          {i === parts.length - 1 ? <span className="truncate font-medium text-ink">{name(p, i)}</span> : <Link to={'/' + parts.slice(0, i + 1).join('/')} className="hover:text-ink">{name(p, i)}</Link>}
        </React.Fragment>
      ))}
    </nav>
  )
}

const alerts = [
  { t: 'Your calendar got disconnected', d: 'Click to reconnect so bookings keep working.', to: '/tools', tone: 'text-warn' },
  { t: 'You have used 80% of this month’s limit', d: 'Raise your limit or top up to avoid interruptions.', to: '/billing', tone: 'text-warn' },
  { t: 'Priya just took her 1,000th call', d: 'Nice milestone. See how she’s doing.', to: '/agents/a1', tone: 'text-ok' },
]

function WalletChip() {
  const q = useQuery({ queryKey: ['wallet-chip'], queryFn: () => http<{ balance: number; minutes_available: number; currency: string; low_balance: boolean }>('/billing/wallet'), enabled: !USE_MOCKS, refetchInterval: 60000 })
  const nav = useNavigate()
  const w = USE_MOCKS ? { balance: 1240, minutes_available: 206, currency: 'INR', low_balance: false } : q.data
  if (!w) return null
  return (
    <button onClick={() => nav('/billing')} title="Your balance. Click to add money or see usage." aria-label="Wallet balance"
      className="group hidden h-10 items-center gap-2.5 rounded-full border bg-surface py-1 pl-1 pr-1 transition hover:bg-muted sm:flex">
      <MeshBadge className="h-8 w-8 rounded-full"><Wallet size={14} /></MeshBadge>
      <span className="flex flex-col items-start leading-none">
        <span className="num text-[13.5px] font-semibold tracking-tight">{money(w.balance)}</span>
        <span className="mt-[3px] flex items-center gap-1 text-[11px] text-soft">
          {w.low_balance && <span className="h-1.5 w-1.5 rounded-full bg-warn" />}{w.low_balance ? 'Low balance' : `${Math.floor(w.minutes_available)} min left`}
        </span>
      </span>
      <span className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-muted text-ink transition group-hover:bg-ink group-hover:text-surface"><Plus size={14} /></span>
    </button>
  )
}

function Topbar({ openNav }: { openNav: () => void }) {
  const { theme, collapsed, set } = useUI()
  const me = useMe().data
  const mode = useUI((s) => s.mode)
  const qc = useQueryClient()
  const notes = useQuery({ queryKey: ['notifications', mode], queryFn: () => http<{ unread: number; items: { id: string; title: string; body: string; link: string | null; read: boolean }[] }>('/notifications'), enabled: !USE_MOCKS, refetchInterval: 30000 })
  const unread = USE_MOCKS ? 1 : notes.data?.unread ?? 0
  const bell: { t: string; d: string; to: string; tone: string; unread?: boolean }[] = USE_MOCKS ? alerts.map((x) => ({ ...x, unread: true })) : (notes.data?.items ?? []).map((n) => ({ t: n.title, d: n.body, to: n.link ?? '/', tone: n.read ? 'text-soft' : 'text-ink', id: n.id, unread: !n.read }))
  const initials = USE_MOCKS ? 'AS' : (me?.user.name || me?.user.email || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  const nav = useNavigate()
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 rounded-t-2xl border-b border-line/60 bg-surface/90 px-3 backdrop-blur sm:gap-3 md:px-6">
      <Button variant="ghost" size="icon" className="md:hidden" onClick={openNav} aria-label="Open menu"><MenuIcon size={18} /></Button>
      <Button variant="ghost" size="icon" className="hidden md:inline-flex" onClick={() => set({ collapsed: !collapsed })} aria-label="Collapse sidebar">{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</Button>
      <div className="min-w-0 flex-1"><Breadcrumbs /></div>
      <button onClick={() => set({ palette: true })} className="hidden h-10 items-center gap-2.5 rounded-xl border border-transparent bg-muted/70 px-3.5 text-sm text-soft transition hover:border-line hover:bg-muted sm:flex">
        <Search size={14} />Search<kbd className="ml-8 rounded-md border bg-surface px-1.5 py-0.5 text-[11px] font-medium">⌘K</kbd>
      </button>
      <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => set({ palette: true })} aria-label="Search"><Search size={18} /></Button>
      <WalletChip />
      <Menu>
        <MenuTrigger asChild><button className="relative flex h-10 w-10 items-center justify-center rounded-full border bg-surface text-soft transition hover:bg-muted hover:text-ink" aria-label="Notifications"><Bell size={17} strokeWidth={1.75} />{unread > 0 && <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-bad ring-2 ring-surface" />}</button></MenuTrigger>
        <MenuContent align="end" className="w-[22rem] p-0">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && !USE_MOCKS && <button className="text-xs font-medium text-accent hover:underline" onClick={() => http('/notifications/read-all', { method: 'POST' }).then(() => qc.invalidateQueries({ queryKey: ['notifications'] }))}>Mark all as read</button>}
          </div>
          {bell.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-soft"><Bell size={18} strokeWidth={1.75} /></span>
              <div className="text-sm font-medium">You are all caught up</div>
              <div className="text-xs text-soft">New alerts will show up here.</div>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto p-1.5">
              {bell.map((a) => (
                <MenuItem key={a.t} onSelect={() => nav(a.to)} className="items-start gap-3 rounded-lg px-3 py-2.5">
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', a.unread ? 'bg-accent' : 'bg-transparent')} />
                  <span className="flex min-w-0 flex-col gap-0.5"><span className="text-[13px] font-medium text-ink">{a.t}</span><span className="text-xs leading-snug text-soft">{a.d}</span></span>
                </MenuItem>
              ))}
            </div>
          )}
        </MenuContent>
      </Menu>
      <Menu>
        <MenuTrigger asChild><button className="rounded-full ring-2 ring-surface transition hover:opacity-90" aria-label="Account menu"><MeshBadge className="h-10 w-10 rounded-full text-[13px]">{initials}</MeshBadge></button></MenuTrigger>
        <MenuContent align="end">
          <div className="px-2.5 py-2"><div className="font-medium">{USE_MOCKS ? 'Aarav Sharma' : me?.user.name}</div><div className="text-xs text-soft">{USE_MOCKS ? 'aarav@sunrisedental.in' : me?.user.email}</div></div>
          <MenuSep />
          <MenuItem onSelect={() => set({ theme: theme === 'dark' ? 'light' : 'dark' })}>{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}{theme === 'dark' ? 'Light mode' : 'Dark mode'}</MenuItem>
          <MenuItem onSelect={() => nav('/settings')}><Settings size={15} />Settings</MenuItem>
          {!USE_MOCKS && CLASSIC_URL && <MenuItem onSelect={switchToClassic}>Switch to classic UI</MenuItem>}
          <MenuItem onSelect={signOut}>Sign out</MenuItem>
        </MenuContent>
      </Menu>
    </header>
  )
}

async function switchToClassic() {
  try {
    const { code } = await authApi.handoffStart('classic')
    window.location.assign(`${CLASSIC_URL}/handoff?code=${encodeURIComponent(code)}`)
  } catch { toast.error('We could not switch right now. Please try again.') }
}

async function signOut() {
  if (USE_MOCKS) { toast('This is a demo, so there is nothing to sign out of'); return }
  try { await authApi.logout() } finally { queryClient.clear(); window.location.assign(`${BASE}/`) }
}

function CommandPalette() {
  const { palette, set } = useUI()
  const mode = useUI((u) => u.mode)
  const agents = useData((u) => u.agents)
  const nav = useNavigate()
  const [q, setQ] = React.useState('')
  const [dq, setDq] = React.useState('')
  const go = (to: string) => { set({ palette: false }); nav(to) }
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); useUI.getState().set({ palette: !useUI.getState().palette }) } }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [])
  React.useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t) }, [q])
  React.useEffect(() => { if (!palette) { setQ(''); setDq('') } }, [palette])

  const needle = q.trim().toLowerCase()
  const real = !USE_MOCKS
  const search = real && palette && dq.length >= 2
  const enc = encodeURIComponent(dq)
  type CallHit = { id: string; caller: string; phone: string | null; agent_name: string | null }
  type ContactHit = { id: string; name: string | null; phone: string }
  const callsQ = useQuery({ queryKey: ['search', 'calls', dq, mode], queryFn: () => http<{ calls: CallHit[] }>(`/conversations?q=${enc}&limit=5`), enabled: search })
  const contactsQ = useQuery({ queryKey: ['search', 'contacts', dq, mode], queryFn: () => http<{ contacts: ContactHit[] }>(`/contacts?q=${enc}&limit=5`), enabled: search })
  const numbersQ = useQuery({ queryKey: ['search', 'numbers', mode], queryFn: () => http<{ id: string; number: string; agent_name: string | null }[]>('/numbers'), enabled: real && palette, staleTime: 60000 })
  const docsQ = useQuery({ queryKey: ['search', 'docs', mode], queryFn: () => http<{ id: string; title: string; kind: string }[]>('/knowledge'), enabled: real && palette, staleTime: 60000 })
  const has = (...t: (string | null | undefined)[]) => !needle || t.some((x) => (x ?? '').toLowerCase().includes(needle))

  const pages = [...main, ...build, ...bottom].filter((n) => has(n.label))
  const agentHits = agents.filter((a) => has(a.name, a.role)).slice(0, 6)
  const callHits: CallHit[] = real ? (needle ? callsQ.data?.calls ?? [] : []) : calls.filter((c) => has(c.caller, c.phone)).slice(0, 6).map((c) => ({ id: c.id, caller: c.caller, phone: c.phone, agent_name: null }))
  const contactHits = needle ? contactsQ.data?.contacts ?? [] : []
  const numberHits = needle ? (numbersQ.data ?? []).filter((n) => has(n.number, n.agent_name)).slice(0, 5) : []
  const docHits = needle ? (docsQ.data ?? []).filter((d) => has(d.title)).slice(0, 5) : []
  const total = pages.length + agentHits.length + callHits.length + contactHits.length + numberHits.length + docHits.length
  const loading = search && (callsQ.isFetching || contactsQ.isFetching)
  const ask = () => { try { sessionStorage.setItem('assistant-prompt', q.trim()) } catch { /* the assistant just opens empty */ } go('/') }

  const item = 'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm aria-selected:bg-muted'
  const head = '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-soft'
  const tile = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-soft'
  return (
    <Command.Dialog open={palette} onOpenChange={(o) => set({ palette: o })} shouldFilter={false} label="Search" overlayClassName="fixed inset-0 z-[70] bg-black/40" contentClassName="fixed left-1/2 top-[14vh] z-[71] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border bg-surface">
      <div className="flex items-center gap-3 border-b px-4"><Search size={16} className="text-soft" /><Command.Input value={q} onValueChange={setQ} placeholder="Search agents, calls, contacts, numbers, knowledge…" className="h-[52px] flex-1 bg-transparent text-[15px] outline-none placeholder:text-soft/70" />{loading && <Loader2 size={15} className="animate-spin text-soft" />}</div>
      <Command.List className={cn('max-h-[55vh] overflow-y-auto p-2', head)}>
        {needle.length >= 3 && real && <Command.Item value="ask" onSelect={ask} className={item}><span className={cn(tile, 'bg-accent-soft text-accent')}><Sparkles size={14} /></span><span className="min-w-0 truncate">Ask the assistant: <b className="font-medium">{q.trim()}</b></span></Command.Item>}
        {!needle && <Command.Item value="setup guide" onSelect={() => { set({ palette: false, guide: true }) }} className={item}><span className={cn(tile, 'bg-accent-soft text-accent')}><Sparkles size={14} /></span><span className="min-w-0 truncate">Open the setup guide</span></Command.Item>}
        {total === 0 && !loading && <div className="py-10 text-center text-sm text-soft">{needle ? 'Nothing found. Try another word.' : 'Start typing to search.'}</div>}
        {agentHits.length > 0 && <Command.Group heading="Agents">{agentHits.map((a) => <Command.Item key={a.id} value={'agent ' + a.id} onSelect={() => go('/agents/' + a.id)} className={item}><AgentAvatar id={a.id} className="h-7 w-7" /><span className="truncate">{a.name}</span><span className="ml-auto text-xs capitalize text-soft">{a.status}</span></Command.Item>)}</Command.Group>}
        {callHits.length > 0 && <Command.Group heading="Calls">{callHits.map((c) => <Command.Item key={c.id} value={'call ' + c.id} onSelect={() => go('/conversations/' + c.id)} className={item}><span className={tile}><PhoneCall size={14} /></span><span className="truncate">{c.caller || c.phone}</span>{c.agent_name && <span className="ml-auto truncate text-xs text-soft">{c.agent_name}</span>}</Command.Item>)}</Command.Group>}
        {contactHits.length > 0 && <Command.Group heading="Contacts">{contactHits.map((c) => <Command.Item key={c.id} value={'contact ' + c.id} onSelect={() => go('/contacts')} className={item}><span className={tile}><Users size={14} /></span><span className="truncate">{c.name || c.phone}</span>{c.name && <span className="num ml-auto text-xs text-soft">{c.phone}</span>}</Command.Item>)}</Command.Group>}
        {numberHits.length > 0 && <Command.Group heading="Phone numbers">{numberHits.map((n) => <Command.Item key={n.id} value={'number ' + n.id} onSelect={() => go('/numbers')} className={item}><span className={tile}><Phone size={14} /></span><span className="num">{n.number}</span>{n.agent_name && <span className="ml-auto truncate text-xs text-soft">{n.agent_name}</span>}</Command.Item>)}</Command.Group>}
        {docHits.length > 0 && <Command.Group heading="Knowledge">{docHits.map((d) => <Command.Item key={d.id} value={'doc ' + d.id} onSelect={() => go('/knowledge')} className={item}><span className={tile}><BookOpen size={14} /></span><span className="truncate">{d.title}</span><span className="ml-auto text-xs capitalize text-soft">{d.kind}</span></Command.Item>)}</Command.Group>}
        {pages.length > 0 && <Command.Group heading="Pages">{pages.map((n) => <Command.Item key={n.to} value={'page ' + n.to} onSelect={() => go(n.to)} className={item}><span className={tile}><n.icon size={14} /></span>{n.label}</Command.Item>)}</Command.Group>}
      </Command.List>
    </Command.Dialog>
  )
}

/** Plain text with **bold** and [links](/path) turned into something clickable. */
export function Rich({ text, go }: { text: string; go: (to: string) => void }) {
  const parts = text.split(/(\[[^\]]+\]\(\/[^)\s]*\)|\*\*[^*]+\*\*)/g)
  return (
    <>{parts.map((p, i) => {
      const link = /^\[([^\]]+)\]\((\/[^)\s]*)\)$/.exec(p)
      if (link) return <button key={i} type="button" onClick={() => go(link[2])} className="font-semibold text-accent underline underline-offset-2">{link[1]}</button>
      const bold = /^\*\*([^*]+)\*\*$/.exec(p)
      return bold ? <strong key={i}>{bold[1]}</strong> : <React.Fragment key={i}>{p}</React.Fragment>
    })}</>
  )
}

export default function Shell() {
  const { mode, theme, collapsed, mobileNav, set } = useUI()
  // The app works on live data only; practice calls from an agent's page still use its private test copy.
  React.useEffect(() => { if (mode !== 'live') set({ mode: 'live' }) }, [mode, set])
  const { pathname, search } = useLocation()
  const seg = pathname.split('/').filter(Boolean)
  const wide = seg[0] === 'agents' && seg.length === 2 && !['new', 'templates'].includes(seg[1]) && (new URLSearchParams(search).get('tab') ?? 'flow') === 'flow'
  React.useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark') }, [theme])
  const brand = useMe().data?.branding
  React.useEffect(() => {
    const root = document.documentElement
    const hsl = brand?.color ? hexToHsl(brand.color) : null
    if (hsl && theme !== 'dark') { root.style.setProperty('--accent', hsl); root.style.setProperty('--accent-soft', hsl.replace(/\d+%$/, '94%')) } else { root.style.removeProperty('--accent'); root.style.removeProperty('--accent-soft') }
    document.title = brand?.name || BRAND
  }, [brand?.color, brand?.name, theme])
  React.useEffect(() => { const pl = platformOf(pathname); if (pl && pl !== useUI.getState().platform) set({ platform: pl }) }, [pathname, set])
  React.useEffect(() => { set({ mobileNav: false }); document.getElementById('app-scroll')?.scrollTo(0, 0) }, [pathname, set])
  const verify = useVerify()
  if (verify.data?.required) return <><VerifyPhone status={verify.data} /><Toaster position="top-center" closeButton theme={theme === 'dark' ? 'dark' : 'light'} /></>
  return (
    <TooltipProvider>
      <div className="flex h-[100dvh] gap-2 overflow-hidden p-0 md:p-2">
        <aside className={cn('hidden h-full shrink-0 overflow-hidden transition-[width] md:block', collapsed ? 'w-16' : 'w-64')}><SidebarBody collapsed={collapsed} /></aside>
        <AnimatePresence>
          {mobileNav && (
            <>
              <motion.div className="fixed inset-0 z-40 bg-black/40 md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => set({ mobileNav: false })} />
              <motion.aside className="fixed inset-y-0 left-0 z-50 w-72 border-r bg-surface md:hidden" initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} transition={{ type: 'tween', duration: 0.2 }}><SidebarBody collapsed={false} close={() => set({ mobileNav: false })} /></motion.aside>
            </>
          )}
        </AnimatePresence>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-none border-line/70 app-panel md:rounded-2xl md:border">
          <Topbar openNav={() => set({ mobileNav: true })} />
          <main id="app-scroll" className="min-h-0 flex-1 overflow-y-auto"><div className={cn('w-full', wide ? '' : 'mx-auto max-w-[1280px] px-4 py-6 pb-28 md:px-10 md:py-9')}>
            <AnimatePresence mode="wait">
              <motion.div key={pathname.split('/')[1] + (pathname.split('/')[2] ?? '')} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}><Outlet /></motion.div>
            </AnimatePresence>
          </div></main>
        </div>
      </div>
      <CommandPalette /><PlaygroundModal />{!USE_MOCKS && <GetStarted />}
      <Bubble
        typebot="open-ai-assistant-chat-ufibgmc"
        apiHost="https://bot.swarvoai.com"
        theme={{ button: { backgroundColor: "#1D1D1D" } }}
      />
      <Toaster position="bottom-left" closeButton theme={theme === 'dark' ? 'dark' : 'light'}
        icons={{ success: <CheckCircle2 size={18} className="text-ok" />, error: <AlertCircle size={18} className="text-bad" />, warning: <AlertTriangle size={18} className="text-warn" />, info: <Info size={18} className="text-soft" />, loading: <Loader2 size={18} className="animate-spin text-soft" /> }} />
    </TooltipProvider>
  )
}
