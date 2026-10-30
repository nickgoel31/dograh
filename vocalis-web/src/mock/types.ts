export type AgentStatus = 'live' | 'draft' | 'paused'
export interface Agent {
  id: string; name: string; emoji: string; color: string; role: string; status: AgentStatus
  callsToday: number; successRate: number; spark: number[]
  voiceId: string; brain: 'fast' | 'balanced' | 'smartest'; tone: string; business: string; whatYouDo: string
  prompt: string; numbers: string[]
}
export type Outcome = 'booked' | 'resolved' | 'qualified' | 'transferred' | 'voicemail' | 'failed' | 'no-answer'
export interface Turn { who: 'agent' | 'caller'; t: number; end: number; text: string; reply?: number; tool?: string; interrupted?: boolean }
export interface Call {
  id: string; time: string; caller: string; phone: string; agentId: string; duration: number
  outcome: Outcome; sentiment: 1 | 2 | 3 | 4 | 5; cost: number; failReason?: string
  turns: Turn[]; summary: string; extracted: Record<string, string>
  costSplit: { name: string; value: number }[]; test: boolean
}
export interface Voice {
  id: string; name: string; gender: 'Female' | 'Male'; age: 'Young' | 'Adult' | 'Mature'; lang: string
  accent: string; style: string; provider: string
}
export interface PhoneNumber {
  id: string; number: string; country: string; type: 'Local' | 'Toll-free' | 'SIP'; agentId?: string
  status: 'active' | 'pending'; monthly: number; reputation: 'Clean' | 'Watch' | 'Flagged'
}
export interface Campaign {
  id: string; name: string; agentId: string; status: 'running' | 'paused' | 'done' | 'scheduled'
  total: number; dialed: number; answered: number; voicemail: number; noAnswer: number; converted: number
}
export interface Knowledge {
  id: string; title: string; kind: 'PDF' | 'Website' | 'Text' | 'Q&A'; status: 'ready' | 'learning'
  updated: string; size: string
}
export interface Integration { id: string; name: string; blurb: string; connected: boolean; color: string; letter: string }
export interface Invoice { id: string; date: string; amount: number; status: 'Paid' | 'Due'; minutes: number }
export interface Member { id: string; name: string; email: string; role: 'Owner' | 'Admin' | 'Developer' | 'Viewer'; last: string }
export interface Delivery { id: string; event: string; endpoint: string; status: number; time: string; payload: unknown }
export interface ReqLog { id: string; method: string; path: string; status: number; ms: number; time: string; req: unknown; res: unknown }
