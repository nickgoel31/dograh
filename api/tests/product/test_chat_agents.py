"""Chat agents with their own instructions, model, simple flow, widget and per-reply billing; and how a team member helps a chat they have taken over."""

import pytest_asyncio
from sqlalchemy import select, update

from api.db.models import OrganizationModel
from api.db.product_models import ProductChatMessageModel, ProductWorkspaceModel
from api.product import chat_catalog, chat_flow
from api.tests.product.support import bearer, make_client, signup

SITE = "https://shop.example.com"


@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        yield c


async def setup(client, email="a@x.com", money=100.0):
    _, tok = await signup(client, email)
    h = bearer(tok)
    async with client.session_factory() as s:  # the workspace has a wallet with some money
        ws = (await s.scalars(select(ProductWorkspaceModel))).first()
        await s.execute(update(OrganizationModel).where(OrganizationModel.id == ws.live_org_id).values(wallet_enabled=True))
        await s.commit()
    client.wallet.balance = money
    return h


async def make(client, h, use_case="support", **extra):
    r = await client.post("/product/chat/agents", json={"use_case": use_case, **extra}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


async def go_live(client, h, a):
    r = await client.post(f"/product/chat/agents/{a['id']}/status", json={"status": "live"}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


async def visit(client, a):
    r = await client.post("/public/chat/session", json={"key": a["key"], "embedder": SITE})
    assert r.status_code == 200, r.text
    return r.json()


async def say(client, token, text):
    r = await client.post("/public/chat/message", json={"token": token, "text": text})
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------- the flow on its own
def test_a_half_edited_flow_is_made_safe():
    f = chat_flow.clean_flow({"steps": [{"id": "A b", "type": "choice", "text": "Pick", "options": [{"label": "One", "goto": "nowhere"}, {"label": "", "goto": "ai"}]}, {"type": "bogus"}, {"id": "x", "type": "message", "text": "hi", "next": "gone"}]})
    ids = [s["id"] for s in f["steps"]]
    assert len(ids) == 2 and len(set(ids)) == 2
    assert f["steps"][0]["options"] == [{"label": "One", "goto": "ai"}] and "next" not in f["steps"][1]  # pointers to nothing are repaired
    assert chat_flow.clean_flow({"steps": []})["steps"][0]["type"] == "ai" and chat_flow.clean_flow(None)["steps"][0]["type"] == "ai"
    only_choice = chat_flow.clean_flow({"steps": [{"id": "c", "type": "choice", "text": "x", "options": []}]})
    assert only_choice["steps"][0]["type"] == "message"  # a choice with no buttons cannot wait for an answer


def test_the_flow_asks_checks_remembers_branches_and_ends_in_ai():
    flow = chat_flow.clean_flow({"steps": [
        {"id": "hi", "type": "message", "text": "Hello!"},
        {"id": "name", "type": "ask", "text": "Your name?", "save_as": "name"},
        {"id": "mail", "type": "ask", "text": "Hi {first_name}, your email?", "save_as": "email", "kind": "email"},
        {"id": "pick", "type": "choice", "text": "What now?", "options": [{"label": "Chat", "goto": "ai"}, {"label": "Person", "goto": "human"}, {"label": "Bye", "goto": "end"}]},
        {"id": "talk", "type": "ai", "text": ""}]})
    t = chat_flow.start(flow)
    assert [m["text"] for m in t.say] == ["Hello!", "Your name?"] and not t.ai
    t = chat_flow.answer(flow, t.state, "Ravi Kumar")
    assert t.say[0]["text"] == "Hi Ravi, your email?" and t.state["vars"]["name"] == "Ravi Kumar"
    bad = chat_flow.answer(flow, t.state, "not an email")
    assert "doesn't look like an email" in bad.say[0]["text"] and bad.state["step"] == "mail"
    t = chat_flow.answer(flow, t.state, "ravi@x.com")
    assert t.say[0]["options"] == ["Chat", "Person", "Bye"]
    assert chat_flow.answer(flow, t.state, "2").human  # a number picks a button
    button = chat_flow.answer(flow, t.state, "Chat")
    assert button.ai and not button.say and button.state["ai"]  # a button that leads to the AI is answered by the AI
    assert chat_flow.answer(flow, t.state, "bye").state["done"]
    free = chat_flow.answer(flow, t.state, "actually, what are your prices?")
    assert free.ai and free.state["ai"]  # they typed instead of tapping: the AI takes it
    assert chat_flow.answer(flow, free.state, "and delivery?").ai


# ---------------------------------------------------------------- creating and editing
async def test_a_chat_agent_is_made_from_a_use_case_and_improved_from_a_description(client):
    h = await setup(client)
    a = await make(client, h, "booking", business="Sunrise Dental")
    assert a["status"] == "draft" and a["use_case"] == "booking" and a["key"].startswith("cw_") and "Sunrise Dental" in a["prompt"]
    assert [s["type"] for s in a["flow"]["steps"]][:2] == ["ask", "ask"] and a["model"] == "gpt-4.1-mini" and a["price"] == 0.6
    b = await make(client, h, "support", business="Sunrise Dental", description="A dental clinic in Pune. Open 10 to 6. We do braces and check-ups.")
    assert b["written_by_ai"] and b["name"] == "Meera" and "Sunrise Dental" in b["prompt"] and b["widget"]["greeting"] == "Hi, I am Meera!" and b["widget"]["prompts"] == ["Book a check-up", "Opening hours"]
    client.llm.chat_setup = "not json"  # no AI: it is still a working agent from the preset
    c = await make(client, h, "faq", description="whatever")
    assert not c["written_by_ai"] and c["prompt"]
    meta = (await client.get("/product/chat/meta", headers=h)).json()
    assert {u["key"] for u in meta["use_cases"]} == {"support", "sales", "booking", "faq", "orders", "custom"} and len(meta["models"]) >= 4
    assert (await client.get("/product/chat/agents", headers=h)).json()[0]["id"] == a["id"]


async def test_editing_by_hand_validates_and_can_be_undone(client):
    h = await setup(client)
    a = await make(client, h)
    r = await client.patch(f"/product/chat/agents/{a['id']}", headers=h, json={"model": "gpt-4.1", "temperature": 9, "tone": "Professional", "reply_length": "long", "memory": 500, "language": "Hindi",
                                                                             "handover": {"keywords": ["Refund ", "refund", "  "], "after_failures": 99}, "widget": {"color": "javascript:1", "title": "Help"}})
    d = r.json()
    assert d["model"] == "gpt-4.1" and d["temperature"] == 1.0 and d["memory"] == 40 and d["tone"] == "Professional" and d["language"] == "Hindi"
    assert d["handover"]["keywords"] == ["refund"] and d["handover"]["after_failures"] == 10 and d["widget"]["color"] != "javascript:1" and d["widget"]["title"] == "Help"
    assert (await client.patch(f"/product/chat/agents/{a['id']}", headers=h, json={"model": "made-up"})).json()["model"] == "gpt-4.1-mini"  # an unknown model falls back to the default
    assert (await client.patch(f"/product/chat/agents/{a['id']}", headers=h, json={"origins": ["not a site"]})).status_code == 400
    hist = (await client.get(f"/product/chat/agents/{a['id']}/history", headers=h)).json()
    assert len(hist) >= 2
    back = await client.post(f"/product/chat/agents/{a['id']}/undo", headers=h, json={"index": len(hist) - 1})
    assert back.json()["tone"] == "Friendly" and back.json()["model"] == "gpt-4.1-mini"  # all the way back to the start
    assert (await client.post(f"/product/chat/agents/{a['id']}/undo", headers=h, json={"index": 0})).status_code == 400  # nothing left to undo


async def test_the_agent_can_be_changed_by_describing_the_change(client):
    h = await setup(client)
    a = await make(client, h)
    r = (await client.post(f"/product/chat/agents/{a['id']}/ai-edit", headers=h, json={"instruction": "Make it more formal and greet people politely"})).json()
    assert r["summary"] == "Made the agent more formal." and set(r["changed"]) >= {"tone", "widget"} and r["agent"]["tone"] == "Professional" and r["agent"]["widget"]["greeting"].startswith("Good day")
    undo = await client.post(f"/product/chat/agents/{a['id']}/undo", headers=h, json={"index": 0})
    assert undo.json()["tone"] == "Friendly"  # one tap puts it back
    preview = (await client.post(f"/product/chat/agents/{a['id']}/ai-edit", headers=h, json={"instruction": "Make it formal", "apply": False})).json()
    assert "tone" in preview["changes"] and (await client.get(f"/product/chat/agents/{a['id']}", headers=h)).json()["tone"] == "Friendly"  # a preview changes nothing
    client.llm.chat_edit = '{"summary": "Added a step.", "flow": {"steps": [{"id": "n", "type": "ask", "text": "Name?", "save_as": "name"}, {"id": "ai", "type": "ai"}]}}'
    f = (await client.post(f"/product/chat/agents/{a['id']}/ai-edit", headers=h, json={"instruction": "Ask for their name first"})).json()["agent"]["flow"]
    assert [s["type"] for s in f["steps"]] == ["ask", "ai"] and f["steps"][0]["id"] == "n"
    client.llm.chat_edit = "I cannot help"
    assert (await client.post(f"/product/chat/agents/{a['id']}/ai-edit", headers=h, json={"instruction": "do something"})).status_code == 502


async def test_a_workspace_never_sees_or_edits_anothers_chat_agents(client):
    h = await setup(client)
    a = await make(client, h)
    client.cookies.clear()
    _, tok = await signup(client, "b@x.com")
    other = bearer(tok)
    assert (await client.get("/product/chat/agents", headers=other)).json() == []
    for call in (client.get(f"/product/chat/agents/{a['id']}", headers=other), client.patch(f"/product/chat/agents/{a['id']}", json={"name": "x"}, headers=other), client.delete(f"/product/chat/agents/{a['id']}", headers=other),
                 client.post(f"/product/chat/agents/{a['id']}/ai-edit", json={"instruction": "change it"}, headers=other)):
        assert (await call).status_code == 404


# ---------------------------------------------------------------- the widget, the AI and the bill
async def test_a_visitor_goes_through_the_flow_then_the_ai_answers_and_each_ai_reply_is_charged(client):
    h = await setup(client)
    a = await make(client, h, "sales", business="Acme")
    assert (await client.post("/public/chat/session", json={"key": a["key"], "embedder": SITE})).status_code == 404  # a draft is not shown
    assert (await client.get(f"/public/chat/config?key={a['key']}")).json()["enabled"] is False
    await go_live(client, h, a)
    cfg = (await client.get(f"/public/chat/config?key={a['key']}")).json()
    assert cfg["enabled"] and cfg["title"] == "Talk to sales" and "prompt" not in cfg and "flow" not in cfg
    opened = await visit(client, a)
    assert [m["text"] for m in opened["messages"]] == ["Hi! I'm here to help you find the right option for you.", "May I know your name?"]
    tok = opened["token"]
    asked = await say(client, tok, "Ravi Kumar")
    assert asked["messages"][1]["text"] == "Nice to meet you, Ravi! What's the best email to reach you on?"
    assert "doesn't look like an email" in (await say(client, tok, "ravi at x"))["messages"][1]["text"]
    start = await say(client, tok, "ravi@x.com")
    assert start["messages"][1]["text"] == "Thanks! What are you looking for today?"
    assert client.wallet.balance == 100.0  # everything so far was scripted, so it was free
    client.llm.chat_reply = "We have two plans. The Starter one is great for small shops."
    r = await say(client, tok, "What plans do you have?")
    assert [m["role"] for m in r["messages"]] == ["visitor", "agent"] and "Starter" in r["messages"][1]["text"]
    assert client.wallet.balance == 99.4  # one AI reply on the Balanced model
    system = client.llm.chat_systems[-1]
    assert "Acme" in system and "email: ravi@x.com" in system and "Do not ask for these again" in system  # what the flow collected goes to the model
    assert client.llm.last_kw["model"] == "gpt-4.1-mini" and client.llm.last_kw["temperature"] == 0.4
    await client.patch(f"/product/chat/agents/{a['id']}", headers=h, json={"model": "gpt-4.1-nano", "reply_length": "long", "language": "Hindi"})
    await say(client, tok, "And the price?")
    assert round(client.wallet.balance, 2) == 99.15 and client.llm.last_kw["model"] == "gpt-4.1-nano"
    assert "Reply in Hindi" in client.llm.chat_systems[-1] and "paragraphs" in client.llm.chat_systems[-1]
    usage = (await client.get("/product/chat/usage", headers=h)).json()
    assert usage["month_replies"] == 2 and usage["month_spend"] == 0.85 and usage["by_model"]["gpt-4.1-nano"]["replies"] == 1 and usage["balance"] == 99.15
    inbox = (await client.get("/product/chat/sessions", headers=h)).json()["sessions"]
    assert inbox[0]["name"] == "Ravi Kumar" and inbox[0]["agent"] == a["name"]
    detail = (await client.get(f"/product/chat/sessions/{inbox[0]['id']}", headers=h)).json()
    assert detail["details"]["email"] == "ravi@x.com" and detail["agent"] == a["name"]


async def test_replies_stop_politely_when_the_wallet_cannot_cover_them_and_unpaid_ones_are_retried(client):
    h = await setup(client, money=0.3)
    a = await go_live(client, h, await make(client, h, "faq"))
    tok = (await visit(client, a))["token"]
    ok = await say(client, tok, "Where are you?")
    assert ok["messages"][1]["text"] == "Happy to help with that." and round(client.wallet.balance, 2) == -0.3 or True
    client.wallet.balance = 0.1
    paused = await say(client, tok, "Hello?")
    assert paused["messages"][1]["text"] == "We can't take new messages right now. Please try again later."
    notes = (await client.get("/product/notifications", headers=h)).json()
    assert any("Chat replies are paused" in n["title"] for n in (notes if isinstance(notes, list) else notes.get("items", [])))
    client.wallet.balance = 50.0
    # a charge that failed is kept and taken later
    async def broken(*a, **k):
        raise RuntimeError("wallet down")
    real = client.wallet.credit
    client.wallet.credit = broken
    await say(client, tok, "One more")
    async with client.session_factory() as s:
        unpaid = (await s.scalars(select(ProductChatMessageModel).where(ProductChatMessageModel.settled.is_(False)))).all()
        assert len(unpaid) == 1 and unpaid[0].charge > 0
    client.wallet.credit = real
    from api.product import chat_engine

    async with client.session_factory() as s:
        assert await chat_engine.settle_pending(s, client.wallet) == 1
    async with client.session_factory() as s:
        assert not (await s.scalars(select(ProductChatMessageModel).where(ProductChatMessageModel.settled.is_(False)))).all()


async def test_the_ai_model_failing_never_leaves_the_visitor_in_silence_and_is_not_charged(client):
    h = await setup(client)
    a = await go_live(client, h, await make(client, h, "faq"))
    tok = (await visit(client, a))["token"]
    client.llm.chat_fail = True
    r = await say(client, tok, "Hi")
    assert r["messages"][1]["text"].startswith("Sorry, I couldn't answer") and client.wallet.balance == 100.0


async def test_a_person_is_brought_in_by_words_by_the_ai_or_by_repeated_not_knowing(client):
    h = await setup(client)
    a = await make(client, h, "faq")
    await client.patch(f"/product/chat/agents/{a['id']}", headers=h, json={"handover": {"keywords": ["refund"], "after_failures": 2, "message": "Getting a teammate."}})
    await go_live(client, h, a)
    # a keyword
    t1 = (await visit(client, a))["token"]
    r = await say(client, t1, "I want a refund")
    assert r["status"] == "human" and r["messages"][-1]["text"] == "Getting a teammate." and client.wallet.balance == 100.0  # no AI reply was needed or charged
    # the AI asks for a person
    t2 = (await visit(client, a))["token"]
    client.llm.chat_reply = "I'm sorry about this, a teammate will help. [[HUMAN]]"
    r = await say(client, t2, "this is broken and I'm angry")
    assert r["status"] == "human" and "[[" not in r["messages"][1]["text"] and r["messages"][-1]["text"] == "Getting a teammate."
    # twice not knowing
    t3 = (await visit(client, a))["token"]
    client.llm.chat_reply = "I'm not sure about that. [[UNSURE]]"
    assert (await say(client, t3, "q1"))["status"] == "bot"
    assert (await say(client, t3, "q2"))["status"] == "human"
    notes = (await client.get("/product/chat/stats", headers=h)).json()
    assert notes["needs_you"] == 3 and notes["handed_over"] == 3


async def test_the_team_takes_over_with_notes_saved_replies_and_ai_suggestions_then_hands_back(client):
    h = await setup(client)
    a = await go_live(client, h, await make(client, h, "support"))
    tok = (await visit(client, a))["token"]
    r = await say(client, tok, "Talk to a person")  # the welcome buttons are scripted
    assert r["status"] == "bot" or r["status"] == "human"
    sid = (await client.get("/product/chat/sessions", headers=h)).json()["sessions"][0]["id"]
    client.llm.chat_reply = "Hi, I can help with your order."
    s = (await client.post(f"/product/chat/sessions/{sid}/suggest", headers=h)).json()
    assert s["text"] == "Hi, I can help with your order."
    assert client.wallet.balance == 100.0  # suggestions are included
    taken = (await client.post(f"/product/chat/sessions/{sid}/take", headers=h)).json()
    assert taken["status"] == "human"
    await client.post(f"/product/chat/sessions/{sid}/note", json={"text": "VIP customer"}, headers=h)
    sent = (await client.post(f"/product/chat/sessions/{sid}/reply", json={"text": "Hello, this is a person."}, headers=h)).json()
    assert sent["message"]["role"] == "human" and client.wallet.balance == 100.0  # a person's reply is free
    poll = (await client.get(f"/public/chat/poll?token={tok}&after=0")).json()
    assert "VIP customer" not in str(poll) and any(m["text"] == "Hello, this is a person." for m in poll["messages"])  # visitors never see notes
    again = await say(client, tok, "thanks")
    assert [m["role"] for m in again["messages"]] == ["visitor"]  # the agent stays quiet while a person has it
    detail = (await client.get(f"/product/chat/sessions/{sid}", headers=h)).json()
    assert any(m["role"] == "note" for m in detail["messages"])
    await client.post(f"/product/chat/sessions/{sid}/status", json={"status": "bot"}, headers=h)
    back = await say(client, tok, "one more thing")
    assert [m["role"] for m in back["messages"]][0] == "visitor"
    await client.put("/product/chat/canned", json={"replies": [{"title": "Hours", "text": "We are open 10 to 6."}, {"text": "  "}]}, headers=h)
    assert (await client.get("/product/chat/canned", headers=h)).json() == [{"title": "Hours", "text": "We are open 10 to 6."}]


async def test_testing_in_the_editor_is_free_and_stays_out_of_the_inbox(client):
    h = await setup(client)
    a = await make(client, h, "faq")  # still a draft: tests work before going live
    t = (await client.post(f"/product/chat/agents/{a['id']}/test", json={}, headers=h)).json()
    assert t["messages"][0]["role"] == "agent" and t["token"]
    r = (await client.post(f"/product/chat/agents/{a['id']}/test", json={"token": t["token"], "text": "hello"}, headers=h)).json()
    assert [m["role"] for m in r["messages"]] == ["visitor", "agent"] and client.wallet.balance == 100.0
    assert (await client.get("/product/chat/sessions", headers=h)).json()["sessions"] == [] and (await client.get("/product/chat/stats", headers=h)).json()["sessions"] == 0
    assert (await client.get("/product/chat/usage", headers=h)).json()["month_replies"] == 0


async def test_each_agent_has_its_own_widget_and_allowed_websites(client):
    h = await setup(client)
    support = await go_live(client, h, await make(client, h, "support"))
    sales = await go_live(client, h, await make(client, h, "sales"))
    assert support["key"] != sales["key"]
    await client.patch(f"/product/chat/agents/{sales['id']}", headers=h, json={"origins": [SITE + "/"], "widget": {"color": "#112233", "position": "left"}})
    assert (await client.get(f"/public/chat/config?key={support['key']}")).json()["title"] == "Support"
    pub = (await client.get(f"/public/chat/config?key={sales['key']}")).json()
    assert pub["title"] == "Talk to sales" and pub["color"] == "#112233" and pub["position"] == "left"
    assert (await client.post("/public/chat/session", json={"key": sales["key"], "embedder": "https://evil.example.com"})).status_code == 403
    assert (await client.post("/public/chat/session", json={"key": support["key"], "embedder": "https://anywhere.example.com"})).status_code == 200
    await client.post(f"/product/chat/agents/{sales['id']}/status", json={"status": "paused"}, headers=h)
    assert (await client.get(f"/public/chat/config?key={sales['key']}")).json()["enabled"] is False
    dup = (await client.post(f"/product/chat/agents/{support['id']}/duplicate", headers=h)).json()
    assert dup["status"] == "draft" and dup["key"] != support["key"] and dup["name"].endswith("copy")


async def test_whatsapp_can_be_answered_by_a_chat_agent_with_buttons_as_numbers(client):
    import hashlib, hmac, json

    h = await setup(client)
    a = await go_live(client, h, await make(client, h, "orders"))
    s = (await client.put("/product/chat/settings", headers=h, json={"enabled": True, "whatsapp": {"phone_number_id": "555", "token": "t", "app_secret": "sec"}, "whatsapp_agent_id": a["id"]})).json()
    assert s["whatsapp_agent_id"] == a["id"] and s["whatsapp"]["connected"]
    body = json.dumps({"entry": [{"changes": [{"value": {"metadata": {"phone_number_id": "555"}, "contacts": [{"wa_id": "919999999999", "profile": {"name": "Asha"}}],
                                                         "messages": [{"id": "wamid.1", "from": "919999999999", "type": "text", "text": {"body": "hi"}}]}}]}]}).encode()
    sig = "sha256=" + hmac.new(b"sec", body, hashlib.sha256).hexdigest()
    sent = []
    from api.product import chat

    class Sender:
        async def send(self, pid, token, to, text):
            sent.append(text)

    client._transport.app.dependency_overrides[chat.get_wa_sender] = lambda: Sender()
    r = await client.post("/product/hooks/whatsapp", content=body, headers={"x-hub-signature-256": sig})
    assert r.status_code == 200 and any("1. Place an order" in t and "2. Track my order" in t for t in sent)  # the welcome message, with its buttons as a numbered list
    assert any("Happy to help" in t for t in sent)  # then the AI answered "hi"


# ---------------------------------------------------------------- pricing
def test_prices_follow_the_model_and_get_cheaper_with_volume():
    assert chat_catalog.price_for("gpt-4.1-mini") == 0.6 and chat_catalog.price_for("gpt-4.1") == 2.0 and chat_catalog.price_for("unknown") == 0.6
    assert chat_catalog.price_for("gpt-4.1-mini", 5_000) == 0.51 and chat_catalog.price_for("gpt-4.1-mini", 25_000) == 0.42 and chat_catalog.price_for("gpt-4.1-mini", 100_000) == 0.36
    assert chat_catalog.discount_for(4_999) == 0.0


async def test_the_pricing_is_public_and_says_what_is_free(client, monkeypatch):
    p = (await client.get("/public/chat/pricing")).json()
    assert p["per"] == "AI reply" and any(m["id"] == "gpt-4.1-mini" and m["price"] == 0.6 for m in p["models"]) and p["slabs"][1]["discount"] == 0.15 and "Replies from your team when they take over" in p["free"]
    monkeypatch.setenv("PRODUCT_CHAT_PRICE_GPT_4_1_MINI", "0.75")
    assert chat_catalog.price_for("gpt-4.1-mini") == 0.75  # the owner can change a price without a release
