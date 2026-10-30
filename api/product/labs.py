"""Testing Lab logic: callers, judging, significance. No database."""

import json
import math
import re
from dataclasses import dataclass

from api.product.llm_gateway import AgentTextGateway, LLMGateway

PERSONAS = {
    "angry": ("Angry customer", "You are an angry, impatient customer. You interrupt, complain and demand a quick fix, but calm down if handled well."),
    "confused": ("Confused elder", "You are an elderly person who is unsure about technology. You ask for things to be repeated and give vague answers."),
    "fast": ("Fast talker", "You talk very fast, give several pieces of information at once, and expect the agent to keep up."),
    "silent": ("Quiet caller", "You give very short answers like 'yes', 'no', 'okay' and only say more when asked a direct question."),
    "chatty": ("Chatty caller", "You love to chat and wander off topic, but you do eventually say what you need."),
    "sceptic": ("Sceptical buyer", "You doubt everything, ask for proof and prices, and need convincing before you agree to anything."),
}
MAX_TURNS = 8
PASS_SCORE = 70
RUBRIC = ("Score the AGENT in this phone conversation from 0 to 100 on each of: goal_reached (did the caller get what they came for), "
          "politeness, handled_difficulty (stayed helpful with this kind of caller), no_made_up_facts (never invented prices, times or policies). "
          'Reply with ONLY JSON: {"goal_reached":0-100,"politeness":0-100,"handled_difficulty":0-100,"no_made_up_facts":0-100,'
          '"note":"one short plain sentence on what went wrong, or what went well"}')


@dataclass
class Judgement:
    score: int
    note: str


def _json_in(text: str) -> dict | None:
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        return None
    try:
        v = json.loads(m.group(0))
        return v if isinstance(v, dict) else None
    except ValueError:
        return None


def _num(v) -> float | None:
    try:
        return max(0.0, min(100.0, float(v)))
    except (TypeError, ValueError):
        return None


def parse_judgement(text: str) -> Judgement | None:
    d = _json_in(text)
    if not d:
        return None
    parts = [_num(d.get(k)) for k in ("goal_reached", "politeness", "handled_difficulty", "no_made_up_facts")]
    if any(p is None for p in parts):
        return None
    # A made-up fact or a missed goal drags the whole score down: weighted, not a plain average.
    g, p, h, f = parts
    score = round(0.4 * g + 0.15 * p + 0.2 * h + 0.25 * f)
    return Judgement(score, str(d.get("note") or "")[:240])


def parse_verdict(text: str) -> tuple[bool, str] | None:
    d = _json_in(text)
    if not d or not isinstance(d.get("pass"), bool):
        return None
    return d["pass"], str(d.get("note") or "")[:240]


def transcript_text(turns: list[dict]) -> str:
    return "\n".join(f"{'Agent' if t['who'] == 'agent' else 'Caller'}: {t['text']}" for t in turns)


async def simulate(text: AgentTextGateway, llm: LLMGateway, *, org_id: int, user_id: int, workflow_id: int, persona: str, goal: str = "") -> tuple[list[dict], Judgement | None]:
    """An LLM plays the caller against the agent (as text), then a second call scores the agent."""
    _, brief = PERSONAS[persona]
    caller_system = f"{brief} {('You are calling to: ' + goal) if goal else 'Invent a believable reason for calling a small business.'} Reply with only what you say out loud, one or two short sentences. Say GOODBYE when you are done."
    reply = await text.start(org_id, user_id, workflow_id)
    turns: list[dict] = [{"who": "agent", "text": reply.text}] if reply.text else []
    for _ in range(MAX_TURNS):
        if reply.ended:
            break
        history = [{"role": "assistant" if t["who"] == "caller" else "user", "content": t["text"]} for t in turns] or [{"role": "user", "content": "(the phone rings)"}]
        said = (await llm.complete(org_id, user_id, caller_system, history)).strip()
        if not said:
            break
        turns.append({"who": "caller", "text": said})
        reply = await text.say(org_id, user_id, workflow_id, reply.run_id, said)
        if reply.text:
            turns.append({"who": "agent", "text": reply.text, **({"tools": reply.tools} if reply.tools else {})})
        if "goodbye" in said.lower():
            break
    raw = await llm.complete(org_id, user_id, RUBRIC, [{"role": "user", "content": f"Caller type: {PERSONAS[persona][0]}\n\n{transcript_text(turns)}"}])
    return turns, parse_judgement(raw)


async def check_case(text: AgentTextGateway, llm: LLMGateway, *, org_id: int, user_id: int, workflow_id: int, say: str, expect: str, must_call: str | None) -> tuple[bool, str, str]:
    """(passed, note, what the agent said). A required tool call is checked directly, the rest is judged."""
    first = await text.start(org_id, user_id, workflow_id)
    r = await text.say(org_id, user_id, workflow_id, first.run_id, say)
    if must_call and must_call not in r.tools:
        return False, f"The agent didn't use the “{must_call}” tool.", r.text
    prompt = f"The caller said: {say}\nThe agent replied: {r.text}\nThe agent should: {expect}\nDid the agent do that? Reply with ONLY JSON: " + '{"pass":true|false,"note":"one short plain sentence"}'
    v = parse_verdict(await llm.complete(org_id, user_id, "You are a strict, fair checker of phone-agent replies.", [{"role": "user", "content": prompt}]))
    if v is None:
        return False, "We couldn't judge this one. Run it again.", r.text
    return v[0], v[1], r.text


def significance(a_pass: int, a_n: int, b_pass: int, b_n: int, min_n: int = 20, alpha: float = 0.05) -> dict:
    """Two-proportion z-test. A winner is only named when there is enough data and the gap is unlikely to be luck."""
    if min(a_n, b_n) < min_n:
        return {"winner": None, "reason": "not_enough_data", "p": None, "needed": min_n}
    pa, pb = a_pass / a_n, b_pass / b_n
    pool = (a_pass + b_pass) / (a_n + b_n)
    se = math.sqrt(pool * (1 - pool) * (1 / a_n + 1 / b_n))
    if se == 0:
        return {"winner": None, "reason": "no_difference", "p": 1.0, "needed": min_n}
    z = (pa - pb) / se
    p = math.erfc(abs(z) / math.sqrt(2))
    if p < alpha:
        return {"winner": "A" if pa > pb else "B", "reason": "significant", "p": round(p, 4), "needed": min_n}
    return {"winner": None, "reason": "no_clear_winner", "p": round(p, 4), "needed": min_n}
