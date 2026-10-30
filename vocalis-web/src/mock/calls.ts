import type { Call, Outcome, Turn } from './types'
import { agents } from './agents'
import { seeded } from '@/lib/utils'

const rnd = seeded(42)
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]
const callers = ['Ananya Iyer', 'Rahul Mehta', 'Sarah Johnson', 'Mohammed Khan', 'Divya Nair', 'Carlos Ruiz', 'Neha Gupta', 'Tom Becker', 'Lakshmi Rao', 'Amit Shah', 'Emily Clark', 'Farhan Ali', 'Sneha Kulkarni', 'Priyanka Das', 'Ravi Teja']
const phones = ['+91 98450 11223', '+91 99001 45678', '+1 415 555 0132', '+44 20 7946 0958', '+91 90353 22110', '+971 50 123 4567', '+91 98860 77341', '+1 212 555 0198']
const outcomes: Outcome[] = ['booked', 'booked', 'resolved', 'resolved', 'resolved', 'qualified', 'transferred', 'voicemail', 'failed', 'no-answer']
const fails = ['The calendar got disconnected, so the agent could not book.', 'The caller spoke a language the agent was not set up for.', 'The phone line dropped halfway through.']

const script: [Turn['who'], string, string?][] = [
  ['agent', 'Hi, thanks for calling! How can I help today?'],
  ['caller', 'Hi, I would like to book an appointment for next week.'],
  ['agent', 'Of course! Could I get your name please?'],
  ['caller', 'Yes, it is {name}.'],
  ['agent', 'Lovely, {first}. Let me check the calendar for you.', 'check_calendar'],
  ['agent', 'I have Tuesday at 4 PM or Thursday at 11 AM. Which works better?'],
  ['caller', 'Thursday at eleven is perfect.'],
  ['agent', 'Done! You are booked for Thursday at 11 AM. I will text you a reminder. Anything else?', 'book_slot'],
  ['caller', 'No, that is all. Thank you!'],
  ['agent', 'My pleasure. Have a wonderful day!'],
]

export const calls: Call[] = Array.from({ length: 40 }, (_, i) => {
  const name = pick(callers)
  const outcome = pick(outcomes)
  const ag = agents[Math.floor(rnd() * 3)]
  let t = 0
  const turns: Turn[] = script.map(([who, text, tool], k) => {
    const len = 1.5 + text.length / 16
    const start = t + 0.3 + rnd() * 0.9
    t = start + len
    return {
      who, text: text.replace('{name}', name).replace('{first}', name.split(' ')[0]), t: start, end: t, tool,
      reply: who === 'agent' ? Math.round(450 + rnd() * 900) : undefined,
      interrupted: who === 'caller' && k === 8 && rnd() > 0.5,
    }
  })
  const duration = Math.round(t + 4)
  const cost = +((duration / 60) * 6).toFixed(2)
  const failed = outcome === 'failed'
  return {
    id: 'c' + (1000 + i), time: new Date(Date.now() - i * 47 * 60000 - rnd() * 1e6).toISOString(),
    caller: name, phone: pick(phones), agentId: ag.id, duration, outcome,
    sentiment: (failed ? 1 + Math.floor(rnd() * 2) : 3 + Math.floor(rnd() * 3)) as Call['sentiment'],
    cost, failReason: failed ? pick(fails) : undefined, turns,
    summary: failed
      ? `${name} called to book a visit, but the call did not finish. See the reason above.`
      : `${name} called to book an appointment. The agent checked the calendar, offered two slots and confirmed Thursday at 11 AM. The caller sounded happy.`,
    extracted: { Name: name, Email: name.toLowerCase().replace(' ', '.') + '@example.com', 'Appointment time': 'Thursday, 11:00 AM', 'Wants a reminder': 'Yes' },
    costSplit: [
      { name: 'Listening', value: +(cost * 0.18).toFixed(2) }, { name: 'AI brain', value: +(cost * 0.34).toFixed(2) },
      { name: 'Voice', value: +(cost * 0.3).toFixed(2) }, { name: 'Phone', value: +(cost * 0.18).toFixed(2) },
    ],
    test: i % 3 === 0,
  }
})
