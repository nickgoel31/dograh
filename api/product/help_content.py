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
]
