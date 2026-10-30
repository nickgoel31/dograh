import * as React from 'react'
import * as DialogP from '@radix-ui/react-dialog'
import * as TabsP from '@radix-ui/react-tabs'
import * as TooltipP from '@radix-ui/react-tooltip'
import * as DropP from '@radix-ui/react-dropdown-menu'
import * as SwitchP from '@radix-ui/react-switch'
import * as SliderP from '@radix-ui/react-slider'
import * as PopP from '@radix-ui/react-popover'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ---------- Button ---------- */
const variants = {
  primary: 'bg-accent text-accent-fg shadow-card hover:brightness-110',
  secondary: 'bg-surface border shadow-card hover:bg-muted',
  ghost: 'hover:bg-muted text-soft hover:text-ink',
  danger: 'bg-bad text-white hover:brightness-110',
  soft: 'bg-accent-soft text-accent hover:brightness-95',
}
const sizes = { sm: 'h-8 px-3 text-[13px] gap-1.5', md: 'h-9 px-4 gap-2', lg: 'h-12 px-6 text-base gap-2.5 rounded-xl', icon: 'h-9 w-9' }
export const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; size?: keyof typeof sizes }>(
  ({ className, variant = 'secondary', size = 'md', ...p }, ref) => (
    <button ref={ref} className={cn('inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition disabled:pointer-events-none disabled:opacity-50 active:scale-[.98]', variants[variant], sizes[size], className)} {...p} />
  ),
)

/* ---------- Card / Badge ---------- */
export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('rounded-xl border bg-surface shadow-card', className)} {...p} />
)
const tones = {
  gray: 'bg-muted text-soft', green: 'bg-ok/10 text-ok', orange: 'bg-warn/10 text-warn', red: 'bg-bad/10 text-bad', accent: 'bg-accent-soft text-accent',
}
export type Tone = keyof typeof tones
export const Badge = ({ tone = 'gray', className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) => (
  <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tones[tone], className)}>{children}</span>
)

/* ---------- Form fields ---------- */
const field = 'w-full rounded-lg border bg-surface px-3 text-sm shadow-card placeholder:text-soft/70 transition focus-visible:border-accent'
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, r) => (
  <input ref={r} className={cn(field, 'h-9', className)} {...p} />
))
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, r) => (
  <textarea ref={r} className={cn(field, 'min-h-[96px] py-2', className)} {...p} />
))
export const Select = ({ className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={cn(field, 'h-9 pr-8', className)} {...p} />
)
export const Label = ({ children, hint, className }: { children: React.ReactNode; hint?: React.ReactNode; className?: string }) => (
  <label className={cn('mb-1.5 flex items-center gap-1.5 text-[13px] font-medium', className)}>{children}{hint}</label>
)
export const Field = ({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) => (
  <div className={className}><Label hint={hint}>{label}</Label>{children}</div>
)

export const Switch = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) => (
  <SwitchP.Root checked={checked} onCheckedChange={onChange} aria-label={label} className="relative h-6 w-10 shrink-0 rounded-full bg-line transition data-[state=checked]:bg-accent">
    <SwitchP.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
  </SwitchP.Root>
)
export const Slider = ({ value, onChange, min = 0, max = 100, step = 1, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label?: string }) => (
  <SliderP.Root value={[value]} onValueChange={(v) => onChange(v[0])} min={min} max={max} step={step} className="relative flex h-5 w-full touch-none items-center">
    <SliderP.Track className="relative h-1.5 grow rounded-full bg-line"><SliderP.Range className="absolute h-full rounded-full bg-accent" /></SliderP.Track>
    <SliderP.Thumb aria-label={label} className="block h-5 w-5 rounded-full border-2 border-accent bg-white shadow" />
  </SliderP.Root>
)
export const Progress = ({ value, className }: { value: number; className?: string }) => (
  <div className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)} role="progressbar" aria-valuenow={Math.round(value)}>
    <div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: `${Math.min(100, value)}%` }} />
  </div>
)
export const Skeleton = ({ className }: { className?: string }) => <div className={cn('skeleton h-4', className)} />

export const Chip = ({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: React.ReactNode }) => (
  <button type="button" onClick={onClick} aria-pressed={active} className={cn('rounded-full border px-3.5 py-1.5 text-sm font-medium transition', active ? 'border-accent bg-accent-soft text-accent' : 'bg-surface text-soft hover:bg-muted')}>{children}</button>
)

/* ---------- Tabs ---------- */
export const Tabs = TabsP.Root
export const TabsList = ({ className, ...p }: TabsP.TabsListProps) => (
  <TabsP.List className={cn('mb-6 flex gap-1 overflow-x-auto border-b', className)} {...p} />
)
export const Tab = ({ className, ...p }: TabsP.TabsTriggerProps) => (
  <TabsP.Trigger className={cn('-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-soft transition hover:text-ink data-[state=active]:border-accent data-[state=active]:text-ink', className)} {...p} />
)
export const TabPanel = TabsP.Content

/* ---------- Dialog / Drawer ---------- */
export function Dialog({ open, onOpenChange, title, description, children, wide, side }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: React.ReactNode; wide?: boolean; side?: boolean }) {
  return (
    <DialogP.Root open={open} onOpenChange={onOpenChange}>
      <DialogP.Portal>
        <DialogP.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <DialogP.Content className={cn('fixed z-50 flex max-h-[90vh] flex-col overflow-hidden border bg-surface shadow-pop', side ? 'inset-y-0 right-0 w-full max-w-md rounded-l-2xl max-h-none' : cn('left-1/2 top-1/2 w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl', wide ? 'max-w-3xl' : 'max-w-lg'))}>
          <div className="flex items-start justify-between gap-4 border-b p-5">
            <div><DialogP.Title className="text-base font-semibold">{title}</DialogP.Title>
              {description ? <DialogP.Description className="mt-1 text-sm text-soft">{description}</DialogP.Description> : <DialogP.Description className="sr-only">{title}</DialogP.Description>}</div>
            <DialogP.Close className="rounded-md p-1 text-soft hover:bg-muted" aria-label="Close"><X size={18} /></DialogP.Close>
          </div>
          <div className="overflow-y-auto p-5">{children}</div>
        </DialogP.Content>
      </DialogP.Portal>
    </DialogP.Root>
  )
}

/* ---------- Tooltip ---------- */
export const TooltipProvider = TooltipP.Provider
export const Tip = ({ text, children }: { text: React.ReactNode; children: React.ReactNode }) => (
  <TooltipP.Root delayDuration={150}>
    <TooltipP.Trigger asChild>{children}</TooltipP.Trigger>
    <TooltipP.Portal><TooltipP.Content sideOffset={6} className="z-[60] max-w-[260px] rounded-lg bg-ink px-3 py-2 text-xs leading-relaxed text-bg shadow-pop">{text}</TooltipP.Content></TooltipP.Portal>
  </TooltipP.Root>
)

/* ---------- Dropdown / Popover ---------- */
export const Menu = DropP.Root
export const MenuTrigger = DropP.Trigger
export const MenuContent = ({ className, ...p }: DropP.DropdownMenuContentProps) => (
  <DropP.Portal><DropP.Content sideOffset={6} align="end" className={cn('z-50 min-w-[200px] rounded-xl border bg-surface p-1.5 shadow-pop', className)} {...p} /></DropP.Portal>
)
export const MenuItem = ({ className, ...p }: DropP.DropdownMenuItemProps) => (
  <DropP.Item className={cn('flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-muted', className)} {...p} />
)
export const MenuSep = () => <DropP.Separator className="my-1.5 h-px bg-line" />
export const Popover = PopP.Root
export const PopoverTrigger = PopP.Trigger
export const PopoverContent = ({ className, ...p }: PopP.PopoverContentProps) => (
  <PopP.Portal><PopP.Content sideOffset={8} align="end" className={cn('z-50 rounded-xl border bg-surface p-2 shadow-pop', className)} {...p} /></PopP.Portal>
)
