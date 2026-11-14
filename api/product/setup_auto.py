"""Autopilot: from a website and/or a few words, build the whole agent without asking anything else.

Reads the site, writes the agent, adds the knowledge, picks the voice, puts the agent live and connects a free phone number. Each step is
reported separately, and a step that fails never stops the others (only creating the agent itself is essential).
"""

from __future__ import annotations

import re

from sqlalchemy import select

from api.db.models import TelephonyPhoneNumberModel
from api.product import agent_writer, setup_flow, site_reader
from api.product import agents as agent_svc
from api.product.errors import product_error
from api.product.style import LANGUAGES
from api.product.templates import BY_KEY

# Words that say what job the person wants, most specific first.
JOB_WORDS: list[tuple[str, tuple[str, ...]]] = [
    ("dental", ("dental", "dentist")), ("clinic", ("clinic", "doctor", "patient", "hospital")), ("salon", ("salon", "spa", "beauty", "haircut")),
    ("restaurant", ("restaurant", "table booking", "reservation", "cafe")), ("realestate", ("real estate", "property", "properties", "site visit")),
    ("hotel", ("hotel", "room booking", "resort")), ("coaching", ("coaching", "admission", "course", "tuition", "institute")),
    ("reminders", ("reminder", "payment", "collection", "overdue", "emi")), ("orderstatus", ("order status", "track", "return")),
    ("orders", ("take order", "orders", "ordering", "delivery order")), ("leads", ("lead", "qualify", "sales call", "prospect")),
    ("appointments", ("appointment", "book", "schedule", "booking")), ("support", ("support", "help desk", "complaint", "customer care")),
    ("survey", ("survey", "feedback")), ("receptionist", ("receptionist", "reception", "front desk", "answer calls", "pick up")),
]


def pick_usecase(text: str, profile: dict) -> tuple[str, str]:
    """(template key or "custom", the person's own words when none fits). Falls back to what the website suggests, then a receptionist."""
    t = (text or "").lower()
    for key, words in JOB_WORDS:
        if any(w in t for w in words):
            return key, ""
    if len(t.strip()) >= 12 and not _only_site(t):
        return "custom", text.strip()
    for s in profile.get("suggested") or []:
        if s.get("key") in BY_KEY:
            return s["key"], ""
    return "receptionist", ""


def _only_site(t: str) -> bool:
    return not re.sub(r"https?://\S+|\bwww\.\S+|\b\S+\.(com|in|co|net|org|io|ai)\b\S*", "", t).strip(" ,.;:-")


def languages_in(text: str, fallback: list[str]) -> list[str]:
    hits = sorted((m.start(), n) for n in LANGUAGES for m in [re.search(rf"\b{n}\b", text or "", re.I)] if m)  # in the order they were said
    return ([n for _, n in hits] or fallback or ["English"])[:2]


def split_input(text: str) -> tuple[str, str]:
    """(website address, the rest of the words) from one free-form message."""
    m = re.search(r"(?<![\w@.])((?:https?://)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,24}(?:/[^\s]*)?)(?![\w@])", text or "", re.I)
    if not m:
        return "", (text or "").strip()
    url = m.group(1).rstrip(".,;)")
    return url, ((text or "")[: m.start()] + " " + (text or "")[m.end():]).strip()


def _norm(u: str | None) -> str:
    return re.sub(r"^https?://(www\.)?", "", (u or "").strip().lower()).rstrip("/")


class Steps(list):
    def add(self, id: str, label: str, status: str = "ok", note: str | None = None):
        self.append({"id": id, "label": label, "status": status, "note": note})


async def run(ctx, *, kb, gw, llm, fetch, tools, url: str, text: str, publish: bool = True, usecase: str = "") -> dict:
    """Build the agent. ``url`` and ``text`` come from one message (see split_input). Raises only when the agent itself cannot be made."""
    from api.product import knowledge_router as kr

    steps = Steps()
    org, uid = ctx.workspace.test_org_id, ctx.user.id
    docs = await kb.list(org, uid)
    known = [d for d in docs if kr.kind_of(d) == "Website" and kr.status_of(d) != "failed"]
    site_url = site_reader.normalise(url) if url else (known[0].get("source_url") if known else "")

    # 1. learn about the business
    pages: list[site_reader.Page] = []
    if site_url:
        try:
            pages = await site_reader.read_site(site_url, fetch)
            steps.add("read", f"Read {len(pages)} {'page' if len(pages) == 1 else 'pages'} of {_norm(pages[0].url)}")
        except ValueError as e:
            steps.add("read", "Read your website", "fail", str(e))
    if not pages and len((text or "").strip()) < 15:
        raise product_error(400, "need_something", "Tell me your website, or a few words about your business and what the agent should do.")
    profile, by_ai = await setup_flow.build_profile(llm, org, uid, pages, text)
    if not profile["business"]:
        profile["business"] = ctx.workspace.name
    if not pages and not site_url:
        steps.add("read", "Learned about your business from what you wrote")

    # 2. decide the job and the languages, then write the agent
    picked, wishes = pick_usecase(text, profile)
    usecase = usecase if usecase in BY_KEY else picked
    wishes = "" if usecase in BY_KEY else wishes
    langs = languages_in(text, profile["languages"])
    notes = "\n\n".join(x for x in (setup_flow.profile_text(profile, pages[0].url if pages else site_url or None), wishes) if x)
    draft, generated = await agent_writer.write_agent(llm, org, uid, usecase=wishes or usecase, description=notes, industry=profile["industry"] if profile["industry"] != "General" else "", language=langs[0])
    draft["business"] = (profile["business"] or draft["business"])[:60]

    # 3. knowledge
    doc_names: list[str] = []
    if site_url and pages and not any(_norm(d.get("source_url")) == _norm(pages[0].url) or _norm(d.get("source_url")) == _norm(site_url) for d in known):
        try:
            await kr._both(ctx, kb, lambda o: kb.add_url(o, uid, pages[0].url, 24))
            steps.add("kb_site", f"Added {_norm(pages[0].url)} to knowledge")
        except Exception as e:  # noqa: BLE001
            steps.add("kb_site", "Add your website to knowledge", "fail", getattr(e, "detail", {}).get("message") if isinstance(getattr(e, "detail", None), dict) else "Could not add it")
    existing = {d["filename"].lower() for d in docs}
    biz = kr._clean_name(profile["business"] or "Business")
    for title, body in ((f"{biz} profile", setup_flow.profile_text(profile, pages[0].url if pages else site_url or None)), ):
        name = f"{title}.txt"
        if body and name.lower() not in existing:
            try:
                await kr._both(ctx, kb, lambda o, n=name, b=body: kb.add_text(o, uid, n, b))
                doc_names.append(name)
            except Exception:  # noqa: BLE001
                pass
    if profile["faqs"]:
        name = f"QA - {biz} questions.txt"
        if name.lower() not in existing:
            qa = "\n\n".join(f"Question: {f['q']}\nAnswer: {f['a']}" for f in profile["faqs"])
            try:
                await kr._both(ctx, kb, lambda o: kb.add_text(o, uid, name, qa))
                doc_names.append(name)
            except Exception:  # noqa: BLE001
                pass
    if doc_names:
        steps.add("kb_text", f"Added what it learned about {profile['business'] or 'your business'}" + (f" and {len(profile['faqs'])} common questions" if profile["faqs"] else ""))

    # 4. the agent, its voice and languages
    template = usecase if usecase in BY_KEY else None
    agent = await agent_svc.create_agent(ctx.session, gw, ctx.workspace, uid, name=draft["name"], template=template, role=draft["role"], business=draft["business"],
                                         what_you_do=draft["what_you_do"], tone=draft["tone"], script=draft["script"], emoji=draft["emoji"])
    await ctx.session.commit()
    steps.add("agent", f"Created {agent.name}, {draft['role']}")
    cat, usable = await setup_flow.usable_voices(ctx.session, ctx.user.email)
    voice = setup_flow.pick_voice(cat, usable, langs)
    changes: dict = {"style": {"languages": langs}}
    if voice:
        changes["voice_id"] = voice["id"]
    try:
        await agent_svc.update_agent(ctx.session, gw, ctx.workspace, agent, changes, None, ctx.user.email)
        await ctx.session.commit()
        steps.add("voice", f"Chose the {voice['name']} voice ({voice['language']}) and set it to speak {' and '.join(langs)}" if voice else f"Set it to speak {' and '.join(langs)}")
    except Exception as e:  # noqa: BLE001
        steps.add("voice", "Choose a voice", "fail", getattr(e, "detail", {}).get("message") if isinstance(getattr(e, "detail", None), dict) else "Pick one on the Voice tab")

    # 5. teach it
    try:
        now = await kb.list(org, uid)
        ids = [kr.encode_id("doc", d["id"]) for d in now if kr.kind_of(d) == "Website" or d["filename"] in doc_names]
        if ids:
            await kr.attach(agent.public_id, kr.AttachBody(document_ids=ids), ctx, kb, gw)
            steps.add("attach", "Taught the agent from that knowledge")
    except Exception:  # noqa: BLE001
        steps.add("attach", "Teach the agent from your knowledge", "fail", "Attach it on the agent's Knowledge tab")

    # 6. live, and a phone number
    went_live, number = False, None
    if publish:
        try:
            agent = await agent_svc.get_agent(ctx.session, ctx.workspace, agent.public_id)
            await agent_svc.go_live(ctx.session, gw, ctx.workspace, uid, agent, kb, tools)
            await ctx.session.commit()
            went_live = True
            steps.add("live", f"{agent.name} is live")
        except Exception as e:  # noqa: BLE001
            msg = getattr(e, "detail", {}).get("message") if isinstance(getattr(e, "detail", None), dict) else None
            steps.add("live", "Put it live", "skip", msg or "It is saved as a draft. Open it to finish going live.")
    if went_live:
        row = await ctx.session.scalar(select(TelephonyPhoneNumberModel).where(
            TelephonyPhoneNumberModel.organization_id == ctx.workspace.live_org_id, TelephonyPhoneNumberModel.is_active.is_(True), TelephonyPhoneNumberModel.inbound_workflow_id.is_(None)).order_by(TelephonyPhoneNumberModel.id).limit(1))
        if row is not None:
            agent = await agent_svc.get_agent(ctx.session, ctx.workspace, agent.public_id)
            row.inbound_workflow_id = agent.live_workflow_id
            await ctx.session.commit()
            number = row.address
            steps.add("number", f"Connected {row.address} so callers reach it")
        else:
            steps.add("number", "Connect a phone number", "skip", "You have no free number yet. Get one on the Phone Numbers page and the agent will answer it.")

    return {
        "agent": {"id": agent.public_id, "name": agent.name, "role": draft["role"], "status": agent.status, "voice": voice["name"] if voice else None, "languages": langs, "number": number},
        "steps": list(steps), "business": profile["business"], "generated": generated and by_ai,
        "tools": setup_flow.tool_suggestions(usecase if usecase in BY_KEY else "custom", set()),
    }
