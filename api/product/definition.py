"""Build and read the platform conversation graph for product agents."""

from copy import deepcopy


def build_definition(*, name: str, prompt: str, greeting: str) -> dict:
    """The simplest valid graph: greet + converse, then a closing node."""
    return {
        "nodes": [
            {
                "id": "start",
                "type": "startCall",
                "position": {"x": 0, "y": 0},
                "data": {
                    "name": name[:60] or "Start",
                    "prompt": prompt,
                    "greeting": greeting,
                    "greeting_type": "text",
                    "is_start": True,
                    "allow_interrupt": True,
                    "add_global_prompt": False,
                },
            },
            {
                "id": "end",
                "type": "endCall",
                "position": {"x": 0, "y": 220},
                "data": {
                    "name": "Goodbye",
                    "prompt": "Thank the caller politely and say goodbye.",
                    "is_end": True,
                    "allow_interrupt": False,
                    "add_global_prompt": False,
                },
            },
        ],
        "edges": [
            {
                "id": "start-end",
                "source": "start",
                "target": "end",
                "data": {
                    "label": "Finished",
                    "condition": "The caller's request is handled or they want to end the call",
                },
            }
        ],
    }


def set_interruptions(definition: dict, allowed: bool) -> dict:
    """Let callers talk over the agent (or not) on every conversation step; the closing step never allows it."""
    out = deepcopy(definition)
    for n in out.get("nodes", []):
        if n.get("type") in ("startCall", "agentNode"):
            n.setdefault("data", {})["allow_interrupt"] = allowed
    return out


QA_NODE = "global-qa"


def with_qa(definition: dict, qa: list[dict] | None) -> dict:
    """Keep the agent's questions and answers in one global node, so every step of the call can use them."""
    out = deepcopy(definition)
    nodes = [n for n in out.get("nodes", []) if n.get("id") != QA_NODE]
    pairs = [x for x in (qa or []) if x.get("q") and x.get("a")]
    if pairs:
        text = "Frequently asked questions. When the caller asks one of these, answer with the matching answer, in your own natural words and in the caller's language. Never invent facts that are not here or elsewhere in your instructions.\n\n" + "\n\n".join(f"Q: {x['q']}\nA: {x['a']}" for x in pairs)
        xs = [n.get("position", {}).get("x", 0) for n in nodes]
        nodes.append({"id": QA_NODE, "type": "globalNode", "position": {"x": (max(xs) if xs else 0) + 320, "y": 0}, "data": {"name": "Q&A", "prompt": text}})
        for n in nodes:
            if n.get("type") in ("startCall", "agentNode"):
                n.setdefault("data", {})["add_global_prompt"] = True
    out["nodes"] = nodes
    return out


def get_prompt(definition: dict) -> str:
    for n in definition.get("nodes", []):
        if n.get("type") == "startCall":
            return n.get("data", {}).get("prompt", "") or ""
    return ""


def with_prompt(
    definition: dict,
    *,
    name: str | None = None,
    prompt: str | None = None,
    greeting: str | None = None,
) -> dict:
    """Return a copy with the start node's text updated; every other node is left untouched."""
    out = deepcopy(definition)
    for n in out.get("nodes", []):
        if n.get("type") == "startCall":
            d = n.setdefault("data", {})
            if prompt is not None:
                d["prompt"] = prompt
            if greeting is not None:
                d["greeting"] = greeting
            if name is not None:
                d["name"] = name[:60] or d.get("name", "Start")
    return out
