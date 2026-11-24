"""Swarvo IVR engine: a phone menu as data, and the rules for walking it. Pure: no database, no network, no clock except what is passed in.

A flow is {"start": "n1", "nodes": {"n1": {...}, ...}}. Each node has a "type":

    menu       say, options {"1": node}, keywords {"sales, pricing": node}, retries, invalid, on_fail (node), agent_id (AI catches what the menu does not)
    say        say, next
    hours      open (node), closed (node)             -> picks by the IVR's business hours
    collect    say, digits (how many), var, next      -> keeps what the caller typed, as {{var}}
    transfer   say, number, fail_say, on_fail (node)  -> rings another phone number
    voicemail  say, seconds, next                     -> records a message
    agent      say, agent_id                          -> hands the call to an AI voice agent
    hangup     say

`step()` walks from a node through every non-interactive node and stops at the first thing that needs the caller or the phone network:
it returns a Step: what to say, and one `then` action (gather / dial / record / agent / hangup). The same Step drives the browser simulator
and the Plivo XML, so what you test is what callers get.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from xml.sax.saxutils import escape, quoteattr

TYPES = ("menu", "say", "hours", "collect", "transfer", "voicemail", "agent", "hangup")
MAX_NODES = 60
MAX_HOPS = 25
SAY_MAX = 600
_NUMBER = re.compile(r"^\+[1-9]\d{6,14}$")
_WORDS = {"zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
          "ek": "1", "do": "2", "teen": "3", "char": "4", "paanch": "5", "panch": "5", "chhe": "6", "saat": "7", "aath": "8", "nau": "9"}
DEFAULT_INVALID = "Sorry, I didn't get that."
DEFAULT_GOODBYE = "Thank you for calling. Goodbye."


class FlowError(ValueError):
    pass


def _text(v, limit: int = SAY_MAX) -> str:
    return str(v or "").strip()[:limit]


def _ref(nodes: dict, v) -> str | None:
    v = str(v or "").strip()
    return v if v in nodes else None


def clean(flow: dict) -> dict:
    """Normalise what the builder sent. Raises FlowError with a plain message for anything that cannot work."""
    if not isinstance(flow, dict) or not isinstance(flow.get("nodes"), dict) or not flow["nodes"]:
        raise FlowError("Add at least one step to your menu.")
    raw = flow["nodes"]
    if len(raw) > MAX_NODES:
        raise FlowError(f"A menu can have up to {MAX_NODES} steps.")
    ids = {str(k) for k in raw}
    if any(not re.fullmatch(r"[A-Za-z0-9_-]{1,24}", k) for k in ids):
        raise FlowError("Step names can only use letters, numbers, - and _.")
    nodes: dict[str, dict] = {}
    for key, n in raw.items():
        key = str(key)
        if not isinstance(n, dict) or n.get("type") not in TYPES:
            raise FlowError(f"Step “{key}” has an unknown type.")
        t, out = n["type"], {"type": n["type"], "label": _text(n.get("label"), 60)}
        link = lambda name: (str(n.get(name) or "").strip() if str(n.get(name) or "").strip() in ids else None)  # noqa: E731
        if t == "menu":
            out["say"] = _text(n.get("say"))
            if not out["say"]:
                raise FlowError(f"Step “{out['label'] or key}”: write what the menu should say.")
            opts = {}
            for d, target in (n.get("options") or {}).items():
                if str(d) not in list("0123456789*#") or str(target) not in ids:
                    continue
                opts[str(d)] = str(target)
            kws = {}
            for words, target in (n.get("keywords") or {}).items():
                w = ", ".join(sorted({x.strip().lower() for x in str(words).split(",") if x.strip()}))[:120]
                if w and str(target) in ids:
                    kws[w] = str(target)
            out.update(options=opts, keywords=kws, retries=max(0, min(int(n.get("retries", 2) or 0), 5)), invalid=_text(n.get("invalid"), 200),
                       on_fail=link("on_fail"), agent_id=_text(n.get("agent_id"), 40) or None, speech=bool(n.get("speech", bool(kws) or bool(n.get("agent_id")))))
            if not opts and not kws and not out["agent_id"]:
                raise FlowError(f"Step “{out['label'] or key}”: add at least one choice, or let an AI agent take over.")
        elif t == "say":
            out.update(say=_text(n.get("say")), next=link("next"))
            if not out["say"]:
                raise FlowError(f"Step “{out['label'] or key}”: write what to say.")
        elif t == "hours":
            out.update(open=link("open"), closed=link("closed"))
        elif t == "collect":
            out.update(say=_text(n.get("say")), digits=max(1, min(int(n.get("digits", 4) or 4), 20)), var=re.sub(r"[^a-z0-9_]", "", str(n.get("var") or "code").lower())[:24] or "code", next=link("next"))
            if not out["say"]:
                raise FlowError(f"Step “{out['label'] or key}”: write what to ask the caller to type.")
        elif t == "transfer":
            num = re.sub(r"[\s()-]", "", str(n.get("number") or ""))
            if not _NUMBER.match(num):
                raise FlowError(f"Step “{out['label'] or key}”: enter the number with its country code, like +919876543210.")
            out.update(say=_text(n.get("say")), number=num, fail_say=_text(n.get("fail_say"), 300), on_fail=link("on_fail"))
        elif t == "voicemail":
            out.update(say=_text(n.get("say")), seconds=max(10, min(int(n.get("seconds", 60) or 60), 180)), next=link("next"))
        elif t == "agent":
            out.update(say=_text(n.get("say")), agent_id=_text(n.get("agent_id"), 40))
            if not out["agent_id"]:
                raise FlowError(f"Step “{out['label'] or key}”: choose which AI agent takes the call.")
        else:  # hangup
            out["say"] = _text(n.get("say"))
        nodes[key] = out
    start = str(flow.get("start") or "")
    if start not in nodes:
        start = next(iter(nodes))
    return {"start": start, "nodes": nodes}


def problems(flow: dict) -> list[str]:
    """Things that make a menu not ready to take calls (it can still be saved as a draft)."""
    out: list[str] = []
    nodes = flow.get("nodes") or {}
    seen, todo = set(), [flow.get("start")]
    while todo:
        k = todo.pop()
        if k in seen or k not in nodes:
            continue
        seen.add(k)
        n = nodes[k]
        todo += [*(n.get("options") or {}).values(), *(n.get("keywords") or {}).values(), *[n.get(x) for x in ("next", "open", "closed", "on_fail")]]
    for k, n in nodes.items():
        name = n.get("label") or k
        if k not in seen:
            out.append(f"“{name}” can never be reached from the start.")
        if n["type"] == "hours" and not (n.get("open") and n.get("closed")):
            out.append(f"“{name}”: choose where callers go when you are open and when you are closed.")
    return out


@dataclass
class Step:
    say: list[str] = field(default_factory=list)  # played before `then` (or as part of the gather prompt)
    then: dict = field(default_factory=lambda: {"kind": "hangup"})
    trail: list[str] = field(default_factory=list)  # the steps walked, for the call log


def fill(text: str, vars: dict) -> str:
    """Put {{name}} values into a sentence; digits are spoken one by one."""
    return re.sub(r"\{\{\s*([a-z0-9_]+)\s*\}\}", lambda m: " ".join(str(vars.get(m.group(1), ""))), text or "")


def step(flow: dict, node_id: str, *, vars: dict | None = None, is_open=lambda _hours: True, hours: dict | None = None, prefix: list[str] | None = None, tries: int = 0) -> Step:
    """Walk from `node_id` until something needs the caller or the network."""
    vars, nodes = vars or {}, flow["nodes"]
    out = Step(say=list(prefix or []))
    cur: str | None = node_id
    for _ in range(MAX_HOPS):
        n = nodes.get(cur or "")
        if n is None:
            out.say.append(DEFAULT_GOODBYE)
            out.then = {"kind": "hangup"}
            return out
        out.trail.append(cur)
        t = n["type"]
        if t == "say":
            out.say.append(fill(n["say"], vars))
            if not n.get("next"):
                out.then = {"kind": "hangup"}
                return out
            cur = n["next"]
        elif t == "hours":
            nxt = n.get("open") if is_open(hours) else n.get("closed")
            if not nxt:
                out.then = {"kind": "hangup"}
                return out
            cur = nxt
        elif t == "menu":
            opts = n["options"]
            prompt = fill(n["say"], vars)
            if tries:
                out.say.append(n.get("invalid") or DEFAULT_INVALID)
            out.then = {"kind": "gather", "node": cur, "prompt": prompt, "digits": bool(opts), "speech": bool(n.get("speech")), "num_digits": 1 if opts and not n["keywords"] and all(len(d) == 1 for d in opts) else 0, "tries": tries}
            return out
        elif t == "collect":
            out.then = {"kind": "gather", "node": cur, "prompt": fill(n["say"], vars), "digits": True, "speech": False, "num_digits": n["digits"], "tries": tries, "collect": n["var"]}
            return out
        elif t == "transfer":
            if n.get("say"):
                out.say.append(fill(n["say"], vars))
            out.then = {"kind": "dial", "node": cur, "number": n["number"]}
            return out
        elif t == "voicemail":
            out.then = {"kind": "record", "node": cur, "prompt": fill(n.get("say") or "Please leave a message after the beep.", vars), "seconds": n["seconds"]}
            return out
        elif t == "agent":
            if n.get("say"):
                out.say.append(fill(n["say"], vars))
            out.then = {"kind": "agent", "node": cur, "agent_id": n["agent_id"]}
            return out
        else:  # hangup
            out.say.append(fill(n.get("say") or DEFAULT_GOODBYE, vars))
            out.then = {"kind": "hangup"}
            return out
    out.then = {"kind": "hangup"}
    return out


def answer(flow: dict, node_id: str, *, digits: str = "", speech: str = "", tries: int = 0, vars: dict | None = None, is_open=lambda _h: True, hours: dict | None = None) -> Step:
    """What happens when the caller answers (or says nothing at) a menu or a collect step."""
    vars = dict(vars or {})
    n = flow["nodes"][node_id]
    kw = dict(vars=vars, is_open=is_open, hours=hours)
    digits, speech = re.sub(r"[^0-9*#]", "", digits or ""), (speech or "").strip().lower()
    if n["type"] == "collect":
        if not digits:
            return step(flow, node_id, tries=tries + 1, prefix=[DEFAULT_INVALID] if tries else None, **kw) if tries < 2 else step(flow, n["next"], **kw) if n.get("next") else Step(say=[DEFAULT_GOODBYE])
        vars[n["var"]] = digits
        return step(flow, n["next"], **kw) if n.get("next") else Step(say=[DEFAULT_GOODBYE])
    # menu
    target = n["options"].get(digits) if digits else None
    if not target and speech:
        spoken = _WORDS.get(speech.strip(" .!"), "")
        target = n["options"].get(spoken) if spoken else None
        if not target:
            for words, node in n["keywords"].items():
                if any(w and w in speech for w in (x.strip() for x in words.split(","))):
                    target = node
                    break
    if target:
        return step(flow, target, **kw)
    if tries < n["retries"]:
        return step(flow, node_id, tries=tries + 1, **kw)
    if n.get("agent_id"):  # nothing matched: the AI agent takes over
        s = Step(trail=[node_id], then={"kind": "agent", "node": node_id, "agent_id": n["agent_id"]})
        return s
    if n.get("on_fail"):
        return step(flow, n["on_fail"], **kw)
    return Step(say=["Sorry, we couldn't help with that. Goodbye."], then={"kind": "hangup"}, trail=[node_id])


def after_dial(flow: dict, node_id: str, status: str, *, vars=None, is_open=lambda _h: True, hours=None) -> Step:
    """The result of ringing a transfer number. A connected call that has now ended just finishes."""
    n = flow["nodes"][node_id]
    if status in ("completed", "answered", "in-progress"):
        return Step(then={"kind": "hangup"}, trail=[node_id])
    fail = fill(n.get("fail_say") or "Sorry, we couldn't connect your call.", vars or {})
    if n.get("on_fail"):
        return step(flow, n["on_fail"], vars=vars, is_open=is_open, hours=hours, prefix=[fail])
    return Step(say=[fail, DEFAULT_GOODBYE], then={"kind": "hangup"}, trail=[node_id])


def after_record(flow: dict, node_id: str, *, vars=None, is_open=lambda _h: True, hours=None) -> Step:
    n = flow["nodes"][node_id]
    thanks = ["Thank you. Your message has been recorded."]
    return step(flow, n["next"], vars=vars, is_open=is_open, hours=hours, prefix=thanks) if n.get("next") else Step(say=[*thanks, DEFAULT_GOODBYE], trail=[node_id])


# ---------------- Plivo XML ----------------
def _speak(text: str, voice: str, language: str) -> str:
    return f"<Speak voice={quoteattr(voice)} language={quoteattr(language)}>{escape(text)}</Speak>" if text.strip() else ""


def to_xml(s: Step, *, voice: str, language: str, url, caller_id: str = "") -> str:
    """Plivo XML for a Step. `url(kind, node, tries)` makes the signed callback address for what happens next."""
    say = "".join(_speak(t, voice, language) for t in s.say)
    a = s.then
    kind = a["kind"]
    if kind == "gather":
        types = ",".join(x for x, on in (("dtmf", a["digits"]), ("speech", a["speech"])) if on) or "dtmf"
        nd = f' numDigits="{a["num_digits"]}"' if a.get("num_digits") else ' finishOnKey="#"'
        body = (f'<GetInput action={quoteattr(url("input", a["node"], a["tries"]))} method="POST" inputType="{types}" executionTimeout="8" digitEndTimeout="3"'
                f' speechEndTimeout="2" language={quoteattr(language)} redirect="false"{nd}>{say}{_speak(a["prompt"], voice, language)}</GetInput>')
        # no input at all: Plivo runs the next element, which asks again
        return f'<Response>{body}<Redirect method="POST">{escape(url("noinput", a["node"], a["tries"]))}</Redirect></Response>'
    if kind == "dial":
        cid = f" callerId={quoteattr(caller_id)}" if caller_id else ""
        return f'<Response>{say}<Dial action={quoteattr(url("dial", a["node"], 0))} method="POST" timeout="30"{cid}><Number>{escape(a["number"])}</Number></Dial></Response>'
    if kind == "record":
        return (f'<Response>{say}{_speak(a["prompt"], voice, language)}<Record action={quoteattr(url("record", a["node"], 0))} method="POST" maxLength="{a["seconds"]}"'
                f' playBeep="true" finishOnKey="#" redirect="true"/></Response>')
    if kind == "agent":
        return f'<Response>{say}<Redirect method="POST">{escape(url("agent", a["node"], 0))}</Redirect></Response>'
    return f"<Response>{say}<Hangup/></Response>"
