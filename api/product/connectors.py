"""Outside services a workspace can connect: calendars, CRMs, Slack, Sheets, WhatsApp, Shopify and payment links.

Each connector says what the customer must enter (`fields`), how to check it (`check`), what the agent can do on a call
(`actions`, run through tools that carry a secret address) and what happens after each call (`push`).
Every network call goes through one httpx client, so tests swap in a fake transport.
"""

import json
import os
import re
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Awaitable, Callable
from zoneinfo import ZoneInfo

import httpx
import jwt


class ConnectorError(Exception):
    """A problem with a message that is safe to show the customer or say to the caller."""


@dataclass
class Field:
    key: str
    label: str
    secret: bool = False
    hint: str = ""
    default: str = ""
    optional: bool = False


@dataclass
class Action:
    name: str
    key: str
    description: str
    params: list[dict]
    run: Callable[[dict, httpx.AsyncClient, dict], Awaitable[dict]]


@dataclass
class Connector:
    id: str
    name: str
    blurb: str
    fields: list[Field]
    check: Callable[[dict, httpx.AsyncClient], Awaitable[None]]
    actions: list[Action] = field(default_factory=list)
    push: Callable[[dict, httpx.AsyncClient, dict], Awaitable[None]] | None = None


def _p(name: str, description: str, required: bool = True, typ: str = "string") -> dict:
    return {"name": name, "type": typ, "description": description, "required": required}


async def _ok(r: httpx.Response, what: str) -> dict:
    if r.status_code in (401, 403):
        raise ConnectorError(f"{what} did not accept those details. Check them and try again.")
    if r.status_code >= 400:
        raise ConnectorError(f"{what} said no ({r.status_code}). Check the details and try again.")
    try:
        return r.json() if r.content else {}
    except ValueError:
        return {}


def client(transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=15, transport=transport)


# ---------------- Google (one platform service account for Calendar and Sheets) ----------------

def google_account() -> dict | None:
    raw = os.getenv("PRODUCT_GOOGLE_SA_JSON")
    try:
        d = json.loads(raw) if raw else None
    except ValueError:
        return None
    return d if d and d.get("client_email") and d.get("private_key") else None


def google_email() -> str | None:
    a = google_account()
    return a["client_email"] if a else None


async def _google_token(c: httpx.AsyncClient, scope: str) -> str:
    a = google_account()
    if a is None:
        raise ConnectorError("Google isn't switched on for this platform yet. Ask support to turn it on.")
    now = int(time.time())
    assertion = jwt.encode({"iss": a["client_email"], "scope": scope, "aud": "https://oauth2.googleapis.com/token", "iat": now, "exp": now + 3000}, a["private_key"], algorithm="RS256")
    r = await c.post("https://oauth2.googleapis.com/token", data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion})
    return (await _ok(r, "Google"))["access_token"]


def _sheet_id(text: str) -> str:
    m = re.search(r"/d/([A-Za-z0-9_-]+)", text)
    return m.group(1) if m else text.strip()


async def _sheets_check(cfg, c):
    t = await _google_token(c, "https://www.googleapis.com/auth/spreadsheets")
    r = await c.get(f"https://sheets.googleapis.com/v4/spreadsheets/{_sheet_id(cfg['sheet'])}", params={"fields": "properties.title"}, headers={"Authorization": f"Bearer {t}"})
    if r.status_code in (403, 404):
        raise ConnectorError(f"We can't open that sheet. Share it with {google_email()} as an editor, then try again.")
    await _ok(r, "Google Sheets")


async def _sheets_push(cfg, c, ev):
    t = await _google_token(c, "https://www.googleapis.com/auth/spreadsheets")
    tab = (cfg.get("tab") or "Sheet1").strip()
    row = [ev["when"], ev.get("name") or "", ev.get("phone") or "", ev.get("mood") or "", ev.get("summary") or "", ev.get("link") or ""]
    r = await c.post(f"https://sheets.googleapis.com/v4/spreadsheets/{_sheet_id(cfg['sheet'])}/values/{tab}!A:F:append", params={"valueInputOption": "USER_ENTERED"}, json={"values": [row]}, headers={"Authorization": f"Bearer {t}"})
    await _ok(r, "Google Sheets")


# ---- Google Calendar: free times from busy times inside working hours, and booking ----

CAL_SCOPE = "https://www.googleapis.com/auth/calendar"


def _hours(cfg: dict) -> tuple[int, int, int]:
    def num(k, d):
        try:
            return int(cfg.get(k) or d)
        except ValueError:
            return d
    return num("start_hour", 9), num("end_hour", 18), max(10, num("slot_minutes", 30))


async def _gcal_check(cfg, c):
    ZoneInfo(cfg.get("timezone") or "Asia/Kolkata")
    t = await _google_token(c, CAL_SCOPE)
    r = await c.get(f"https://www.googleapis.com/calendar/v3/calendars/{cfg['calendar_id'].strip()}", headers={"Authorization": f"Bearer {t}"})
    if r.status_code in (403, 404):
        raise ConnectorError(f"We can't open that calendar. Share it with {google_email()} and allow \"Make changes to events\", then try again.")
    await _ok(r, "Google Calendar")


async def _gcal_slots(cfg, c, args):
    tz = ZoneInfo(cfg.get("timezone") or "Asia/Kolkata")
    try:
        day = date.fromisoformat(str(args.get("date", "")).strip())
    except ValueError:
        return {"times": [], "message": "I need the day as YYYY-MM-DD."}
    sh, eh, step = _hours(cfg)
    start = datetime(day.year, day.month, day.day, sh, tzinfo=tz)
    end = datetime(day.year, day.month, day.day, eh, tzinfo=tz)
    t = await _google_token(c, CAL_SCOPE)
    r = await c.post("https://www.googleapis.com/calendar/v3/freeBusy", headers={"Authorization": f"Bearer {t}"}, json={"timeMin": start.isoformat(), "timeMax": end.isoformat(), "timeZone": str(tz), "items": [{"id": cfg["calendar_id"].strip()}]})
    busy = [(datetime.fromisoformat(b["start"].replace("Z", "+00:00")), datetime.fromisoformat(b["end"].replace("Z", "+00:00")))
            for b in ((await _ok(r, "Google Calendar")).get("calendars", {}).get(cfg["calendar_id"].strip(), {}).get("busy", []))]
    now, out, cur = datetime.now(tz), [], start
    while cur + timedelta(minutes=step) <= end:
        nxt = cur + timedelta(minutes=step)
        if cur > now and not any(b0 < nxt and b1 > cur for b0, b1 in busy):
            out.append(cur.strftime("%Y-%m-%d %H:%M"))
        cur = nxt
    return {"date": day.isoformat(), "timezone": str(tz), "times": out[:12], "message": "" if out else "Nothing is free that day."}


async def _gcal_book(cfg, c, args):
    tz = ZoneInfo(cfg.get("timezone") or "Asia/Kolkata")
    try:
        when = datetime.strptime(str(args.get("start", "")).strip().replace("T", " ")[:16], "%Y-%m-%d %H:%M").replace(tzinfo=tz)
    except ValueError:
        return {"booked": False, "message": "I need the time as YYYY-MM-DD HH:MM."}
    _, _, step = _hours(cfg)
    t = await _google_token(c, CAL_SCOPE)
    who = " · ".join(x for x in (str(args.get("name", "")).strip(), str(args.get("phone", "")).strip(), str(args.get("email", "")).strip()) if x)
    r = await c.post(f"https://www.googleapis.com/calendar/v3/calendars/{cfg['calendar_id'].strip()}/events", headers={"Authorization": f"Bearer {t}"},
                     json={"summary": f"Appointment: {args.get('name') or 'Caller'}", "description": f"Booked by your AI agent.\n{who}", "start": {"dateTime": when.isoformat(), "timeZone": str(tz)}, "end": {"dateTime": (when + timedelta(minutes=step)).isoformat(), "timeZone": str(tz)}})
    if r.status_code >= 400:
        return {"booked": False, "message": "I couldn't book that time. Please pick another."}
    return {"booked": True, "when": when.strftime("%A %d %B, %I:%M %p")}


# ---------------- Calendly ----------------

async def _calendly_check(cfg, c):
    r = await c.get("https://api.calendly.com/users/me", headers={"Authorization": f"Bearer {cfg['token'].strip()}"})
    await _ok(r, "Calendly")


async def _calendly_slots(cfg, c, args):
    try:
        day = date.fromisoformat(str(args.get("date", "")).strip())
    except ValueError:
        return {"times": [], "message": "I need the day as YYYY-MM-DD."}
    tz = ZoneInfo(cfg.get("timezone") or "Asia/Kolkata")
    start = max(datetime(day.year, day.month, day.day, tzinfo=tz), datetime.now(tz) + timedelta(minutes=5))
    end = datetime(day.year, day.month, day.day, tzinfo=tz) + timedelta(days=1)
    if start >= end:
        return {"times": [], "message": "That day has passed."}
    r = await c.get("https://api.calendly.com/event_type_available_times", params={"event_type": cfg["event_type"].strip(), "start_time": start.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%S.000000Z"), "end_time": end.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%S.000000Z")}, headers={"Authorization": f"Bearer {cfg['token'].strip()}"})
    items = (await _ok(r, "Calendly")).get("collection", [])
    out = [datetime.fromisoformat(i["start_time"].replace("Z", "+00:00")).astimezone(tz).strftime("%Y-%m-%d %H:%M") for i in items if i.get("status") == "available"][:12]
    return {"date": day.isoformat(), "timezone": str(tz), "times": out, "message": "" if out else "Nothing is free that day."}


async def _calendly_book(cfg, c, args):
    tz = ZoneInfo(cfg.get("timezone") or "Asia/Kolkata")
    email = str(args.get("email", "")).strip()
    if not email:
        return {"booked": False, "message": "I need the caller's email address to book this. Please ask for it."}
    try:
        when = datetime.strptime(str(args.get("start", "")).strip().replace("T", " ")[:16], "%Y-%m-%d %H:%M").replace(tzinfo=tz)
    except ValueError:
        return {"booked": False, "message": "I need the time as YYYY-MM-DD HH:MM."}
    r = await c.post("https://api.calendly.com/invitees", headers={"Authorization": f"Bearer {cfg['token'].strip()}"},
                     json={"event_type": cfg["event_type"].strip(), "start_time": when.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%S.000000Z"), "invitee": {"name": str(args.get("name") or "Caller"), "email": email, "timezone": str(tz)}})
    if r.status_code >= 400:
        return {"booked": False, "message": "That time isn't available. Please pick another."}
    return {"booked": True, "when": when.strftime("%A %d %B, %I:%M %p")}


# ---------------- CRMs ----------------

async def _hubspot_check(cfg, c):
    await _ok(await c.get("https://api.hubapi.com/crm/v3/objects/contacts", params={"limit": 1}, headers={"Authorization": f"Bearer {cfg['token'].strip()}"}), "HubSpot")


async def _hubspot_push(cfg, c, ev):
    h = {"Authorization": f"Bearer {cfg['token'].strip()}"}
    phone = ev.get("phone") or ""
    cid = None
    if phone:
        found = (await _ok(await c.post("https://api.hubapi.com/crm/v3/objects/contacts/search", headers=h, json={"filterGroups": [{"filters": [{"propertyName": "phone", "operator": "EQ", "value": phone}]}], "limit": 1}), "HubSpot")).get("results", [])
        cid = found[0]["id"] if found else None
    if cid is None:
        props = {"phone": phone, "firstname": ev.get("name") or "Caller", "lifecyclestage": "lead"}
        cid = (await _ok(await c.post("https://api.hubapi.com/crm/v3/objects/contacts", headers=h, json={"properties": props}), "HubSpot")).get("id")
    note = f"{ev.get('summary') or 'Phone call'}\nMood: {ev.get('mood') or 'n/a'}\n{ev.get('link') or ''}"
    await _ok(await c.post("https://api.hubapi.com/crm/v3/objects/notes", headers=h, json={"properties": {"hs_note_body": note, "hs_timestamp": int(time.time() * 1000)},
              "associations": [{"to": {"id": cid}, "types": [{"associationCategory": "HUBSPOT_DEFINED", "associationTypeId": 202}]}]}), "HubSpot")


async def _sf_token(cfg, c) -> tuple[str, str]:
    base = cfg["instance_url"].strip().rstrip("/")
    r = await c.post(f"{base}/services/oauth2/token", data={"grant_type": "client_credentials", "client_id": cfg["client_id"].strip(), "client_secret": cfg["client_secret"].strip()})
    return (await _ok(r, "Salesforce"))["access_token"], base


async def _sf_check(cfg, c):
    await _sf_token(cfg, c)


async def _sf_push(cfg, c, ev):
    tok, base = await _sf_token(cfg, c)
    r = await c.post(f"{base}/services/data/v60.0/sobjects/Lead", headers={"Authorization": f"Bearer {tok}"},
                     json={"LastName": ev.get("name") or "Caller", "Company": "Phone call", "Phone": ev.get("phone") or "", "LeadSource": "Phone Inquiry", "Description": f"{ev.get('summary') or ''}\n{ev.get('link') or ''}"})
    await _ok(r, "Salesforce")


async def _zoho_token(cfg, c) -> tuple[str, str]:
    region = (cfg.get("region") or "in").strip().lower()
    r = await c.post(f"https://accounts.zoho.{region}/oauth/v2/token", data={"grant_type": "refresh_token", "client_id": cfg["client_id"].strip(), "client_secret": cfg["client_secret"].strip(), "refresh_token": cfg["refresh_token"].strip()})
    d = await _ok(r, "Zoho")
    if "access_token" not in d:
        raise ConnectorError("Zoho did not accept those details. Check them and try again.")
    return d["access_token"], d.get("api_domain") or f"https://www.zohoapis.{region}"


async def _zoho_check(cfg, c):
    await _zoho_token(cfg, c)


async def _zoho_push(cfg, c, ev):
    tok, api = await _zoho_token(cfg, c)
    r = await c.post(f"{api}/crm/v6/Leads", headers={"Authorization": f"Zoho-oauthtoken {tok}"},
                     json={"data": [{"Last_Name": ev.get("name") or "Caller", "Phone": ev.get("phone") or "", "Lead_Source": "Cold Call", "Description": f"{ev.get('summary') or ''}\n{ev.get('link') or ''}"}]})
    await _ok(r, "Zoho")


# ---------------- Slack, WhatsApp, Shopify, Razorpay ----------------

async def _slack_check(cfg, c):
    r = await c.post(cfg["webhook_url"].strip(), json={"text": "Swarvo AI is connected. Call summaries will appear here."})
    if r.status_code >= 400:
        raise ConnectorError("Slack did not accept that web address. Make a new Incoming Webhook and paste it here.")


async def _slack_push(cfg, c, ev):
    mood = f" · mood {ev['mood']}" if ev.get("mood") else ""
    await c.post(cfg["webhook_url"].strip(), json={"text": f"*New call* {ev.get('name') or ev.get('phone') or ''}{mood}\n{ev.get('summary') or ''}\n<{ev.get('link')}|Open the call>"})


def _wa_url(cfg: dict) -> str:
    return f"https://graph.facebook.com/v20.0/{cfg['phone_number_id'].strip()}"


async def _wa_check(cfg, c):
    await _ok(await c.get(_wa_url(cfg), headers={"Authorization": f"Bearer {cfg['token'].strip()}"}), "WhatsApp")


async def _wa_push(cfg, c, ev):
    phone = re.sub(r"\D", "", ev.get("phone") or "")
    if not phone:
        return
    tpl = {"name": cfg["template"].strip(), "language": {"code": (cfg.get("language") or "en").strip()}}
    if (cfg.get("uses_name") or "").lower() in ("yes", "true", "1"):
        tpl["components"] = [{"type": "body", "parameters": [{"type": "text", "text": ev.get("name") or "there"}]}]
    await _ok(await c.post(f"{_wa_url(cfg)}/messages", headers={"Authorization": f"Bearer {cfg['token'].strip()}"}, json={"messaging_product": "whatsapp", "to": phone, "type": "template", "template": tpl}), "WhatsApp")


def _shop(cfg: dict) -> str:
    return f"https://{re.sub(r'^https?://', '', cfg['shop'].strip()).rstrip('/')}/admin/api/2024-10"


async def _shopify_check(cfg, c):
    await _ok(await c.get(f"{_shop(cfg)}/shop.json", headers={"X-Shopify-Access-Token": cfg["token"].strip()}), "Shopify")


async def _shopify_order(cfg, c, args):
    num = re.sub(r"\D", "", str(args.get("order_number", "")))
    if not num:
        return {"found": False, "message": "I need the order number."}
    d = await _ok(await c.get(f"{_shop(cfg)}/orders.json", params={"name": f"#{num}", "status": "any"}, headers={"X-Shopify-Access-Token": cfg["token"].strip()}), "Shopify")
    orders = d.get("orders", [])
    if not orders:
        return {"found": False, "message": "I can't find that order."}
    o = orders[0]
    ful = (o.get("fulfillments") or [{}])[0]
    return {"found": True, "order": o.get("name"), "paid": o.get("financial_status"), "shipping": o.get("fulfillment_status") or "not shipped yet", "total": f"{o.get('total_price')} {o.get('currency')}",
            "tracking": ful.get("tracking_number"), "tracking_link": ful.get("tracking_url")}


def _rzp_auth(cfg: dict) -> tuple[str, str]:
    return cfg["key_id"].strip(), cfg["key_secret"].strip()


async def _rzp_check(cfg, c):
    await _ok(await c.get("https://api.razorpay.com/v1/payments", params={"count": 1}, auth=_rzp_auth(cfg)), "Razorpay")


async def _rzp_link(cfg, c, args):
    try:
        rupees = float(str(args.get("amount", "")).replace(",", ""))
    except ValueError:
        rupees = 0
    phone = re.sub(r"[^\d+]", "", str(args.get("phone", "")))
    if rupees < 1 or not phone:
        return {"sent": False, "message": "I need an amount and the caller's phone number."}
    r = await c.post("https://api.razorpay.com/v1/payment_links", auth=_rzp_auth(cfg), json={"amount": int(round(rupees * 100)), "currency": "INR", "description": str(args.get("description") or "Payment")[:200],
                                                                                              "customer": {"name": str(args.get("name") or "Customer")[:100], "contact": phone}, "notify": {"sms": True}})
    if r.status_code >= 400:
        return {"sent": False, "message": "I couldn't send the payment link."}
    return {"sent": True, "message": f"I've texted a payment link for {rupees:g} rupees to {phone}."}


_URL = "Start with https://"
REGISTRY: dict[str, Connector] = {c.id: c for c in [
    Connector("google_calendar", "Google Calendar", "Check free times and book appointments straight into your calendar.",
              [Field("calendar_id", "Calendar ID", hint="Google Calendar → Settings → your calendar → Integrate → Calendar ID. Share the calendar with our address below first."),
               Field("timezone", "Time zone", default="Asia/Kolkata", optional=True), Field("start_hour", "Opening hour (0-23)", default="9", optional=True),
               Field("end_hour", "Closing hour (0-23)", default="18", optional=True), Field("slot_minutes", "Appointment length (minutes)", default="30", optional=True)], _gcal_check,
              [Action("Check free appointment times", "slots", "Check which appointment times are free on a given day. Use before offering times to the caller.", [_p("date", "The day to check, as YYYY-MM-DD")], _gcal_slots),
               Action("Book an appointment", "book", "Book an appointment once the caller has agreed a time. Only use a time that was offered as free.",
                      [_p("start", "The agreed time, as YYYY-MM-DD HH:MM (24 hour, local time)"), _p("name", "The caller's name"), _p("phone", "The caller's phone number", False), _p("email", "The caller's email", False)], _gcal_book)]),
    Connector("calendly", "Calendly", "Check free times and book into your Calendly event.",
              [Field("token", "Personal access token", secret=True, hint="Calendly → Integrations → API & Webhooks → Personal access tokens. Booking needs a paid Calendly plan."),
               Field("event_type", "Event type link", hint="The event's API address, like https://api.calendly.com/event_types/XXXX (see Calendly's event types API)."), Field("timezone", "Time zone", default="Asia/Kolkata", optional=True)], _calendly_check,
              [Action("Check free appointment times", "slots", "Check which appointment times are free on a given day.", [_p("date", "The day to check, as YYYY-MM-DD")], _calendly_slots),
               Action("Book an appointment", "book", "Book an appointment once the caller agreed a time. Calendly needs the caller's email.",
                      [_p("start", "The agreed time, as YYYY-MM-DD HH:MM"), _p("name", "The caller's name"), _p("email", "The caller's email address")], _calendly_book)]),
    Connector("hubspot", "HubSpot", "Add every caller to HubSpot with a note of what happened.", [Field("token", "Private app token", secret=True, hint="HubSpot → Settings → Integrations → Private Apps. Allow contacts and notes.")], _hubspot_check, push=_hubspot_push),
    Connector("salesforce", "Salesforce", "Create a Lead in Salesforce after each call.",
              [Field("instance_url", "Your Salesforce address", hint="Like https://yourcompany.my.salesforce.com"), Field("client_id", "Consumer key", secret=True), Field("client_secret", "Consumer secret", secret=True, hint="From a Connected App with client credentials turned on.")], _sf_check, push=_sf_push),
    Connector("zoho", "Zoho CRM", "Create a Lead in Zoho CRM after each call.",
              [Field("client_id", "Client ID", secret=True), Field("client_secret", "Client secret", secret=True), Field("refresh_token", "Refresh token", secret=True, hint="From the Zoho API console (self client)."), Field("region", "Zoho region", default="in", hint="in, com, eu or com.au", optional=True)], _zoho_check, push=_zoho_push),
    Connector("shopify", "Shopify", "Let the agent look up an order and say where it is.", [Field("shop", "Store address", hint="yourstore.myshopify.com"), Field("token", "Admin API access token", secret=True, hint="Shopify admin → Apps → Develop apps. Allow reading orders.")], _shopify_check,
              [Action("Look up an order", "order", "Look up a customer's order by its number and tell them its payment and shipping status.", [_p("order_number", "The order number, like 1001")], _shopify_order)]),
    Connector("slack", "Slack", "Post a summary of every call to a Slack channel.", [Field("webhook_url", "Incoming webhook address", secret=True, hint="Slack → Apps → Incoming Webhooks. " + _URL)], _slack_check, push=_slack_push),
    Connector("whatsapp", "WhatsApp", "Send each caller a follow-up WhatsApp message after the call.",
              [Field("phone_number_id", "Phone number ID", hint="Meta for Developers → WhatsApp → API setup."), Field("token", "Access token", secret=True), Field("template", "Approved template name", hint="Messages outside a chat need a template Meta has approved."),
               Field("language", "Template language", default="en", optional=True), Field("uses_name", "Template has the caller's name in {{1}}? (yes/no)", default="no", optional=True)], _wa_check, push=_wa_push),
    Connector("google_sheets", "Google Sheets", "Add a row to a sheet for every call.", [Field("sheet", "Sheet link", hint="Paste the sheet's link. Share it with our address below as an editor."), Field("tab", "Tab name", default="Sheet1", optional=True)], _sheets_check, push=_sheets_push),
    Connector("razorpay_links", "Razorpay payment links", "Let the agent text a payment link during a call. Uses your own Razorpay account.", [Field("key_id", "Key ID", hint="Razorpay dashboard → API keys."), Field("key_secret", "Key secret", secret=True)], _rzp_check,
              [Action("Send a payment link", "pay", "Text the caller a payment link once they agree to pay.", [_p("amount", "Amount in rupees"), _p("phone", "The caller's phone number with country code"), _p("name", "The caller's name", False), _p("description", "What the payment is for", False)], _rzp_link)]),
]}
GOOGLE = ("google_calendar", "google_sheets")


def info(cid: str) -> str | None:
    if cid in GOOGLE:
        e = google_email()
        return f"Share with {e}" if e else "Not switched on for this platform yet"
    return None


def missing(c: Connector, cfg: dict) -> list[str]:
    return [f.label for f in c.fields if not f.optional and not str(cfg.get(f.key, "")).strip()]

