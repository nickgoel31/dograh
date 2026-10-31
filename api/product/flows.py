"""Validation for call flows saved from the editor."""

from copy import deepcopy

from api.product.errors import product_error

MAX_NODES = 100


def _bad(message: str):
    return product_error(400, "flow_invalid", message)


def check_flow(definition: dict) -> None:
    """Friendly structural checks, then the platform's own validation."""
    nodes = definition.get("nodes") if isinstance(definition, dict) else None
    edges = definition.get("edges") if isinstance(definition, dict) else None
    if not isinstance(nodes, list) or not isinstance(edges, list):
        raise _bad("This flow isn't in the right shape. Reload the page and try again.")
    if len(nodes) > MAX_NODES:
        raise _bad(f"A call flow can have up to {MAX_NODES} steps.")
    ids = [n.get("id") for n in nodes]
    if len(set(ids)) != len(ids):
        raise _bad("Two steps share the same identity. Reload the page and try again.")
    if sum(1 for n in nodes if n.get("type") == "startCall") != 1:
        raise _bad("Your flow needs exactly one Greeting step so the agent knows how to start.")
    if not any(n.get("type") == "endCall" for n in nodes):
        raise _bad("Add a Close step so calls end politely.")
    known = set(ids)
    for e in edges:
        if e.get("source") not in known or e.get("target") not in known:
            raise _bad("A connection points at a step that no longer exists.")

    # The platform's own validator, so a flow that saves here is one the runtime accepts.
    try:
        from api.services.workflow.dto import ReactFlowDTO
        from api.services.workflow.workflow_graph import WorkflowGraph

        WorkflowGraph(ReactFlowDTO.model_validate(definition))
    except Exception as exc:  # noqa: BLE001 - surfaced as one friendly message
        raise _bad(f"Something in the flow needs fixing: {_first_problem(exc)}") from exc


def _first_problem(exc: Exception) -> str:
    errors = getattr(exc, "errors", None)
    if callable(errors):
        try:
            first = errors()[0]
            where = " > ".join(str(p) for p in first.get("loc", ()) if p not in ("nodes", "edges", "data"))
            return f"{where}: {first.get('msg')}" if where else str(first.get("msg"))
        except Exception:  # noqa: BLE001
            pass
    return str(exc)[:200]


def keep_agent_prompt(new: dict, current: dict) -> dict:
    """The Personality tab owns the main prompt: the flow editor never overwrites it."""
    out = deepcopy(new)
    cur = next((n for n in current.get("nodes", []) if n.get("type") == "startCall"), None)
    start = next((n for n in out.get("nodes", []) if n.get("type") == "startCall"), None)
    if cur is not None and start is not None:
        prompt = (cur.get("data") or {}).get("prompt")
        if prompt:
            start.setdefault("data", {})["prompt"] = prompt
    return out


def adopt_start_prompt(new: dict, current: dict) -> tuple[dict, bool]:
    """The Greeting step's instructions may be edited in the flow editor (same text as the Personality tab's raw prompt).
    Returns the flow to save and whether the main instructions changed. A flow with no instructions keeps the current ones."""
    out = deepcopy(new)
    cur = next((n for n in current.get("nodes", []) if n.get("type") == "startCall"), None)
    start = next((n for n in out.get("nodes", []) if n.get("type") == "startCall"), None)
    if cur is None or start is None:
        return out, False
    old = (cur.get("data") or {}).get("prompt") or ""
    incoming = ((start.get("data") or {}).get("prompt") or "").strip()
    if not incoming:
        start.setdefault("data", {})["prompt"] = old
        return out, False
    return out, incoming != old.strip()
