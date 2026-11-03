import {
  AlertTriangle, Angry, BookOpen, Bot, Brain, CalendarCheck, CheckCircle2, ClipboardList, Circle, Ear, Frown, GitBranch, Globe, Hand, HelpCircle, Inbox, Laugh, LifeBuoy, Lightbulb,
  Megaphone, Meh, MessageCircle, Mic, Phone, Scale, SearchX, Send, Settings2, ShoppingBag, Smile, Target, UserRound, Users, VolumeX, Wrench, XCircle, Zap, FlaskConical, type LucideIcon,
} from '@/components/icons'

/** The app's data still names things with an emoji; this draws the matching line icon instead, so the whole UI looks consistent. */
const icons: Record<string, LucideIcon> = {
  '📞': Phone, '❓': HelpCircle, '🔧': Wrench, '🔀': GitBranch, '🧑': UserRound, '✅': CheckCircle2, '🌐': Globe, '📤': Send, '⚡': Zap, '🧪': FlaskConical, '⚙️': Settings2,
  '🔍': SearchX, '📭': Inbox, '👥': Users, '📋': ClipboardList, '📚': BookOpen, '📣': Megaphone, '🤖': Bot, '🎙️': Mic, '💬': MessageCircle, '📅': CalendarCheck, '🎯': Target,
  '🛟': LifeBuoy, '🛍️': ShoppingBag, '😠': Angry, '😡': Angry, '👵': Ear, '🤐': VolumeX, '🙁': Frown, '😐': Meh, '🙂': Smile, '😄': Laugh, '✋': Hand, '⚪': Circle, '❌': XCircle,
  '⚠️': AlertTriangle, '💡': Lightbulb, '⚖️': Scale, '🧠': Brain,
}

export function Glyph({ e, size = 18, className, color }: { e?: string; size?: number; className?: string; color?: string }) {
  const I = (e && icons[e]) || Bot
  return <I size={size} className={className} style={color ? { color } : undefined} strokeWidth={1.9} aria-hidden />
}
