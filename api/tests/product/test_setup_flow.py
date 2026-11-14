"""The guided setup: reading a website, profile, what to suggest, voice and tools."""

import json
from types import SimpleNamespace as NS

import pytest
import pytest_asyncio

from api.product import setup_flow, site_reader
from api.product import voices as voice_catalogue
from api.product.setup_router import get_fetcher
from api.tests.product.support import bearer, make_client, signup

HOME = """<html><head><title>Sunrise Dental | Pune</title><meta name="description" content="Family dental care in Pune."></head>
<body><nav><a href="/about-us">About</a> <a href="/services/braces">Braces</a> <a href="/contact">Contact us</a> <a href="/blog/x">Blog</a>
<a href="https://other.example/about">Elsewhere</a> <a href="/brochure.pdf">Brochure</a> <a href="mailto:a@b.c">Mail</a></nav>
<script>var secret = 1</script><h1>Sunrise Dental</h1><p>Open Mon to Sat, 10 to 6.</p></body></html>"""
PAGES = {
    "https://sunrise.example/": HOME,
    "https://sunrise.example/about-us": "<html><title>About</title><body><p>We have served Pune since 2010.</p></body></html>",
    "https://sunrise.example/services/braces": "<html><title>Braces</title><body><p>Braces from 6 months.</p></body></html>",
    "https://sunrise.example/contact": "<html><title>Contact</title><body><p>Call 020 5550 1234.</p></body></html>",
}


def fetcher(pages=PAGES):
    async def fetch(url, **_):
        u = url if url.endswith("/") or url.count("/") > 2 else url + "/"
        body = pages.get(u) or pages.get(url)
        if body is None:
            raise ValueError("not found")
        return NS(final_url=url, content_type="text/html", body=body.encode())

    return fetch


@pytest.mark.asyncio
async def test_the_reader_takes_the_home_page_and_the_pages_that_describe_the_business():
    pages = await site_reader.read_site("sunrise.example", fetcher())
    urls = [p.url for p in pages]
    assert urls[0].startswith("https://sunrise.example") and len(pages) == 4
    assert "https://other.example/about" not in urls and not any(u.endswith(".pdf") or "/blog" in u for u in urls)  # other sites, files and unrelated pages are left out
    assert "secret" not in pages[0].text and "Open Mon to Sat" in pages[0].text and pages[0].title == "Sunrise Dental | Pune"


@pytest.mark.asyncio
async def test_an_unreadable_site_says_so_in_plain_words():
    async def broken(url, **_):
        raise ValueError("down")

    with pytest.raises(ValueError, match="couldn't read that website"):
        await site_reader.read_site("https://nowhere.example", broken)


def test_the_profile_keeps_only_valid_values():
    p = setup_flow.clean_profile({"business": " Sunrise  Dental ", "industry": "Space", "languages": ["English", "Klingon", "Hindi", "Tamil"], "faqs": [{"q": "", "a": "x"}, {"q": "Open?", "a": "Yes"}],
                                  "suggested": [{"key": "dental", "why": "w"}, {"key": "dental", "why": "again"}, {"key": "nope"}], "phone": "null"}, {"industry": "General"})
    assert p["business"] == "Sunrise Dental" and p["industry"] == "General" and p["languages"] == ["English", "Hindi"]
    assert p["faqs"] == [{"q": "Open?", "a": "Yes"}] and [s["key"] for s in p["suggested"]] == ["dental"] and p["phone"] is None


def test_suggestions_skip_what_the_workspace_already_has():
    have = [{"role": "book, move and cancel appointments"}, {"role": "answer calls, answer common questions and take messages"}]
    rec = [r["key"] for r in setup_flow.recommended(have)]
    assert "appointments" not in rec and "receptionist" not in rec and rec and len(rec) <= 4
    health = [r["key"] for r in setup_flow.recommended([], "Healthcare")]
    assert health[:4] == ["clinic", "dental", "pharmacy", "diagnostics"]  # the industry's own agents come first
    assert "appointments" not in [r["key"] for r in setup_flow.recommended([{"role": "book dental visits"}])]  # a differently worded job still counts


def _v(engine, name, language, **tts):
    return NS(id=f"{engine}-{name}", name=name, language=language, engine=engine, tts=tts)


def test_an_indian_language_prefers_falcon_then_swarvo_and_english_prefers_studio():
    cat = [_v("inworld", "Sarah", "English (US)"), _v("murf", "Aarav", "Hindi", locales=["hi-IN", "en-IN"]), _v("murf", "Debarati", "Bengali", locales=["bn-IN"]),
           _v("swarvo", "Ritvik", "Hindi"), _v("google", "Puck", "Multilingual")]
    everyone = lambda v: True  # noqa: E731
    hi = setup_flow.pick_voice(cat, everyone, ["Hindi"])
    assert hi["name"] == "Aarav" and {a["name"] for a in hi["alternatives"]} >= {"Ritvik"}
    assert setup_flow.pick_voice(cat, everyone, ["Bengali"])["name"] == "Debarati"
    assert setup_flow.pick_voice(cat, everyone, ["English"])["name"] == "Sarah"
    assert setup_flow.pick_voice(cat, lambda v: v.engine == "swarvo", ["Hindi"])["name"] == "Ritvik"  # only what this person can use
    assert setup_flow.pick_voice(cat, lambda v: False, ["Hindi"]) is None
    assert setup_flow.pick_voice(cat, everyone, ["Tamil"])["name"] == "Puck"  # nothing Tamil: the many-language voice


def test_tools_follow_the_job_and_show_what_is_connected():
    t = setup_flow.tool_suggestions("appointments", {"google_calendar"})
    assert [(x["key"], x["connected"]) for x in t] == [("google_calendar", True), ("calendly", False)]
    assert [x["key"] for x in setup_flow.tool_suggestions("orders", set())] == ["shopify", "razorpay_links", "whatsapp"]
    assert setup_flow.tool_suggestions("something odd", set())[0]["key"] == "google_sheets"


# ---------- through the API ----------
@pytest_asyncio.fixture
async def client(monkeypatch):
    async with make_client(monkeypatch) as c:
        c._transport.app.dependency_overrides[get_fetcher] = lambda: fetcher()
        yield c


@pytest.mark.asyncio
async def test_state_knows_the_website_and_suggests_agents_for_a_workspace_that_has_one(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    empty = (await client.get("/product/assistant/setup/state", headers=h)).json()
    assert empty["website"] is None and empty["agents"] == [] and len(empty["recommended"]) == 4
    await client.post("/product/agents", json={"name": "A", "template": "appointments"}, headers=h)
    await client.post("/product/knowledge/url", json={"url": "https://sunrise.example"}, headers=h)
    s = (await client.get("/product/assistant/setup/state", headers=h)).json()
    assert s["website"] == "https://sunrise.example" and len(s["agents"]) == 1
    assert "appointments" not in [r["key"] for r in s["recommended"]]


@pytest.mark.asyncio
async def test_research_reads_the_site_and_returns_a_clean_profile(client):
    _, tok = await signup(client, "a@x.com")
    r = await client.post("/product/assistant/setup/research", json={"url": "sunrise.example"}, headers=bearer(tok))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["by_ai"] is True and len(d["pages"]) == 4 and d["url"].startswith("https://sunrise.example")
    p = d["profile"]
    assert p["business"] == "Sunrise Dental" and p["languages"] == ["English", "Hindi"] and [s["key"] for s in p["suggested"]] == ["dental"] and len(p["faqs"]) == 1
    assert "Questions callers ask" in d["text"] and "Do you take walk-ins?" in d["text"]


@pytest.mark.asyncio
async def test_research_falls_back_to_the_page_text_when_the_ai_is_down(client):
    _, tok = await signup(client, "a@x.com")
    client.llm.profile = "not json"
    d = (await client.post("/product/assistant/setup/research", json={"url": "sunrise.example"}, headers=bearer(tok))).json()
    assert d["by_ai"] is False and d["profile"]["business"] == "Sunrise Dental" and "dental" in d["profile"]["summary"].lower()


@pytest.mark.asyncio
async def test_research_needs_a_site_or_a_description_and_works_from_a_description(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    assert (await client.post("/product/assistant/setup/research", json={}, headers=h)).json()["detail"]["code"] == "need_something"
    nothing = {"url": "https://down.example"}

    async def broken(url, **_):
        raise ValueError("down")

    client._transport.app.dependency_overrides[get_fetcher] = lambda: broken
    assert (await client.post("/product/assistant/setup/research", json=nothing, headers=h)).json()["detail"]["code"] == "site_unreadable"
    ok = await client.post("/product/assistant/setup/research", json={**nothing, "notes": "We run a dental clinic in Pune and want to take bookings."}, headers=h)
    assert ok.status_code == 200 and ok.json()["pages"] == []


@pytest.mark.asyncio
async def test_the_plan_has_an_agent_a_voice_tools_and_knowledge(client, monkeypatch):
    monkeypatch.setenv("PRODUCT_VOICE_ENGINES", "swarvo,murf")
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    profile = (await client.post("/product/assistant/setup/research", json={"url": "sunrise.example"}, headers=h)).json()["profile"]
    r = await client.post("/product/assistant/setup/plan", json={"usecase": "appointments", "languages": ["Hindi", "English"], "profile": profile, "website": "https://sunrise.example"}, headers=h)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["agent"]["generated"] is True and d["agent"]["business"] == "Sunrise Dental" and d["agent"]["script"]
    assert d["languages"] == ["Hindi", "English"] and d["knowledge"] == {"website": "https://sunrise.example", "faqs": 1, "has_profile": True}
    assert [t["key"] for t in d["tools"]] == ["google_calendar", "calendly"] and all(t["connected"] is False for t in d["tools"])
    assert d["voice"] is None  # no voice engine has a profile in this test workspace, so nothing is offered rather than something that would not work
    assert voice_catalogue.catalogue()  # (the catalogue itself is not empty)


# ---------- autopilot: one message builds everything ----------
from api.product import setup_auto  # noqa: E402


def test_one_message_is_split_into_a_website_and_what_the_person_wants():
    url, rest = setup_auto.split_input("We are Sunrise Dental, sunrise.example. Book check-ups in Hindi.")
    assert url == "sunrise.example" and "Book check-ups in Hindi" in rest and "sunrise" not in rest
    assert setup_auto.split_input("https://www.shop.example.in/store, sell shoes")[0] == "https://www.shop.example.in/store"
    assert setup_auto.split_input("just a description of my business")[0] == ""


def test_the_job_comes_from_their_words_then_from_the_website_then_a_receptionist():
    profile = {"suggested": [{"key": "dental"}]}
    assert setup_auto.pick_usecase("I want it to take orders for delivery", profile) == ("orders", "")
    assert setup_auto.pick_usecase("book appointments for my dentist", profile)[0] == "dental"
    assert setup_auto.pick_usecase("www.sunrise.example", profile) == ("dental", "")  # only a website: what the site suggests
    assert setup_auto.pick_usecase("", {}) == ("receptionist", "")
    assert setup_auto.pick_usecase("greet visitors and sell tickets to our museum", {}) == ("custom", "greet visitors and sell tickets to our museum")
    assert setup_auto.languages_in("answer in tamil and english please", ["Hindi"]) == ["Tamil", "English"]  # in the order they were said
    assert setup_auto.languages_in("no language mentioned", ["Hindi", "English"]) == ["Hindi", "English"]


async def _number(client, org_id, address="+919800000001"):
    from api.db import models

    async with client.session_factory() as s:
        cfg = models.TelephonyConfigurationModel(organization_id=org_id, name="c", provider="twilio", credentials={})
        s.add(cfg)
        await s.flush()
        s.add(models.TelephonyPhoneNumberModel(organization_id=org_id, telephony_configuration_id=cfg.id, address=address, address_normalized=address.lstrip("+"), address_type="PSTN", country_code="IN", is_active=True))
        await s.commit()


@pytest.mark.asyncio
async def test_autopilot_builds_and_publishes_an_agent_and_connects_the_free_number(client):
    from sqlalchemy import select

    from api.db import models, product_models

    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    async with client.session_factory() as s:
        ws = (await s.execute(select(product_models.ProductWorkspaceModel))).scalars().first()
    await _number(client, ws.live_org_id)
    r = await client.post("/product/assistant/setup/auto", json={"text": "We are Sunrise Dental, sunrise.example. Book appointments in Hindi and English."}, headers=h)
    assert r.status_code == 200, r.text
    d = r.json()
    steps = {x["id"]: x for x in d["steps"]}
    assert all(steps[k]["status"] == "ok" for k in ("read", "kb_site", "kb_text", "agent", "voice", "attach", "live", "number")), d["steps"]
    assert d["agent"]["status"] == "live" and d["agent"]["number"] == "+919800000001" and d["agent"]["languages"] == ["Hindi", "English"] and d["business"] == "Sunrise Dental"
    a = (await client.get(f"/product/agents/{d['agent']['id']}", headers=h)).json()
    assert a["status"] == "live" and a["style"]["languages"] == ["Hindi", "English"] and a["script"]
    kinds = sorted(x["kind"] for x in (await client.get("/product/knowledge", headers=h)).json())
    assert kinds == ["Q&A", "Text", "Website"]
    assert len((await client.get(f"/product/knowledge/agent/{d['agent']['id']}", headers=h)).json()) == 3
    async with client.session_factory() as s:
        row = (await s.execute(select(models.TelephonyPhoneNumberModel))).scalars().first()
        agent = (await s.execute(select(product_models.ProductAgentModel))).scalar_one()
        assert row.inbound_workflow_id == agent.live_workflow_id


@pytest.mark.asyncio
async def test_autopilot_still_makes_the_agent_when_there_is_no_site_number_or_ai(client):
    _, tok = await signup(client, "a@x.com")
    h = bearer(tok)
    client.llm.profile = "not json"
    client.llm.draft = "not json"
    r = await client.post("/product/assistant/setup/auto", json={"text": "We run a small tailoring shop in Pune and want to answer calls about orders."}, headers=h)
    assert r.status_code == 200, r.text
    d = r.json()
    ids = {x["id"]: x["status"] for x in d["steps"]}
    assert ids["agent"] == "ok" and ids["number"] == "skip" and d["generated"] is False  # no number to connect: said so, nothing else stopped
    assert (await client.post("/product/assistant/setup/auto", json={"text": "hi"}, headers=h)).json()["detail"]["code"] == "need_something"
    assert (await client.post("/product/assistant/setup/auto", json={"text": "a" * 20, "usecase": "survey"}, headers=h)).status_code == 200  # a picked suggestion
