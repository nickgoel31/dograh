"""Fail if the platform's own name shows up anywhere a customer of the new product could see it.

    python scripts/check_branding.py            # checks the files below
    python scripts/check_branding.py --api      # also checks the product API's OpenAPI document

Scanned: the new web app's source, built files, public files and OpenAPI file; the product API's source and
help articles. The classic UI and the platform itself are not scanned (they keep their own name).
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
NAME = re.compile("dograh", re.I)
TARGETS = ["vocalis-web/src", "vocalis-web/dist", "vocalis-web/public", "vocalis-web/index.html", "vocalis-web/openapi.json", "api/product"]
SKIP_DIRS = {"__pycache__", "node_modules"}
TEXT = {".ts", ".tsx", ".js", ".css", ".html", ".json", ".svg", ".py", ".md", ".txt", ".map"}


def files():
    for t in TARGETS:
        p = ROOT / t
        if p.is_file():
            yield p
        elif p.is_dir():
            for f in p.rglob("*"):
                if f.is_file() and f.suffix in TEXT and not SKIP_DIRS & set(f.parts):
                    yield f


def main() -> int:
    hits = []
    for f in files():
        for n, line in enumerate(f.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
            if NAME.search(line):
                hits.append(f"{f.relative_to(ROOT)}:{n}: {line.strip()[:120]}")
    if "--api" in sys.argv:
        import os

        for k, v in {"DATABASE_URL": "postgresql+asyncpg://x/x", "REDIS_URL": "redis://x", "MINIO_PUBLIC_ENDPOINT": "http://x"}.items():
            os.environ.setdefault(k, v)
        from api.product.export_openapi import build_app

        for n, line in enumerate(json.dumps(build_app().openapi(), indent=1).splitlines(), 1):
            if NAME.search(line):
                hits.append(f"<product openapi>:{n}: {line.strip()[:120]}")
    for h in hits:
        print(h)
    print(f"{len(hits)} place(s) show the platform's name." if hits else "Branding clean.")
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main())
