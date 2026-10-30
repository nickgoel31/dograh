import type { PhoneNumber, Campaign, Knowledge, Integration, Invoice, Member, Delivery, ReqLog } from './types'

const ago = (d: number) => new Date(Date.now() - d * 864e5).toISOString()

export const numbers: PhoneNumber[] = [
  { id: 'n1', number: '+91 80 4718 2290', country: 'India', type: 'Local', agentId: 'a1', status: 'active', monthly: 400, reputation: 'Clean' },
  { id: 'n2', number: '+91 22 6120 5531', country: 'India', type: 'Local', agentId: 'a2', status: 'active', monthly: 400, reputation: 'Clean' },
  { id: 'n3', number: '+91 1800 572 0144', country: 'India', type: 'Toll-free', agentId: 'a3', status: 'active', monthly: 1200, reputation: 'Watch' },
  { id: 'n4', number: '+1 415 555 0176', country: 'United States', type: 'Local', status: 'pending', monthly: 120, reputation: 'Clean' },
  { id: 'n5', number: '+44 20 7946 0321', country: 'United Kingdom', type: 'SIP', status: 'active', monthly: 0, reputation: 'Clean' },
]
export const availableNumbers = ['+91 80 4821 7733', '+91 80 4821 9902', '+91 80 6905 1144', '+91 80 6905 7720', '+91 80 3571 0098']

export const campaigns: Campaign[] = [
  { id: 'cp1', name: 'Diwali offer — existing patients', agentId: 'a1', status: 'running', total: 1200, dialed: 742, answered: 431, voicemail: 188, noAnswer: 123, converted: 96 },
  { id: 'cp2', name: 'Appointment reminders — Nov', agentId: 'a2', status: 'paused', total: 600, dialed: 310, answered: 220, voicemail: 52, noAnswer: 38, converted: 171 },
  { id: 'cp3', name: 'New property leads', agentId: 'a3', status: 'done', total: 450, dialed: 450, answered: 261, voicemail: 102, noAnswer: 87, converted: 58 },
  { id: 'cp4', name: 'Customer survey — Q4', agentId: 'a6', status: 'scheduled', total: 2000, dialed: 0, answered: 0, voicemail: 0, noAnswer: 0, converted: 0 },
]

export const knowledge: Knowledge[] = [
  { id: 'k1', title: 'Price list 2026.pdf', kind: 'PDF', status: 'ready', updated: ago(2), size: '1.2 MB' },
  { id: 'k2', title: 'sunrisedental.in', kind: 'Website', status: 'ready', updated: ago(1), size: '38 pages' },
  { id: 'k3', title: 'Opening hours & holidays', kind: 'Text', status: 'ready', updated: ago(5), size: '2 KB' },
  { id: 'k4', title: 'Common questions', kind: 'Q&A', status: 'ready', updated: ago(3), size: '24 answers' },
  { id: 'k5', title: 'Insurance partners.pdf', kind: 'PDF', status: 'learning', updated: ago(0), size: '640 KB' },
  { id: 'k6', title: 'Treatment guide.pdf', kind: 'PDF', status: 'ready', updated: ago(9), size: '4.8 MB' },
  { id: 'k7', title: 'blog.sunrisedental.in', kind: 'Website', status: 'learning', updated: ago(0), size: '112 pages' },
  { id: 'k8', title: 'Cancellation policy', kind: 'Text', status: 'ready', updated: ago(12), size: '1 KB' },
]

export const integrations: Integration[] = [
  { id: 'i1', name: 'Google Calendar', blurb: 'Check and book free slots.', connected: true, color: '#4285f4', letter: 'G' },
  { id: 'i2', name: 'Calendly', blurb: 'Let callers pick a meeting time.', connected: false, color: '#006bff', letter: 'C' },
  { id: 'i3', name: 'HubSpot', blurb: 'Save every caller as a contact.', connected: true, color: '#ff7a59', letter: 'H' },
  { id: 'i4', name: 'Salesforce', blurb: 'Create leads and log calls.', connected: false, color: '#00a1e0', letter: 'S' },
  { id: 'i5', name: 'Shopify', blurb: 'Look up orders and stock.', connected: false, color: '#5e8e3e', letter: 'S' },
  { id: 'i6', name: 'Slack', blurb: 'Get a message when a call ends.', connected: true, color: '#611f69', letter: '#' },
  { id: 'i7', name: 'WhatsApp', blurb: 'Send confirmations after calls.', connected: false, color: '#25d366', letter: 'W' },
  { id: 'i8', name: 'Zapier', blurb: 'Connect 5,000+ other apps.', connected: false, color: '#ff4a00', letter: 'Z' },
  { id: 'i9', name: 'n8n', blurb: 'Build your own automations.', connected: false, color: '#ea4b71', letter: 'n' },
  { id: 'i10', name: 'Google Sheets', blurb: 'Add a row for every call.', connected: false, color: '#0f9d58', letter: 'G' },
  { id: 'i11', name: 'Zoho CRM', blurb: 'Keep your leads in sync.', connected: false, color: '#e42527', letter: 'Z' },
  { id: 'i12', name: 'Razorpay', blurb: 'Send payment links by SMS.', connected: false, color: '#3395ff', letter: 'R' },
]

export const invoices: Invoice[] = ['Oct', 'Sep', 'Aug', 'Jul', 'Jun', 'May'].map((m, i) => ({
  id: `INV-2026-${String(10 - i).padStart(2, '0')}`, date: `1 ${m} 2026`,
  amount: [18420, 15210, 16980, 12040, 9800, 7120][i], status: i === 0 ? 'Due' : 'Paid',
  minutes: [3070, 2535, 2830, 2007, 1633, 1187][i],
}))

export const team: Member[] = [
  { id: 'm1', name: 'Aarav Sharma', email: 'aarav@sunrisedental.in', role: 'Owner', last: 'Just now' },
  { id: 'm2', name: 'Meera Pillai', email: 'meera@sunrisedental.in', role: 'Admin', last: '2 hr ago' },
  { id: 'm3', name: 'Dev Patel', email: 'dev@sunrisedental.in', role: 'Developer', last: 'Yesterday' },
  { id: 'm4', name: 'Kiran Joshi', email: 'kiran@sunrisedental.in', role: 'Viewer', last: '3 d ago' },
  { id: 'm5', name: 'Zoya Khan', email: 'zoya@sunrisedental.in', role: 'Viewer', last: '1 wk ago' },
]
export const auditLog = [
  { who: 'Aarav Sharma', what: 'Published agent “Priya — Front Desk”', when: '10 min ago' },
  { who: 'Dev Patel', what: 'Rolled the test API key', when: '2 hr ago' },
  { who: 'Meera Pillai', what: 'Invited zoya@sunrisedental.in as Viewer', when: 'Yesterday' },
  { who: 'Aarav Sharma', what: 'Changed spending limit to ₹25,000', when: '3 d ago' },
  { who: 'Dev Patel', what: 'Added a webhook endpoint', when: '5 d ago' },
]

const ev = ['call.ended', 'call.started', 'tool.failed', 'campaign.completed']
export const deliveries: Delivery[] = Array.from({ length: 8 }, (_, i) => ({
  id: 'd' + i, event: ev[i % 4], endpoint: 'https://api.sunrisedental.in/hooks/voice', status: i === 2 ? 500 : 200, time: `${i * 7 + 2} min ago`,
  payload: { id: 'evt_' + (9100 + i), type: ev[i % 4], created: 1761800000 + i * 420, data: { call_id: 'c' + (1000 + i), agent: 'Priya — Front Desk', duration: 94 + i * 3, outcome: 'booked' } },
}))
export const reqLogs: ReqLog[] = Array.from({ length: 10 }, (_, i) => ({
  id: 'r' + i, method: i % 4 === 0 ? 'POST' : 'GET', path: i % 4 === 0 ? '/v1/calls' : i % 3 === 0 ? '/v1/agents' : '/v1/calls/c' + (1000 + i),
  status: i === 3 ? 429 : i === 6 ? 404 : 200, ms: 90 + i * 17, time: `${i * 3 + 1} min ago`,
  req: i % 4 === 0 ? { agent_id: 'a1', to: '+919845011223' } : { limit: 20 },
  res: i === 3 ? { error: { code: 'rate_limited', message: 'Slow down a little and try again in 2 seconds.' } }
    : i === 6 ? { error: { code: 'not_found', message: 'We could not find that call.' } }
    : { id: 'c' + (1000 + i), status: 'completed', outcome: 'booked', duration: 96 },
}))

export const days = Array.from({ length: 14 }, (_, i) => ({
  day: new Date(Date.now() - (13 - i) * 864e5).toLocaleDateString('en', { day: 'numeric', month: 'short' }),
  calls: 120 + Math.round(Math.sin(i / 2) * 40 + i * 6), minutes: 320 + Math.round(Math.cos(i / 3) * 80 + i * 18),
  stt: 60 + i, brain: 110 + i * 2, voice: 95 + i * 2, phone: 55 + i,
  success: 78 + Math.round(Math.sin(i) * 6), sentiment: +(3.6 + Math.sin(i / 2) * 0.4).toFixed(2),
}))
