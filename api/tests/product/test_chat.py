"""Chat agents: the website chat, the team inbox, WhatsApp, and tenant isolation."""

import hashlib
import hmac
import json

import pytest_asyncio

from api.product import chat, emailer, llm_gateway
from api.tests.product.support import bearer, make_client, signup
from api.tests.product.test_platform import make_agent


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        yield c


def fakes(client):
    ov = client._transport.app.dependency_overrides
    return ov[llm_gateway.get_text](), ov[emailer.get_mailer]()


async def live_chat(client, email="a@x.com"):
    _, tok = await signup(client, email)
    h = bearer(tok)
    aid, _ = await make_agent(client, h)
    await client.post(f"/product/agents/{aid}/publish", headers=h)
    cfg = (await client.get("/product/chat/settings", headers=h)).json()
    return h, aid, cfg


async def test_the_website_chat_answers_remembers_and_checks_the_website(client):
    h, aid, cfg = await live_chat(client)
    assert cfg["ready"] and cfg["key"].startswith("chat_") and cfg["config"]["title"]
    await client.put("/product/chat/settings", headers=h, json={"agent_id": aid, "enabled": True, "origins": ["https://shop.example.com/"], "config": {"title": "Ask Acme", "color": "#112233", "prompts": ["Opening hours?", "  "]}})
    pub = (await client.get(f"/public/chat/config?key={cfg['key']}")).json()
    assert pub["enabled"] and pub["title"] == "Ask Acme" and pub["color"] == "#112233" and pub["prompts"] == ["Opening hours?"]
    assert "whatsapp" not in pub and "origins" not in pub  # nothing private goes to someone else's website
    assert (await client.get("/public/chat.js")).headers["content-type"].startswith("application/javascript")

    bad = {"key": cfg["key"], "embedder": "https://evil.example.com"}
    assert (await client.post("/public/chat/session", json=bad)).status_code == 403
    opened = (await client.post("/public/chat/session", json={"key": cfg["key"], "embedder": "https://shop.example.com", "name": "Ravi", "email": "ravi@x.com"})).json()
    tok = opened["token"]
    said = (await client.post("/public/chat/message", json={"token": tok, "text": "Do you open on Sunday?"})).json()
    assert [m["role"] for m in said["messages"]] == ["visitor", "agent"] and said["status"] == "bot"
    # coming back later shows the whole conversation
    again = (await client.post("/public/chat/session", json={"key": cfg["key"], "embedder": "https://shop.example.com", "token": tok})).json()
    assert again["token"] == tok and [m["role"] for m in again["messages"]] == ["visitor", "agent"]
    assert (await client.post("/public/chat/rate", json={"token": tok, "rating": 5})).status_code == 200
    assert (await client.post("/public/chat/message", json={"token": "cs_nope", "text": "hi"})).status_code == 400
    # switched off: nothing opens
    await client.put("/product/chat/settings", headers=h, json={"agent_id": aid, "enabled": False})
    assert (await client.get(f"/public/chat/config?key={cfg['key']}")).json()["enabled"] is False
    assert (await client.post("/public/chat/session", json={"key": cfg["key"], "embedder": "https://shop.example.com"})).status_code == 404


async def test_a_customer_can_ask_for_a_person_and_the_team_takes_over_from_the_inbox(client):
    h, aid, cfg = await live_chat(client)
    await client.put("/product/chat/settings", headers=h, json={"agent_id": aid, "notify_email": "team@acme.com"})
    _, mailer = fakes(client)
    tok = (await client.post("/public/chat/session", json={"key": cfg["key"], "embedder": "http://t"})).json()["token"]
    out = (await client.post("/public/chat/message", json={"token": tok, "text": "I want to talk to a real person please"})).json()
    assert out["status"] == "human" and out["messages"][-1]["text"] == chat.HANDOFF_REPLY
    assert mailer.sent and mailer.sent[-1][0] == "team@acme.com"
    inbox = (await client.get("/product/chat/sessions?status=human", headers=h)).json()
    assert inbox["needs_you"] == 1 and len(inbox["sessions"]) == 1
    sid = inbox["sessions"][0]["id"]
    # while a person has it, the agent stays quiet and the team is told there is something new
    quiet = (await client.post("/public/chat/message", json={"token": tok, "text": "Hello? Anyone there?"})).json()
    assert [m["role"] for m in quiet["messages"]] == ["visitor"]
    assert (await client.get("/product/chat/sessions", headers=h)).json()["sessions"][0]["unread"] == 1
    thread = (await client.get(f"/product/chat/sessions/{sid}", headers=h)).json()
    assert thread["messages"][-1]["text"] == "Hello? Anyone there?" and (await client.get("/product/chat/sessions", headers=h)).json()["sessions"][0]["unread"] == 0
    sent = (await client.post(f"/product/chat/sessions/{sid}/reply", headers=h, json={"text": "Hi, this is Priya from the team."})).json()
    polled = (await client.get(f"/public/chat/poll?token={tok}&after=0")).json()
    assert sent["delivered"] and [m["role"] for m in polled["messages"]][-1] == "human" and polled["status"] == "human"
    # handed back to the agent, then closed
    assert (await client.post(f"/product/chat/sessions/{sid}/status", headers=h, json={"status": "bot"})).json()["status"] == "bot"
    back = (await client.post("/public/chat/message", json={"token": tok, "text": "Thanks"})).json()
    assert [m["role"] for m in back["messages"]] == ["visitor", "agent"]
    assert (await client.post(f"/product/chat/sessions/{sid}/status", headers=h, json={"status": "closed"})).json()["status"] == "closed"
    stats = (await client.get("/product/chat/stats", headers=h)).json()
    assert stats["sessions"] == 1 and stats["handed_over"] == 1 and stats["messages"] >= 6


async def test_nobody_can_read_or_answer_another_workspaces_chats(client):
    h, aid, cfg = await live_chat(client)
    tok = (await client.post("/public/chat/session", json={"key": cfg["key"], "embedder": "http://t"})).json()["token"]
    await client.post("/public/chat/message", json={"token": tok, "text": "hello"})
    sid = (await client.get("/product/chat/sessions", headers=h)).json()["sessions"][0]["id"]
    other = bearer((await signup(client, "b@x.com"))[1])
    assert (await client.get("/product/chat/sessions", headers=other)).json()["sessions"] == []
    assert (await client.get(f"/product/chat/sessions/{sid}", headers=other)).status_code == 404
    assert (await client.post(f"/product/chat/sessions/{sid}/reply", headers=other, json={"text": "x"})).status_code == 404
    assert (await client.put("/product/chat/settings", headers=other, json={"agent_id": aid})).status_code == 404  # not their agent


async def test_whatsapp_messages_are_signed_answered_once_and_replies_go_out(client):
    h, aid, cfg = await live_chat(client)
    sent = []

    class Sender:
        async def send(self, pid, token, to, text):
            sent.append((pid, token, to, text))

    client._transport.app.dependency_overrides[chat.get_wa_sender] = lambda: Sender()
    saved = (await client.put("/product/chat/settings", headers=h, json={"agent_id": aid, "whatsapp": {"phone_number_id": "1055", "token": "EAAB", "app_secret": "shh"}})).json()
    wa = saved["whatsapp"]
    assert wa["connected"] and wa["verify_token"].startswith("vt_") and "EAAB" not in json.dumps(saved)
    ok = await client.get("/product/hooks/whatsapp", params={"hub.mode": "subscribe", "hub.verify_token": wa["verify_token"], "hub.challenge": "777"})
    assert ok.text == "777" and (await client.get("/product/hooks/whatsapp", params={"hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "1"})).status_code == 403

    def event(body, mid):
        return {"entry": [{"changes": [{"value": {"metadata": {"phone_number_id": "1055"}, "contacts": [{"wa_id": "919811112222", "profile": {"name": "Meera"}}],
                                                  "messages": [{"id": mid, "from": "919811112222", "type": "text", "text": {"body": body}}]}}]}]}

    async def deliver(payload, secret="shh"):
        raw = json.dumps(payload).encode()
        sig = "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
        return await client.post("/product/hooks/whatsapp", content=raw, headers={"x-hub-signature-256": sig, "content-type": "application/json"})

    assert (await deliver(event("Hi, are you open?", "wamid.1"), secret="not-the-secret")).status_code == 200
    assert sent == []  # a message not signed by Meta is ignored
    await deliver(event("Hi, are you open?", "wamid.1"))
    assert len(sent) == 1 and sent[0][:3] == ("1055", "EAAB", "919811112222")
    await deliver(event("Hi, are you open?", "wamid.1"))  # Meta retries a delivery: it is not answered twice
    assert len(sent) == 1
    inbox = (await client.get("/product/chat/sessions", headers=h)).json()["sessions"]
    assert len(inbox) == 1 and inbox[0]["channel"] == "whatsapp" and inbox[0]["name"] == "Meera"
    # the team answers on WhatsApp from the inbox
    await client.post(f"/product/chat/sessions/{inbox[0]['id']}/reply", headers=h, json={"text": "Yes, until 6."})
    assert sent[-1][3] == "Yes, until 6." and sent[-1][2] == "919811112222"
    # one number can only belong to one workspace
    other = bearer((await signup(client, "b@x.com"))[1])
    clash = await client.put("/product/chat/settings", headers=other, json={"whatsapp": {"phone_number_id": "1055"}})
    assert clash.status_code == 409
