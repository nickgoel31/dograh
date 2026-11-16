"""The simple flow of a chat agent: a short list of steps anyone can edit, with no canvas.

Step types
  message  say something (free)
  ask      ask a question and keep the answer under a name, such as name, email or phone
  choice   offer buttons; each button goes to another step, to the AI, to a person, or ends the chat
  ai       from here the AI answers in its own words (this is the only part that is charged per reply)
  human    hand the chat to a person on the team
  end      say goodbye and finish

Scripted steps never cost anything. The flow runs until it needs an answer, then waits; once it reaches an ``ai`` step every later message goes to the AI.
"""

from __future__ import annotations

import re

STEP_TYPES = ("message", "ask", "choice", "ai", "human", "end")
KINDS = ("text", "email", "phone")
MAX_STEPS, MAX_OPTIONS, MAX_HOPS = 30, 6, 40
TARGETS = ("ai", "human", "end")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")
PHONE = re.compile(r"^\+?[0-9][0-9\s\-()]{6,17}$")
DEFAULT_FLOW = {"steps": [{"id": "talk", "type": "ai", "text": ""}]}


def _text(v, n: int) -> str:
    return re.sub(r"[ \t]+", " ", str(v or "")).strip()[:n]


def _slug(v, taken: set[str], i: int) -> str:
    s = re.sub(r"[^a-z0-9_]", "", str(v or "").lower())[:24] or f"s{i + 1}"
    while s in taken or s in TARGETS:
        s = f"{s}{len(taken)}"[:24]
    return s


def clean_flow(raw: dict | None) -> dict:
    """Keep only valid steps and fix every pointer, so a half-edited flow can never break a chat."""
    steps_in = (raw or {}).get("steps") if isinstance(raw, dict) else None
    if not isinstance(steps_in, list) or not steps_in:
        return {"steps": [dict(s) for s in DEFAULT_FLOW["steps"]]}
    out, taken = [], set()
    for i, s in enumerate(steps_in[:MAX_STEPS]):
        if not isinstance(s, dict) or s.get("type") not in STEP_TYPES:
            continue
        sid = _slug(s.get("id"), taken, i)
        taken.add(sid)
        step = {"id": sid, "type": s["type"], "text": _text(s.get("text"), 600)}
        if s["type"] == "ask":
            step["save_as"] = re.sub(r"[^a-z0-9_]", "", str(s.get("save_as") or "answer").lower())[:20] or "answer"
            step["kind"] = s.get("kind") if s.get("kind") in KINDS else "text"
        if s["type"] == "choice":
            step["options"] = [{"label": _text(o.get("label"), 40), "goto": o.get("goto")} for o in (s.get("options") or [])[:MAX_OPTIONS] if isinstance(o, dict) and _text(o.get("label"), 40)]
        if s.get("next"):
            step["next"] = str(s["next"])
        out.append(step)
    if not out:
        return {"steps": [dict(s) for s in DEFAULT_FLOW["steps"]]}
    ids = {s["id"] for s in out}
    for s in out:
        if s.get("next") and s["next"] not in ids and s["next"] not in TARGETS:
            del s["next"]
        for o in s.get("options", []):
            if o["goto"] not in ids and o["goto"] not in TARGETS:
                o["goto"] = "ai"
        if s["type"] == "choice" and not s["options"]:
            s["type"] = "message"
            s.pop("options")
    return {"steps": out}


def has_ai(flow: dict) -> bool:
    return any(s["type"] == "ai" for s in flow["steps"]) or any(o["goto"] == "ai" for s in flow["steps"] for o in s.get("options", []))


def _fill(text: str, vars_: dict) -> str:
    """Put what the visitor already told us into the text: {name}, {first_name}, {email}, or any name an ask step saved."""

    def one(m: re.Match) -> str:
        key = m.group(1)
        if vars_.get(key):
            return str(vars_[key])
        return "there" if key in ("name", "first_name") else m.group(0)

    return re.sub(r"\{(\w+)\}", one, text)


def _find(flow: dict, sid: str | None):
    return next((s for s in flow["steps"] if s["id"] == sid), None)


def _after(flow: dict, step: dict) -> str:
    if step.get("next"):
        return step["next"]
    ids = [s["id"] for s in flow["steps"]]
    i = ids.index(step["id"])
    return ids[i + 1] if i + 1 < len(ids) else "ai"


class Turn:
    """What one visitor message did to the flow."""

    def __init__(self, state: dict):
        self.state = state
        self.say: list[dict] = []  # {"text": ..., "options": [...]} messages to show
        self.ai = False  # the AI should answer the visitor's message now
        self.human = False  # a person should take over


def start(flow: dict, vars_: dict | None = None) -> Turn:
    t = Turn({"step": None, "vars": dict(vars_ or {}), "ai": False, "done": False})
    _run(flow, t, flow["steps"][0]["id"])
    return t


def answer(flow: dict, state: dict, text: str) -> Turn:
    """The visitor wrote something. Continue the flow, or tell the caller the AI (or a person) should reply."""
    t = Turn({"step": state.get("step"), "vars": dict(state.get("vars") or {}), "ai": bool(state.get("ai")), "done": bool(state.get("done"))})
    if t.state["ai"] or t.state["done"] or not t.state["step"]:
        t.ai = True
        t.state["ai"] = True
        return t
    step = _find(flow, t.state["step"])
    if step is None:
        t.ai, t.state["ai"] = True, True
        return t
    text = (text or "").strip()
    if step["type"] == "ask":
        if step.get("kind") == "email" and not EMAIL.match(text):
            t.say.append({"text": "That doesn't look like an email address. Could you check it?"})
            return t
        if step.get("kind") == "phone" and not PHONE.match(text):
            t.say.append({"text": "That doesn't look like a phone number. Could you check it?"})
            return t
        t.state["vars"][step["save_as"]] = text[:200]
        if step["save_as"] == "name":
            t.state["vars"]["first_name"] = text.split()[0][:40] if text.split() else text
        _run(flow, t, _after(flow, step))
        return t
    if step["type"] == "choice":
        low = text.lower()
        pick = next((o for o in step["options"] if o["label"].lower() == low), None)
        if pick is None and low.isdigit() and 1 <= int(low) <= len(step["options"]):
            pick = step["options"][int(low) - 1]
        if pick is None:  # they typed something else: let the AI answer if the flow has one, otherwise show the buttons again
            if has_ai(flow):
                t.ai, t.state["ai"] = True, True
            else:
                t.say.append({"text": step["text"] or "Please pick one:", "options": [o["label"] for o in step["options"]]})
            return t
        t.state["vars"][step["id"]] = pick["label"]
        _run(flow, t, pick["goto"])
        return t
    t.ai, t.state["ai"] = True, True
    return t


def _run(flow: dict, t: Turn, target: str) -> None:
    v = t.state["vars"]
    for _ in range(MAX_HOPS):
        if target == "ai":
            t.state.update(ai=True, step=None)
            t.ai = t.ai or not t.say  # nothing scripted to say yet (a button that leads to the AI): the AI answers what they chose
            return
        if target == "human":
            t.state.update(step=None)
            t.human = True
            return
        if target == "end":
            t.state.update(step=None, done=True)
            return
        step = _find(flow, target)
        if step is None:
            t.state.update(ai=True, step=None)
            return
        kind = step["type"]
        if kind == "message":
            if step["text"]:
                t.say.append({"text": _fill(step["text"], v)})
            target = _after(flow, step)
        elif kind == "ask":
            t.say.append({"text": _fill(step["text"] or "Could you tell me more?", v)})
            t.state["step"] = step["id"]
            return
        elif kind == "choice":
            t.say.append({"text": _fill(step["text"] or "How can I help?", v), "options": [o["label"] for o in step["options"]]})
            t.state["step"] = step["id"]
            return
        elif kind == "ai":
            if step["text"]:
                t.say.append({"text": _fill(step["text"], v)})
            t.state.update(ai=True, step=None)
            t.ai = t.ai or not t.say
            return
        elif kind == "human":
            if step["text"]:
                t.say.append({"text": _fill(step["text"], v)})
            t.state.update(step=None)
            t.human = True
            return
        else:  # end
            if step["text"]:
                t.say.append({"text": _fill(step["text"], v)})
            t.state.update(step=None, done=True)
            return
    t.state.update(ai=True, step=None)  # a loop in the flow: fall back to the AI rather than spin
