import * as React from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Command } from 'cmdk'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BarChart3, BookOpen, Bell, Bot, ChevronDown, ChevronRight, Code2, CreditCard, FlaskConical, HelpCircle, Home, Megaphone, Menu as MenuIcon,
  MessageCircle, Mic2, Moon, PanelLeftClose, PanelLeftOpen, Phone, PhoneCall, Plug, Search, Send, Settings, Sparkles, Sun, X, Check, ChevronsUpDown,
} from 'lucide-react'
import { Toaster, toast } from 'sonner'
import { BRAND } from '@/config/brand'
import { useMe } from '@/lib/useMe'
import { http } from '@/lib/api/http'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { USE_MOCKS, authApi } from '@/lib/api'
import { queryClient } from '@/lib/query'
import { useUI } from '@/store/ui'
import { useData } from '@/store/data'
import { calls } from '@/mock/calls'
import { Button, Menu, MenuContent, MenuItem, MenuSep, MenuTrigger, Switch, TooltipProvider } from '@/components/ui'
import { PlaygroundModal } from '@/components/Playground'
import { cn } from '@/lib/utils'

const main = [
  { to: '/', label: 'Home', icon: Home }, { to: '/agents', label: 'Agents', icon: Bot }, { to: '/conversations', label: 'Conversations', icon: PhoneCall },
  { to: '/numbers', label: 'Phone Numbers', icon: Phone }, { to: '/campaigns', label: 'Campaigns', icon: Megaphone }, { to: '/knowledge', label: 'Knowledge', icon: BookOpen },
  { to: '/tools', label: 'Tools & Integrations', icon: Plug }, { to: '/voices', label: 'Voices', icon: Mic2 }, { to: '/testing', label: 'Testing Lab', icon: FlaskConical },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
]
const build = [{ to: '/developers', label: 'Developers', icon: Code2 }, { to: '/billing', label: 'Billing & Usage', icon: CreditCard }]
const bottom = [{ to: '/settings', label: 'Team & Settings', icon: Settings }, { to: '/help', label: 'Help', icon: HelpCircle }]
const demoWorkspaces = ['Sunrise Dental', 'GlowUp Salon']

export const Logo = () => (
  <div className="flex items-center gap-2 font-semibold tracking-tight">
    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-fg"><Mic2 size={15} /></div>{BRAND}
  </div>
)

function NavItem({ to, label, icon: Icon, collapsed, onClick }: (typeof main)[number] & { collapsed: boolean; onClick?: () => void }) {
  return (
    <NavLink to={to} end={to === '/'} onClick={onClick} title={collapsed ? label : undefined}
      className={({ isActive }) => cn('flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition', isActive ? 'bg-accent-soft text-accent' : 'text-soft hover:bg-muted hover:text-ink', collapsed && 'justify-center px-0')}>
      <Icon size={17} className="shrink-0" />{!collapsed && label}
    </NavLink>
  )
}

function SidebarBody({ collapsed, close }: { collapsed: boolean; close?: () => void }) {
  const { mode, workspace, workspaceId, set } = useUI()
  const { data: me } = useMe()
  // Real mode: the user's actual workspaces. Mock mode: the demo list.
  const list = USE_MOCKS ? demoWorkspaces.map((n, i) => ({ id: String(i), name: n })) : (me?.workspaces ?? [])
  const activeId = USE_MOCKS ? String(workspace) : (workspaceId ?? me?.current_workspace.id ?? '')
  const active = list.find((w) => w.id === activeId) ?? list[0] ?? { id: '', name: BRAND }
  const pick = (w: { id: string; name: string }) => { set(USE_MOCKS ? { workspace: Number(w.id) } : { workspaceId: w.id }); toast.success(`Switched to ${w.name}`) }
  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <div className={cn('flex items-center px-1 pt-1', collapsed ? 'justify-center' : 'justify-between')}>{collapsed ? <Mic2 size={20} className="text-accent" /> : <Logo />}</div>
      {!collapsed && (
        <Menu>
          <MenuTrigger asChild>
            <button className="flex w-full items-center gap-2 rounded-lg border bg-surface px-3 py-2 text-left text-sm shadow-card hover:bg-muted">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-soft text-xs font-semibold text-accent">{active.name[0]}</span>
              <span className="flex-1 truncate font-medium">{active.name}</span><ChevronsUpDown size={14} className="text-soft" />
            </button>
          </MenuTrigger>
          <MenuContent align="start" className="w-60">
            {list.map((w) => <MenuItem key={w.id} onSelect={() => pick(w)}>{w.name}{w.id === active.id && <Check size={14} className="ml-auto" />}</MenuItem>)}
          </MenuContent>
        </Menu>
      )}
      <div role="group" aria-label="Test or Live mode" className={cn('grid rounded-lg bg-muted p-1 text-[13px] font-medium', collapsed ? 'grid-cols-1 gap-1' : 'grid-cols-2')}>
        {(['test', 'live'] as const).map((m) => (
          <button key={m} onClick={() => { set({ mode: m }); toast(m === 'test' ? 'Switched to Test mode' : 'Switched to Live mode') }} aria-pressed={mode === m}
            className={cn('rounded-md py-1.5 capitalize transition', mode === m ? (m === 'test' ? 'bg-surface text-warn shadow-card' : 'bg-surface text-ok shadow-card') : 'text-soft')}>{collapsed ? m[0].toUpperCase() : m}</button>
        ))}
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto" aria-label="Main">
        {main.map((n) => <NavItem key={n.to} {...n} collapsed={collapsed} onClick={close} />)}
        {!collapsed && <div className="px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wider text-soft/70">Build</div>}
        {collapsed && <div className="my-2 h-px bg-line" />}
        {build.map((n) => <NavItem key={n.to} {...n} collapsed={collapsed} onClick={close} />)}
        <div className="mt-auto pt-4">{bottom.map((n) => <NavItem key={n.to} {...n} collapsed={collapsed} onClick={close} />)}</div>
      </nav>
    </div>
  )
}

const crumbNames: Record<string, string> = { agents: 'Agents', conversations: 'Conversations', numbers: 'Phone Numbers', campaigns: 'Campaigns', knowledge: 'Knowledge', tools: 'Tools & Integrations', voices: 'Voices', testing: 'Testing Lab', analytics: 'Analytics', developers: 'Developers', billing: 'Billing & Usage', settings: 'Team & Settings', help: 'Help', new: 'New', templates: 'Templates' }
function Breadcrumbs() {
  const { pathname } = useLocation()
  const agents = useData((s) => s.agents)
  const parts = pathname.split('/').filter(Boolean)
  const name = (p: string, i: number) => crumbNames[p] ?? (parts[0] === 'agents' ? agents.find((a) => a.id === p)?.name : p) ?? p
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm text-soft">
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
  { t: 'Priya just took her 1,000th call 🎉', d: 'Nice milestone. See how she’s doing.', to: '/agents/a1', tone: 'text-ok' },
]

function Topbar({ openNav }: { openNav: () => void }) {
  const { view, theme, collapsed, set } = useUI()
  const me = useMe().data
  const mode = useUI((s) => s.mode)
  const qc = useQueryClient()
  const notes = useQuery({ queryKey: ['notifications', mode], queryFn: () => http<{ unread: number; items: { id: string; title: string; body: string; link: string | null; read: boolean }[] }>('/notifications'), enabled: !USE_MOCKS, refetchInterval: 30000 })
  const unread = USE_MOCKS ? 1 : notes.data?.unread ?? 0
  const bell = USE_MOCKS ? alerts : (notes.data?.items ?? []).map((n) => ({ t: n.title, d: n.body, to: n.link ?? '/', tone: n.read ? 'text-soft' : 'text-ink', id: n.id }))
  const initials = USE_MOCKS ? 'AS' : (me?.user.name || me?.user.email || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  const nav = useNavigate()
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-bg/85 px-4 backdrop-blur md:px-6">
      <Button variant="ghost" size="icon" className="md:hidden" onClick={openNav} aria-label="Open menu"><MenuIcon size={18} /></Button>
      <Button variant="ghost" size="icon" className="hidden md:inline-flex" onClick={() => set({ collapsed: !collapsed })} aria-label="Collapse sidebar">{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</Button>
      <div className="min-w-0 flex-1"><Breadcrumbs /></div>
      <button onClick={() => set({ palette: true })} className="hidden h-9 items-center gap-2 rounded-lg border bg-surface px-3 text-sm text-soft shadow-card hover:bg-muted sm:flex">
        <Search size={14} />Search<kbd className="ml-6 rounded border bg-muted px-1.5 text-[11px]">⌘K</kbd>
      </button>
      <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => set({ palette: true })} aria-label="Search"><Search size={18} /></Button>
      <div className="flex items-center gap-2 rounded-lg border bg-surface px-2.5 py-1.5 shadow-card" title="Simple shows the basics. Advanced shows every technical option.">
        <span className={cn('text-xs font-medium', view === 'simple' ? 'text-ink' : 'text-soft')}>Simple</span>
        <Switch checked={view === 'advanced'} onChange={(v) => { set({ view: v ? 'advanced' : 'simple' }); toast(v ? 'Advanced view: all options visible' : 'Simple view: just the basics') }} label="Advanced view" />
        <span className={cn('text-xs font-medium', view === 'advanced' ? 'text-ink' : 'text-soft')}>Advanced</span>
      </div>
      <Menu>
        <MenuTrigger asChild><Button variant="ghost" size="icon" className="relative" aria-label="Notifications"><Bell size={18} />{unread > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-bad" />}</Button></MenuTrigger>
        <MenuContent className="w-80">
          <div className="px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-soft">Notifications</div>
          {bell.length === 0 && <div className="px-2.5 py-3 text-sm text-soft">You’re all caught up.</div>}
          {unread > 0 && !USE_MOCKS && <MenuItem onSelect={() => http('/notifications/read-all', { method: 'POST' }).then(() => qc.invalidateQueries({ queryKey: ['notifications'] }))}>Mark all as read</MenuItem>}
          {bell.map((a) => <MenuItem key={a.t} onSelect={() => nav(a.to)} className="flex-col items-start gap-0.5"><span className={cn('font-medium', a.tone)}>{a.t}</span><span className="text-xs text-soft">{a.d}</span></MenuItem>)}
        </MenuContent>
      </Menu>
      <Menu>
        <MenuTrigger asChild><button className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-fg" aria-label="Account menu">{initials}</button></MenuTrigger>
        <MenuContent>
          <div className="px-2.5 py-2"><div className="font-medium">{USE_MOCKS ? 'Aarav Sharma' : me?.user.name}</div><div className="text-xs text-soft">{USE_MOCKS ? 'aarav@sunrisedental.in' : me?.user.email}</div></div>
          <MenuSep />
          <MenuItem onSelect={() => set({ theme: theme === 'dark' ? 'light' : 'dark' })}>{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}{theme === 'dark' ? 'Light mode' : 'Dark mode'}</MenuItem>
          <MenuItem onSelect={() => nav('/settings')}><Settings size={15} />Settings</MenuItem>
          <MenuItem onSelect={signOut}>Sign out</MenuItem>
        </MenuContent>
      </Menu>
    </header>
  )
}

async function signOut() {
  if (USE_MOCKS) { toast('This is a demo, so there is nothing to sign out of 🙂'); return }
  try { await authApi.logout() } finally { queryClient.clear(); window.location.assign('/') }
}

function CommandPalette() {
  const { palette, set } = useUI()
  const agents = useData((s) => s.agents)
  const nav = useNavigate()
  const go = (to: string) => { set({ palette: false }); nav(to) }
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); useUI.getState().set({ palette: !useUI.getState().palette }) } }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [])
  const item = 'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm aria-selected:bg-accent-soft aria-selected:text-accent'
  const head = '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-soft'
  return (
    <Command.Dialog open={palette} onOpenChange={(o) => set({ palette: o })} label="Search" overlayClassName="fixed inset-0 z-[70] bg-black/40" contentClassName="fixed left-1/2 top-[15vh] z-[71] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border bg-surface shadow-pop">
      <div className="flex items-center gap-2 border-b px-4"><Search size={16} className="text-soft" /><Command.Input placeholder="Search agents, calls, pages…" className="h-12 flex-1 bg-transparent outline-none placeholder:text-soft" /></div>
      <Command.List className={cn('max-h-[50vh] overflow-y-auto p-2', head)}>
        <Command.Empty className="py-8 text-center text-soft">Nothing found. Try another word.</Command.Empty>
        <Command.Group heading="Pages">{[...main, ...build, ...bottom].map((n) => <Command.Item key={n.to} value={'page ' + n.label} onSelect={() => go(n.to)} className={item}><n.icon size={15} />{n.label}</Command.Item>)}</Command.Group>
        <Command.Group heading="Agents">{agents.map((a) => <Command.Item key={a.id} value={'agent ' + a.name} onSelect={() => go('/agents/' + a.id)} className={item}><span>{a.emoji}</span>{a.name}</Command.Item>)}</Command.Group>
        <Command.Group heading="Calls">{calls.slice(0, 12).map((c) => <Command.Item key={c.id} value={'call ' + c.caller + ' ' + c.id} onSelect={() => go('/conversations/' + c.id)} className={item}><PhoneCall size={15} />{c.caller}<span className="ml-auto text-xs text-soft">{c.phone}</span></Command.Item>)}</Command.Group>
      </Command.List>
    </Command.Dialog>
  )
}

const faq: Record<string, string> = {
  'How do I make my agent transfer to a human?': 'Easy! Open your agent, go to Tools, and switch on “Transfer to a human”. Then add the phone number of the person who should pick up. Want me to take you there?',
  'Why did my call fail?': 'Most failed calls come from a disconnected calendar or a dropped phone line. Open Conversations, tick “Failed only”, and click a call. We explain what happened in plain words.',
  'How much does this cost?': 'One simple price: ₹6 per minute, everything included. Test mode is always free.',
  'How do I teach my agent about my business?': 'Go to Knowledge and add a website, a PDF or a few questions and answers. Your agent learns it in about a minute.',
}
function AIHelper() {
  const { helper, set } = useUI()
  const [log, setLog] = React.useState<{ who: 'me' | 'ai'; t: string }[]>([{ who: 'ai', t: 'Hi! I’m your helper. Ask me anything, or pick a question below.' }])
  const [typing, setTyping] = React.useState(false)
  const [text, setText] = React.useState('')
  const end = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [log, typing])
  const ask = (q: string) => {
    if (!q.trim()) return
    setLog((l) => [...l, { who: 'me', t: q }]); setText(''); setTyping(true)
    setTimeout(() => { setTyping(false); setLog((l) => [...l, { who: 'ai', t: faq[q] ?? 'Good question! In this demo I only know a few answers, but in the real product I’d look through your docs and settings to help.' }]) }, 1300)
  }
  return (
    <>
      <AnimatePresence>
        {helper && (
          <motion.div initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16 }} role="dialog" aria-label="AI Helper"
            className="fixed bottom-24 right-4 z-40 flex h-[480px] max-h-[calc(100vh-8rem)] w-[calc(100vw-2rem)] max-w-[380px] flex-col overflow-hidden rounded-2xl border bg-surface shadow-pop sm:right-6">
            <div className="flex items-center justify-between border-b bg-accent px-4 py-3 text-accent-fg"><div className="flex items-center gap-2 font-semibold"><Sparkles size={16} />AI Helper</div><button onClick={() => set({ helper: false })} aria-label="Close helper"><X size={16} /></button></div>
            <div className="flex-1 space-y-2.5 overflow-y-auto p-4">
              {log.map((m, i) => <div key={i} className={cn('flex', m.who === 'me' && 'justify-end')}><div className={cn('max-w-[85%] rounded-2xl px-3.5 py-2 text-sm', m.who === 'me' ? 'bg-accent text-accent-fg' : 'bg-muted')}>{m.t}</div></div>)}
              {typing && <div className="flex"><div className="flex gap-1 rounded-2xl bg-muted px-4 py-3">{[0, 1, 2].map((i) => <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-soft" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }} />)}</div></div>}
              {log.length < 3 && <div className="flex flex-col items-start gap-2 pt-2">{Object.keys(faq).map((q) => <button key={q} onClick={() => ask(q)} className="rounded-xl border bg-surface px-3 py-2 text-left text-[13px] hover:bg-accent-soft">{q}</button>)}</div>}
              <div ref={end} />
            </div>
            <form onSubmit={(e) => { e.preventDefault(); ask(text) }} className="flex gap-2 border-t p-3">
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask a question…" aria-label="Ask the helper" className="h-9 flex-1 rounded-lg border bg-surface px-3 text-sm" />
              <Button variant="primary" size="icon" aria-label="Send"><Send size={15} /></Button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
      <button onClick={() => set({ helper: !helper })} aria-label="Open AI Helper" className="fixed bottom-5 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-pop transition hover:scale-105 sm:right-6"><MessageCircle size={24} /></button>
    </>
  )
}

export default function Shell() {
  const { mode, theme, collapsed, mobileNav, set } = useUI()
  const { pathname } = useLocation()
  React.useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark') }, [theme])
  React.useEffect(() => { set({ mobileNav: false }); window.scrollTo(0, 0) }, [pathname, set])
  return (
    <TooltipProvider>
      <div className="flex min-h-screen">
        <aside className={cn('sticky top-0 hidden h-screen shrink-0 border-r bg-surface transition-[width] md:block', collapsed ? 'w-[68px]' : 'w-64')}><SidebarBody collapsed={collapsed} /></aside>
        <AnimatePresence>
          {mobileNav && (
            <>
              <motion.div className="fixed inset-0 z-40 bg-black/40 md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => set({ mobileNav: false })} />
              <motion.aside className="fixed inset-y-0 left-0 z-50 w-72 border-r bg-surface md:hidden" initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} transition={{ type: 'tween', duration: 0.2 }}><SidebarBody collapsed={false} close={() => set({ mobileNav: false })} /></motion.aside>
            </>
          )}
        </AnimatePresence>
        <div className="flex min-w-0 flex-1 flex-col">
          {mode === 'test' && <div className="bg-warn px-4 py-1.5 text-center text-[13px] font-medium text-white" role="status">You're in Test mode. Nothing here costs money or calls real people.</div>}
          <Topbar openNav={() => set({ mobileNav: true })} />
          <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-8 pb-28 md:px-8">
            <AnimatePresence mode="wait">
              <motion.div key={pathname.split('/')[1] + (pathname.split('/')[2] ?? '')} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}><Outlet /></motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
      <CommandPalette /><AIHelper /><PlaygroundModal />
      <Toaster position="bottom-left" richColors closeButton />
    </TooltipProvider>
  )
}
