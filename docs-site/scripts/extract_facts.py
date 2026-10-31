"""Dump facts from the product code into src/data/facts.json (run from repo root: python docs-site/scripts/extract_facts.py)."""
import json, sys, os, re, pathlib
sys.path.insert(0, ".")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://u:p@localhost/x"); os.environ.setdefault("REDIS_URL", "redis://localhost:6379"); os.environ.setdefault("MINIO_PUBLIC_ENDPOINT", "http://localhost:9000")
facts = {}
from api.product import templates, pricing, roles
facts["templates"] = [{"key": t.key, "name": t.name, "role": t.role, "tone": t.tone, "blurb": t.blurb} for t in templates.TEMPLATES]
facts["slabs"] = [{"upto": a, "rate": b} for a, b in pricing.DEFAULT_SLABS]
facts["phone_per_min"] = pricing.PHONE_PER_MIN
facts["shares"] = [{"name": n, "share": s} for n, s in pricing.SHARES]
facts["roles"] = {r.value: sorted(p.value for p in perms) for r, perms in roles.MATRIX.items()}
facts["perms"] = [p.value for p in roles.Perm]
try:
    from api.product import connectors
    facts["connectors"] = [{"id": c.id, "name": c.name, "blurb": c.blurb,
        "fields": [{"key": f.key, "label": f.label, "secret": f.secret, "hint": f.hint, "default": f.default, "optional": f.optional} for f in c.fields],
        "actions": [{"name": a.name, "key": a.key, "description": a.description, "params": a.params} for a in c.actions],
        "pushes": c.push is not None} for c in getattr(connectors, "CONNECTORS", None) or getattr(connectors, "REGISTRY").values()]
except Exception as e:
    print("connectors:", repr(e)); facts["connectors"] = []
src = pathlib.Path("api/product/numbers_router.py").read_text(encoding="utf-8")
try:
    import ast
    m = re.search(r"^CARRIERS[^=]*=\s*(\{.*?^\})", src, re.S | re.M)
    CARRIERS = ast.literal_eval(m.group(1))
    facts["carriers"] = [{"id": k, "name": v["name"], "auto": v["auto"], "fields": [{"key": f, "label": l, "secret": s, "optional": o} for f, l, s, o in v["fields"]]} for k, v in CARRIERS.items()]
except Exception as e:
    print("carriers:", repr(e)); facts["carriers"] = []
# env vars read by the code
envs = {}
pat = re.compile(r"""["']((?:PRODUCT|RAZORPAY|GOOGLE|VOCALIS|HUMAN|PRICE|INWORLD)_[A-Z0-9_]+|CURRENCY)["']""")
for p in list(pathlib.Path("api/product").glob("*.py")) + [pathlib.Path("api/routes/telephony.py")]:
    if p.exists():
        for m in pat.finditer(p.read_text(encoding="utf-8")):
            envs.setdefault(m.group(1), set()).add(p.name)
facts["env"] = {k: sorted(v) for k, v in sorted(envs.items())}
pathlib.Path("docs-site/src/data/facts.json").write_text(json.dumps(facts, indent=1), encoding="utf-8")
print({k: (len(v) if hasattr(v,"__len__") else v) for k, v in facts.items()})
