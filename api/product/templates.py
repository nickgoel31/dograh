"""Starter agents. Plain data so they can be reviewed and edited without code changes."""

from dataclasses import dataclass


@dataclass(frozen=True)
class AgentTemplate:
    key: str
    name: str
    emoji: str
    color: str
    role: str
    tone: str
    blurb: str


TEMPLATES: tuple[AgentTemplate, ...] = (
    AgentTemplate("receptionist", "Front Desk", "💁", "#6356f1", "answer calls, answer common questions and take messages", "Friendly", "Greets callers and answers questions."),
    AgentTemplate("appointments", "Bookings", "📅", "#0ea5e9", "book, move and cancel appointments", "Professional", "Books appointments for you."),
    AgentTemplate("leads", "Sales Qualifier", "🎯", "#f59e0b", "qualify new leads by asking about need, budget and timing", "Playful", "Finds out which leads are serious."),
    AgentTemplate("support", "Support Hero", "🛟", "#10b981", "help customers solve problems and escalate to a person when needed", "Friendly", "Solves common problems."),
    AgentTemplate("orders", "Order Taker", "🍕", "#ef4444", "take orders accurately and confirm the total", "Playful", "Takes orders by phone."),
    AgentTemplate("survey", "Survey Bot", "📋", "#8b5cf6", "run a short customer survey, one question at a time", "Professional", "Collects feedback."),
    AgentTemplate("reminders", "Payment Reminder", "💳", "#64748b", "politely remind customers about pending payments and offer ways to pay", "Professional", "Gently chases payments."),
    AgentTemplate("salon", "Salon Concierge", "💇", "#ec4899", "book salon and spa appointments, explain services and prices, and reschedule politely", "Friendly", "Books services and answers price questions."),
    AgentTemplate("realestate", "Property Assistant", "🏠", "#0d9488", "answer property enquiries, ask about budget, location and timing, and book site visits", "Professional", "Qualifies buyers and books visits."),
    AgentTemplate("restaurant", "Restaurant Host", "🍽️", "#f97316", "take table reservations, answer questions about the menu and opening hours, and note special requests", "Friendly", "Takes reservations and answers menu questions."),
    AgentTemplate("coaching", "Admissions Counsellor", "🎓", "#6366f1", "answer course questions, explain fees and batches, and book a counselling call", "Friendly", "Handles course enquiries and bookings."),
    AgentTemplate("hotel", "Hotel Reservations", "🏨", "#0ea5e9", "answer room and rate questions, check what guests need, and take booking enquiries", "Professional", "Answers guest and booking calls."),
    AgentTemplate("clinic", "Clinic Assistant", "🩺", "#14b8a6", "help patients with appointments and clinic information, never giving medical advice", "Friendly", "Handles patient calls."),
)
BY_KEY = {t.key: t for t in TEMPLATES}
