import type { Agent } from './types'

const P = (role: string) =>
  `You are a warm, helpful phone assistant for {{business_name}}. Your job: ${role}.\nGreet {{caller_name}} politely, keep answers short, and ask one question at a time.\nIf you are not sure, offer to transfer to a human.`

export const agents: Agent[] = [
  { id: 'a1', name: 'Priya — Front Desk', emoji: '💁', color: '#6356f1', role: 'Answer calls', status: 'live', callsToday: 148, successRate: 92, spark: [20, 34, 28, 40, 52, 48, 61, 70], voiceId: 'v3', brain: 'balanced', tone: 'Friendly', business: 'Sunrise Dental Clinic', whatYouDo: 'Dental clinic in Bengaluru. Answer questions and book check-ups.', prompt: P('answer questions about the clinic'), numbers: ['n1'] },
  { id: 'a2', name: 'Arjun — Bookings', emoji: '📅', color: '#0ea5e9', role: 'Book appointments', status: 'live', callsToday: 96, successRate: 88, spark: [10, 18, 25, 22, 38, 41, 44, 52], voiceId: 'v8', brain: 'fast', tone: 'Professional', business: 'GlowUp Salon', whatYouDo: 'Hair and skin salon. Book, move and cancel appointments.', prompt: P('book, move and cancel appointments'), numbers: ['n2'] },
  { id: 'a3', name: 'Mira — Sales Qualifier', emoji: '🎯', color: '#f59e0b', role: 'Qualify leads', status: 'live', callsToday: 61, successRate: 74, spark: [8, 12, 9, 20, 18, 24, 30, 28], voiceId: 'v5', brain: 'smartest', tone: 'Playful', business: 'Nest Realty', whatYouDo: 'Real estate agency. Ask budget, location and timeline, then hand over hot leads.', prompt: P('qualify property buyers'), numbers: ['n3'] },
  { id: 'a4', name: 'Sam — Support Hero', emoji: '🛟', color: '#10b981', role: 'Customer support', status: 'paused', callsToday: 0, successRate: 81, spark: [30, 28, 22, 18, 10, 4, 0, 0], voiceId: 'v12', brain: 'balanced', tone: 'Friendly', business: 'Zippy Mobile', whatYouDo: 'Telecom support: bill questions, plan changes, outages.', prompt: P('solve billing and plan problems'), numbers: [] },
  { id: 'a5', name: 'Chef Rohan — Orders', emoji: '🍕', color: '#ef4444', role: 'Take orders', status: 'draft', callsToday: 0, successRate: 0, spark: [0, 0, 0, 0, 0, 0, 0, 0], voiceId: 'v14', brain: 'fast', tone: 'Playful', business: 'Pizza Palace', whatYouDo: 'Take pizza orders, confirm address, and quote delivery time.', prompt: P('take food orders'), numbers: [] },
  { id: 'a6', name: 'Nina — Survey Bot', emoji: '📋', color: '#2f9e83', role: 'Run surveys', status: 'draft', callsToday: 0, successRate: 0, spark: [0, 0, 0, 0, 0, 0, 0, 0], voiceId: 'v18', brain: 'fast', tone: 'Professional', business: 'Northwind Retail', whatYouDo: 'Short 3-question satisfaction survey after purchase.', prompt: P('run a 3-question survey'), numbers: [] },
]

export const templates = [
  { id: 't1', emoji: '💁', name: 'Receptionist', blurb: 'Answers questions, takes messages, routes calls.' },
  { id: 't2', emoji: '📅', name: 'Appointment booker', blurb: 'Books, moves and cancels visits on your calendar.' },
  { id: 't3', emoji: '🎯', name: 'Lead qualifier', blurb: 'Asks a few smart questions and scores the lead.' },
  { id: 't4', emoji: '🛟', name: 'Support agent', blurb: 'Solves common problems, escalates the hard ones.' },
  { id: 't5', emoji: '🍕', name: 'Order taker', blurb: 'Takes food or retail orders and confirms them.' },
  { id: 't6', emoji: '📋', name: 'Survey caller', blurb: 'Collects feedback in under two minutes.' },
  { id: 't7', emoji: '💳', name: 'Payment reminder', blurb: 'Politely reminds customers about due invoices.' },
  { id: 't8', emoji: '🏥', name: 'Clinic assistant', blurb: 'Handles patient questions and appointment reminders.' },
]
