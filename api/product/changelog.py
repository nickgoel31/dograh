"""What changed and when, in plain words, newest first. Add an entry here when something customers can see ships."""

# kind: new | improved | fixed
CHANGELOG: list[dict] = [
    {"date": "2026-11-09", "title": "Status, security and changelog pages", "items": [
        ("new", "A public status page with 30-day uptime for each part of the platform."),
        ("new", "A security page that says plainly what we do to protect your data."),
        ("new", "An API reference with copy-ready examples, plus one-file Python and TypeScript clients that also check webhook signatures."),
        ("new", "This changelog."),
        ("new", "WhatsApp follow-up after a call, with your own payment link."),
        ("new", "Voicemail detection per agent, and campaign retry rules for busy, no-answer and voicemail."),
        ("new", "Live calls: see which calls are happening right now."),
        ("new", "Call back a caller at a time they asked for, from their call page."),
        ("improved", "Handover to a person: choose what the caller hears and how long to ring."),
        ("improved", "The calls list works properly on a phone."),
    ]},
    {"date": "2026-11-08", "title": "Create agents faster", "items": [
        ("new", "31 starter templates grouped by industry, each with a real call script."),
        ("new", "Describe your business and the platform's AI writes the agent for you. You check it before it is created."),
        ("improved", "Saving languages now updates the agent's instructions right away, including hand-edited ones."),
        ("fixed", "Publishing an agent works again."),
        ("fixed", "Deleting an agent no longer shows an error."),
    ]},
    {"date": "2026-11-07", "title": "Languages", "items": [
        ("new", "Pick up to two languages per agent. Each is written in its own script, so Hindi is always Devanagari."),
        ("new", "Swarvo voices: choose chat or read mode, and how many natural pauses and fillers chat mode adds."),
    ]},
    {"date": "2026-11-06", "title": "Account and getting started", "items": [
        ("new", "An Account tab in Settings: name, time zone, verified email and WhatsApp number, password and appearance."),
        ("new", "A setup guide that gets your first agent made in a few minutes."),
        ("new", "All the classic call settings in the agent's Voice tab: concurrency, background noise, turn detection and call limits."),
        ("new", "Swarvo voices can listen with AssemblyAI or Deepgram."),
        ("fixed", "Swarvo voices no longer echo, and start speaking sooner."),
    ]},
    {"date": "2026-11-05", "title": "Swarvo voices and safer sign-up", "items": [
        ("new", "Swarvo TTS 2.5: 20 built-in voices."),
        ("new", "Inworld voice steering at low, medium or high."),
        ("new", "Your WhatsApp number is checked before the free sign-up credit is added."),
        ("improved", "Practice calls now appear under Billing usage."),
        ("improved", "New, cleaner voice cards that work on a phone."),
    ]},
    {"date": "2026-11-04", "title": "A new home", "items": [
        ("new", "A new home page with an AI assistant and a welcome tour."),
        ("new", "Three platforms in the sidebar: Voice Agents, Chat Agents and the Swarvo API."),
        ("improved", "Simpler per-minute pricing that gets cheaper as you add more."),
    ]},
    {"date": "2026-11-03", "title": "Numbers and scripts", "items": [
        ("new", "Add a call script to any agent."),
        ("new", "Identity checks before buying phone numbers that need them, with prices shown first."),
        ("improved", "Practice calls are charged from your balance when free minutes run out."),
    ]},
    {"date": "2026-10-31", "title": "A new design", "items": [
        ("improved", "A new look across the whole app."),
        ("improved", "The price follows your balance, and older calls keep the price they were charged."),
    ]},
]
