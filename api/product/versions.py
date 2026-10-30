"""Version comparison: a line diff of the prompt plus a structured diff of the steps."""

import difflib


def prompt_diff(old: str, new: str) -> list[dict]:
    """Line-by-line changes going from ``old`` to ``new``: op is add | del | same."""
    out: list[dict] = []
    for line in difflib.ndiff(old.splitlines(), new.splitlines()):
        tag, text = line[:2], line[2:]
        if tag == "+ ":
            out.append({"op": "add", "text": text})
        elif tag == "- ":
            out.append({"op": "del", "text": text})
        elif tag == "  ":
            out.append({"op": "same", "text": text})
    return out


def _nodes(defn: dict) -> dict[str, dict]:
    return {n["id"]: n for n in (defn or {}).get("nodes", []) if "id" in n}


def _label(n: dict) -> str:
    return (n.get("data") or {}).get("name") or n.get("type") or n.get("id", "")


def node_diff(old: dict, new: dict) -> dict:
    """Steps added, removed or changed (by id) and which settings changed in each."""
    a, b = _nodes(old), _nodes(new)
    changed = []
    for nid in a.keys() & b.keys():
        da, db = a[nid].get("data") or {}, b[nid].get("data") or {}
        fields = sorted(k for k in (da.keys() | db.keys()) if da.get(k) != db.get(k))
        if fields or a[nid].get("type") != b[nid].get("type"):
            changed.append({"id": nid, "name": _label(b[nid]), "fields": fields})
    return {
        "added": [{"id": i, "name": _label(b[i])} for i in sorted(b.keys() - a.keys())],
        "removed": [{"id": i, "name": _label(a[i])} for i in sorted(a.keys() - b.keys())],
        "changed": sorted(changed, key=lambda c: c["id"]),
    }
