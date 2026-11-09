"""The public API reference, kept as data so the page, the SDKs and a test that checks it against the real routes all agree."""

from api.product import developers as dev

BASE_PATH = "/api/v1"  # the page adds the site's own address in front

AUTH = (
    "Send your secret key as a bearer token: Authorization: Bearer sk_test_... "
    "Keys starting sk_test_ read your Test data (practice calls); keys starting sk_live_ read your Live data. "
    "Create and revoke keys under Developers. A key is shown once, so store it safely. Keys only read; they cannot change anything."
)

ENDPOINTS = [
    {
        "id": "me", "method": "GET", "path": "/public/me", "title": "Who am I",
        "summary": "Checks a key works and tells you which workspace and environment it belongs to.",
        "params": [],
        "response": {"workspace": "ws_8f3k2m", "environment": "test"},
    },
    {
        "id": "agents", "method": "GET", "path": "/public/agents", "title": "List agents",
        "summary": "Your agents that exist in this key's environment.",
        "params": [],
        "response": [{"id": "agt_3kq9x1", "name": "Asha", "status": "live"}],
    },
    {
        "id": "calls", "method": "GET", "path": "/public/calls", "title": "List calls",
        "summary": "Calls, newest first, 25 at a time by default (up to 100).",
        "params": [
            {"name": "page", "in": "query", "type": "integer", "desc": "Page number, starting at 1."},
            {"name": "limit", "in": "query", "type": "integer", "desc": "Calls per page, 1 to 100."},
            {"name": "agent", "in": "query", "type": "string", "desc": "Only calls handled by this agent id."},
        ],
        "response": {"calls": [{"id": "call_7h2d9a", "time": "2026-11-09T09:41:00Z", "caller": "Rahul", "phone": "+9198XXXXXX10", "agent_id": "agt_3kq9x1", "agent_name": "Asha", "duration": 142, "outcome": "booked"}], "total": 1, "page": 1, "limit": 25},
    },
    {
        "id": "call", "method": "GET", "path": "/public/calls/{call_id}", "title": "Get one call",
        "summary": "One call with its transcript, summary, extracted details and a short-lived recording link.",
        "params": [{"name": "call_id", "in": "path", "type": "string", "desc": "The call id from the list."}],
        "response": {"id": "call_7h2d9a", "duration": 142, "summary": "Caller booked a check-up for Friday at 11.", "turns": [{"who": "agent", "t": 0.0, "end": 3.1, "text": "Hello, thanks for calling Sunrise Dental!"}], "extracted": {"appointment": "Friday 11:00"}, "audio_url": "https://..."},
    },
]

ERRORS = [
    ("401", "bad_api_key", "The key is missing, wrong or revoked."),
    ("404", "call_not_found", "That call does not exist in this environment."),
    ("429", "(plain message)", "More than 120 requests a minute for one key. The body is {\"detail\": \"Too many requests...\"}. Wait a minute and retry."),
]

WEBHOOKS = {
    "intro": (
        "Add a web address under Developers and we send a POST with a JSON body when something happens. Each message is written down first, so none are lost, "
        "then sent with a signature and retried with growing waits if your server does not answer with a 2xx status."
    ),
    "events": [
        {"name": "call.started", "desc": "A call connected."},
        {"name": "call.ended", "desc": "A call finished. Includes the outcome and duration."},
        {"name": "tool.failed", "desc": "A tool the agent used during a call failed."},
        {"name": "campaign.completed", "desc": "A campaign finished dialling its list."},
    ],
    "signature": (
        f"Every message carries the header {dev.signature_header()}: t=<unix time>,v1=<hex>. "
        "v1 is HMAC-SHA256 of \"<t>.<raw body>\" using your webhook secret. Reject messages whose t is more than five minutes old."
    ),
    "retries": f"Up to {dev.MAX_ATTEMPTS} attempts: after 1 minute, 5 minutes, 30 minutes, 2 hours, then 12 hours. You can see every attempt and resend by hand under Developers.",
}

RATE_LIMIT = "120 requests per minute for each key."


def curl(e: dict, base: str) -> str:
    return f'curl "{base}{e["path"].replace("{call_id}", "call_7h2d9a")}" \\\n  -H "Authorization: Bearer sk_test_..."'


def python(e: dict) -> str:
    call = {"me": "client.me()", "agents": "client.agents()", "calls": "client.calls(limit=10)", "call": 'client.call("call_7h2d9a")'}[e["id"]]
    return f'from swarvo import Swarvo\n\nclient = Swarvo("sk_test_...")\nprint({call})'


def typescript(e: dict) -> str:
    call = {"me": "client.me()", "agents": "client.agents()", "calls": "client.calls({ limit: 10 })", "call": "client.call('call_7h2d9a')"}[e["id"]]
    return f"import {{ Swarvo }} from './swarvo'\n\nconst client = new Swarvo('sk_test_...')\nconsole.log(await {call})"


def reference(base: str) -> dict:
    return {
        "base_path": BASE_PATH, "auth": AUTH, "rate_limit": RATE_LIMIT, "errors": [{"status": s, "code": c, "desc": d} for s, c, d in ERRORS], "webhooks": WEBHOOKS,
        "endpoints": [{**e, "examples": {"curl": curl(e, base), "python": python(e), "typescript": typescript(e)}} for e in ENDPOINTS],
        "sdks": [
            {"id": "python", "name": "Python", "file": "swarvo.py", "install": "Download swarvo.py into your project. It needs nothing else."},
            {"id": "typescript", "name": "TypeScript", "file": "swarvo.ts", "install": "Download swarvo.ts into your project. It uses the built-in fetch."},
        ],
    }
