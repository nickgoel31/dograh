"""Help articles, in plain words. The brand name is filled in at run time."""

ARTICLES = [
    ("start-agent", "Create your first agent", "Getting started",
     "Open Agents and press New agent. Pick a starting point (for example Receptionist or Appointment booker), tell us about your business, and choose a voice. "
     "Press Talk on the agent to have a free practice call from your browser. Practice calls never reach real people and cost nothing."),
    ("test-live", "Practice calls and going live", "Getting started",
     "You change your agent safely on a private copy and try it with the Talk button. Nothing there calls real people or uses your balance. "
     "When you're happy, press Go live: callers then reach the new version. Your practice calls are listed under Conversations, in Practice calls."),
    ("go-live", "Putting an agent live", "Getting started",
     "An agent is ready when it has a name, a prompt, a voice and, if it uses documents or tools, those are attached. Press Go live and fix anything marked as a blocker first. "
     "Going live again later publishes your newest changes. Older versions are kept so you can restore one."),
    ("numbers", "Getting a phone number", "Phone numbers",
     "Open Phone Numbers, search for a number you like, and buy it. Then choose which agent should answer it, and callers who dial it reach that agent. "
     "Some numbers, especially in India, need identity documents before they are switched on; if that happens we'll tell you what to do. "
     "You can set opening hours and a message for outside those hours."),
    ("hours", "Opening hours and the after-hours message", "Phone numbers",
     "Each number can have opening hours. Outside them, callers hear your after-hours message instead of the agent. Hours use the time zone you pick on the number."),
    ("billing", "Minutes, balance and top-ups", "Billing",
     "You start with free minutes. Your balance and minutes left are always shown at the top of the page. After the free minutes, calls use your balance. "
     "Add money from Billing. You can set a monthly spend limit so calls pause politely when it is reached."),
    ("voices", "Choosing a voice", "Voices",
     "Open Voices to browse hundreds of voices. Search by name, then filter by language or gender. Pick one on your agent's Voice tab. "
     "Some voices run on a single fixed AI model; for the others you can choose how fast or smart your agent should be on the Brain tab."),
    ("invoices", "Invoices and GST", "Billing",
     "Every top-up creates a tax invoice you can download from Billing. Add your billing details (name, address and GSTIN if you have one) so they appear on it."),
    ("knowledge", "Teaching your agent from documents", "Knowledge and tools",
     "Open Knowledge and add a file, a web page or some text. Attach it to an agent from the agent's page. The agent looks things up while talking. "
     "Documents are kept separately for Test and Live, and we copy them for you when you go live."),
    ("tools", "Tools: let your agent do things", "Knowledge and tools",
     "A tool lets an agent do something during a call, such as booking an appointment on your website. Add a tool under Tools, test it, and attach it to an agent."),
    ("campaigns", "Calling a list of people (campaigns)", "Campaigns",
     "Upload a spreadsheet of phone numbers, pick an agent, choose calling hours and start. You confirm you have permission to call these people and that you checked the Do Not Call list. "
     "Campaigns only run in Live mode. You can pause and resume any time."),
    ("analytics", "Understanding your analytics", "Insights",
     "Analytics shows calls, how many ended well (booked, resolved, qualified or transferred), cost, and how that compares to the same period before. "
     "Some measures, such as caller sentiment, are not tracked yet and say so."),
    ("lab", "Practising with the Testing Lab", "Insights",
     "The Testing Lab has practice callers (for example an impatient one) who talk to your agent and score the result. Save test cases to re-check your agent whenever you change it, "
     "and compare two versions with an A/B test once each has at least 20 calls."),
    ("api", "Using the API", "Developers",
     "Create a key under Developers. Keys starting sk_test_ read your Test data and sk_live_ keys read your Live data. Send it as Authorization: Bearer <key>. "
     "Keep keys secret: we show a key once, and you can revoke it any time."),
    ("webhooks", "Webhooks: get told when things happen", "Developers",
     "Add a web address under Developers and we send it a message when a call starts or ends, or a campaign finishes. Each message is signed so you can check it came from us. "
     "If your server is down we retry for a while, and you can resend any message by hand."),
    ("team", "Inviting your team and roles", "Team",
     "Owners and admins can invite people from Team. Roles: Owner (everything), Admin (everything except deleting the workspace), Developer (build agents, keys and webhooks), Viewer (look only). "
     "Invites are links you send yourself and are valid for 7 days."),
    ("privacy", "Privacy: recordings, consent and retention", "Team",
     "Under Settings you can hide recordings, hide personal details like phone numbers and emails in transcripts, say a short notice at the start of every Live call "
     "(for example that the call may be recorded), and choose how long recordings and transcripts are kept."),
    ("2fa", "Two-step sign-in", "Account",
     "Turn on two-step sign-in in Settings. Scan the code with an authenticator app, enter the 6-digit code it shows, and from then on you'll need a code each time you sign in."),
    ("widget", "Adding a call button to your website", "Developers",
     "Add your website under Settings, then paste the snippet from Developers onto your page. Visitors can talk to a live agent from their browser. Calls use your Live balance."),
    ("templates", "Starting from a template or describing your business", "Getting started",
     "Open Agents, then New agent. Pick what the agent should do, describe your business in a few sentences, and the platform's AI writes the first version: a name, what it does, and a step-by-step call script. "
     "You check and edit it before it is created. Prefer to start from a proven example? Browse templates by industry, such as clinics, salons, real estate, restaurants, schools and more."),
    ("languages", "Languages and scripts", "Voices",
     "On the agent's Voice tab choose up to two languages. Each language is always written in its own script, so Hindi is Devanagari and English is Latin letters. "
     "Save, then press Go live again so real calls use the change."),
    ("whatsapp-followup", "WhatsApp follow-up after a call", "Phone numbers",
     "Under Settings, write a short message and, if you like, add your payment link. After each call we send it to the caller on WhatsApp. Use {name}, {business} and {payment_link} in the words. "
     "Only turn it on if callers are told on the call that they will get a message. Anyone who asked not to be contacted is skipped. WhatsApp requires the operator to have approved message templates first."),
    ("voicemail", "Voicemail and answering machines", "Campaigns",
     "Turn on voicemail detection on the agent's Voice tab. When an answering machine picks up, the agent hangs up instead of talking to a recording, so you do not pay for it. "
     "It works with voices that run as separate listen, think and speak steps (Swarvo voices), not with the live speech-to-speech voices."),
    ("retries", "Retries and call-backs", "Campaigns",
     "When you start a campaign, choose how many times to retry, how long to wait, and whether to retry on busy, no answer and voicemail. "
     "To call one person back at a time they asked for, open their call and choose Call back. It follows the same calling-hours and do-not-call rules."),
    ("live-calls", "Seeing calls as they happen", "Insights",
     "Open Live calls to see which calls are happening right now, which agent is on each, who is calling and for how long. The list refreshes by itself. A call's transcript appears under Conversations when it ends."),
    ("handover", "Passing a call to a person", "Knowledge and tools",
     "On the agent's page, turn on handover and enter the number with its country code. Say when the agent should pass the call over, what the caller hears while it connects, and how long to ring before the agent comes back."),
    ("api-reference", "API reference and client libraries", "Developers",
     "Open Developers, then API reference, for every endpoint with examples you can copy in curl, Python and TypeScript. Download the one-file Python or TypeScript client. "
     "Use a key that starts with sk_test_ to try things safely on your Test data."),
    ("status", "Is something down? Status and changelog", "Account",
     "The public status page shows whether the app, voice models and voices are working, with 30 days of history. The changelog lists what is new. Both open without signing in."),
    ("mcp", "Connecting Claude, ChatGPT or another AI assistant (MCP)", "Developers",
     "Under Developers, press New token in the MCP box. Choose Full access (it can change anything you can) or Read-only. Copy the connector address once and paste it into Claude (Settings, Connectors, Add custom connector) or ChatGPT (Settings, Connectors, developer mode). "
     "The assistant can then build and publish agents, change voices, read conversations, manage numbers, knowledge, campaigns and API keys, acting as you. Revoke the token any time."),
    ("import-export", "Exporting and importing an agent as a file", "Getting started",
     "Open an agent and press Export to download it as one JSON file with its settings, personality, voice choice and call flow. On the Agents page press Import and choose a file to get it back as a new draft, in this workspace or another. "
     "Plain call-flow JSON works too. Tools, documents and keys are never included in a file."),
    ("falcon", "Falcon voices for Indian languages", "Voices",
     "Falcon voices speak Hindi, English, Marathi, Gujarati, Tamil, Telugu, Kannada, Malayalam, Bengali, Punjabi and more, and are built for fast phone conversations. Pick one on the agent's Voice tab. "
     "The voice speaks the first language you chose for the agent that it supports."),
]
