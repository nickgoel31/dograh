# Public API

Base: `https://YOUR-API/api/v1/public`. Read-only today.

## Authentication

Create a key under **Developers**. Send it on every request:

```
Authorization: Bearer sk_test_…
```

- `sk_test_` keys see your Test data (practice calls). `sk_live_` keys see your Live data.
- A key is shown once when created. Revoke it any time; it stops working immediately.
- Limit: 120 requests per minute per key. Over the limit you get `429` with a plain message.

## Errors

Every error is JSON: `{"detail": {"code": "bad_api_key", "message": "…"}}`. `code` is stable; `message` is for people.

| Status | code | Meaning |
|---|---|---|
| 401 | `bad_api_key` | Missing, wrong or revoked key |
| 404 | `call_not_found` | No such call for this key |
| 429 | — | Too many requests |

## Endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/me` | `{workspace, environment}` — handy to check a key |
| GET | `/agents` | `[{id, name, status}]` for agents that exist in this environment |
| GET | `/calls?page=1&limit=25&agent=agt_…` | `{calls, total, page, limit}`, newest first (limit ≤ 100) |
| GET | `/calls/{id}` | One call with transcript turns, extracted answers, cost split and (if allowed) a short-lived audio link |

Call fields: `id, time, caller, phone, agent_id, agent_name, duration (seconds), outcome (booked, resolved, qualified, transferred, voicemail, no-answer, failed…), cost, fail_reason, test`.

Workspace privacy settings apply: with "hide personal details" on, phone numbers and transcript text are masked; with recordings hidden, `audio_url` is `null`.

```bash
curl https://YOUR-API/api/v1/public/calls?limit=5 -H "Authorization: Bearer $KEY"
```

Not available yet: starting calls, managing agents or numbers through the API; published SDK packages (generate a client from `/openapi.json` if you want one).

## Webhooks

Add an https address under **Developers → Webhooks** and choose events: `call.started`, `call.ended`, `campaign.completed` (`tool.failed` is listed but not sent yet). Webhooks follow the Test/Live toggle they were created in.

Body:

```json
{"id": "evt_…", "type": "call.ended", "created": "2026-01-01T10:00:00+00:00", "environment": "live",
 "data": {"call_id": "call_…", "agent_id": "agt_…", "test": false, "duration": 92, "outcome": "booked"}}
```

Verify the signature header `X-<Brand>-Signature: t=<unix time>,v1=<hex>` where `v1 = HMAC_SHA256(secret, "<t>.<raw body>")`. Reject anything older than a few minutes.

```python
import hmac, hashlib
def valid(secret, header, body: bytes) -> bool:
    t, v1 = (p.split("=", 1)[1] for p in header.split(","))
    return hmac.compare_digest(v1, hmac.new(secret.encode(), f"{t}.".encode() + body, hashlib.sha256).hexdigest())
```

Answer with any `2xx` within 8 seconds. Otherwise we retry after 1 min, 5 min, 30 min, 2 h and 12 h (6 tries), then mark it failed and alert the workspace. You can resend any delivery from the page. Events may arrive more than once; use `id` to de-duplicate.

## Website call button

Settings → Privacy → add your website; Developers → Website button gives a one-line `<script>`. Only Live agents can be called this way and calls use the Live balance.
