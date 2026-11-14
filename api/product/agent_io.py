"""Moving a whole agent in and out as one JSON file: its settings, personality, voice choice and call flow.

A file made by Export can be uploaded to any workspace to get the same agent back as a new draft. Plain call-flow JSON (nodes and edges) and flows
exported from the platform's own editor are accepted too. Anything that points at another account's things (tools, documents, recordings, credentials,
trigger links) is stripped on the way in, so an uploaded file can never reach into somebody else's data.
"""

from __future__ import annotations

import json
from copy import deepcopy

from api.product import agents as agent_svc
from api.product import prompt as prompts
from api.product import style as style_mod
from api.product import voices as voice_catalogue
from api.product.errors import product_error

FORMAT = "swarvo-agent"
VERSION = 1
MAX_BYTES = 1_000_000
# Keys inside a flow that refer to things owned by an account. They mean nothing (or something dangerous) in another workspace.
PRIVATE_KEYS = {"tool_uuids", "document_uuids", "recording_ids", "recordings", "credential_uuid", "credential_id", "trigger_path", "api_key", "token", "secret"}


def export_document(agent, graph: dict) -> dict:
    voice = voice_catalogue.find(agent.voice_id) if agent.voice_id else None
    return {
        "format": FORMAT, "version": VERSION,
        "agent": {
            "name": agent.name, "emoji": agent.emoji, "color": agent.color, "role": agent.role, "tone": agent.tone, "business": agent.business,
            "what_you_do": agent.what_you_do, "script": agent.script or "", "brain": agent.brain, "style": agent.style or {}, "prompt_mode": agent.prompt_mode,
            "voice": {"name": voice.name, "provider": voice.provider, "engine": voice.engine} if voice else None,
        },
        "flow": scrub(graph or {"nodes": [], "edges": []}),
    }


def scrub(value):
    """A copy without anything that belongs to an account."""
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if k in PRIVATE_KEYS:
                out[k] = [] if isinstance(v, list) else None
            else:
                out[k] = scrub(v)
        return out
    if isinstance(value, list):
        return [scrub(v) for v in value]
    return value


def _text(v, n: int) -> str:
    return str(v or "").strip()[:n]


def parse(doc) -> dict:
    """Understand an uploaded file. Returns {fields, flow, voice, notes}. Raises a friendly error for anything unusable."""
    if not isinstance(doc, dict):
        raise product_error(400, "bad_file", "That file isn't an agent. Upload a JSON file made with Export.")
    if len(json.dumps(doc, default=str)) > MAX_BYTES:
        raise product_error(400, "file_too_big", "That file is too big. Agent files can be up to 1 MB.")
    notes: list[str] = []
    meta: dict = {}
    flow = None
    if doc.get("format") == FORMAT:
        if int(doc.get("version") or 0) > VERSION:
            raise product_error(400, "newer_file", "That file was made by a newer version. Update the app and try again.")
        meta, flow = dict(doc.get("agent") or {}), doc.get("flow")
    else:
        for key in ("workflow_definition", "definition", "flow", "workflow"):  # an export from the platform editor, or a bare flow
            inner = doc.get(key)
            if isinstance(inner, dict) and isinstance(inner.get("nodes"), list):
                flow, meta = inner, {"name": doc.get("name")}
                break
        if flow is None and isinstance(doc.get("nodes"), list):
            flow, meta = doc, {"name": doc.get("name")}
    if flow is None or not isinstance(flow.get("nodes"), list):
        raise product_error(400, "bad_file", "I couldn't find an agent or a call flow in that file.")
    flow = scrub(flow)
    flow.setdefault("edges", [])
    flow.pop("viewport", None) if not isinstance(flow.get("viewport"), dict) else None
    fields = {
        "name": _text(meta.get("name"), 120) or "Imported agent", "role": _text(meta.get("role"), 120) or None, "business": _text(meta.get("business"), 160),
        "what_you_do": _text(meta.get("what_you_do"), 2000), "script": _text(meta.get("script"), 8000), "emoji": _text(meta.get("emoji"), 16) or None,
        "tone": meta.get("tone") if meta.get("tone") in prompts.TONES else None,
    }
    style = {}
    if isinstance(meta.get("style"), dict):
        try:
            style = style_mod.clean(meta["style"])
        except ValueError as e:
            notes.append(f"Some voice settings in the file were not valid and were left out ({e}).")
    brain = meta.get("brain") if meta.get("brain") in agent_svc.BRAINS else None
    return {"fields": fields, "flow": flow, "style": style, "brain": brain, "voice": meta.get("voice") if isinstance(meta.get("voice"), dict) else None,
            "prompt_mode": meta.get("prompt_mode"), "notes": notes}


async def import_agent(ctx, gw, doc, name: str | None = None):
    """Create a new draft agent from a file. Returns (agent, notes)."""
    p = parse(doc)
    f = p["fields"]
    notes = list(p["notes"])
    agent = await agent_svc.create_agent(ctx.session, gw, ctx.workspace, ctx.user.id, name=(name or f["name"]).strip() or "Imported agent", template=None, role=f["role"],
                                         business=f["business"], what_you_do=f["what_you_do"], script=f["script"], tone=f["tone"], emoji=f["emoji"])
    # The file's own call flow replaces the starter one. Its main instructions are kept as written.
    await agent_svc.save_flow(ctx.session, gw, ctx.workspace, agent, deepcopy(p["flow"]), None)
    changes: dict = {}
    if p["brain"]:
        changes["brain"] = p["brain"]
    if p["style"]:
        changes["style"] = p["style"]
    v = p["voice"]
    if v and v.get("name"):
        match = next((x for x in voice_catalogue.catalogue() if x.name == v["name"] and (not v.get("engine") or x.engine == v["engine"]) and voice_catalogue.can_use(x, ctx.user.email)), None)
        if match is not None:
            changes["voice_id"] = match.id
        else:
            notes.append(f"The voice {v['name']} isn't available here, so the agent uses the default voice. Pick one on its Voice tab.")
    if changes:
        try:
            await agent_svc.update_agent(ctx.session, gw, ctx.workspace, agent, changes, None, ctx.user.email)
        except Exception as e:  # noqa: BLE001 - the agent exists; say what could not be applied
            msg = getattr(e, "detail", {}).get("message") if isinstance(getattr(e, "detail", None), dict) else "a setting could not be applied"
            notes.append(f"Some settings from the file were not applied: {msg}")
    await ctx.session.flush()
    return agent, notes
