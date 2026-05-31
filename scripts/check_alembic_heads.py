#!/usr/bin/env python3
"""
CI safeguard: Verify that the Alembic migration graph has exactly ONE head.

Usage:
    python scripts/check_alembic_heads.py

Exit codes:
    0 — single head, graph is clean
    1 — multiple heads detected, PR must include a merge migration

Run this as a pre-merge CI step.  On failure it prints the offending heads
and the exact `alembic merge` command needed to fix the divergence.

Rule: No PR may introduce multiple Alembic heads without a corresponding
      merge migration that reduces the graph back to a single head.
"""

import subprocess
import sys
import os

ALEMBIC_INI = os.path.join(os.path.dirname(__file__), "..", "api", "alembic.ini")
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def get_heads() -> list[str]:
    env = os.environ.copy()
    # Ensure the repo root is importable so alembic/env.py can import api.*
    python_path = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = f"{REPO_ROOT}{os.pathsep}{python_path}" if python_path else REPO_ROOT

    result = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", ALEMBIC_INI, "heads"],
        capture_output=True,
        text=True,
        env=env,
        cwd=os.path.join(REPO_ROOT, "api"),
    )

    if result.returncode != 0:
        print("ERROR: alembic heads command failed:")
        print(result.stderr)
        sys.exit(1)

    # Each line looks like: "<revision_id> (head)"
    heads = []
    for line in result.stdout.strip().splitlines():
        line = line.strip()
        if line:
            heads.append(line.split()[0])
    return heads


def main() -> None:
    print("Checking Alembic migration heads...")
    heads = get_heads()

    if len(heads) == 1:
        print(f"[OK] Single head found: {heads[0]}")
        print("Migration graph is clean. No action needed.")
        sys.exit(0)

    # Multiple heads — fail loudly
    print()
    print("=" * 70)
    print("[FAIL] MULTIPLE ALEMBIC HEADS DETECTED -- CI FAILED")
    print("=" * 70)
    print()
    print(f"Found {len(heads)} heads:")
    for h in heads:
        print(f"  • {h}")
    print()
    print("This means the Alembic migration DAG has diverged.")
    print("You MUST create a merge migration before merging this PR.")
    print()
    print("Fix by running:")
    print()
    ids = " ".join(heads)
    print(f'  cd api')
    print(f'  python -m alembic -c alembic.ini merge {ids} \\')
    print(f'      -m "merge <describe the two branches>"')
    print()
    print("Then commit the generated file in api/alembic/versions/ and push.")
    print()
    print("Rule: No PR may introduce multiple Alembic heads without a")
    print("      corresponding merge migration that reduces the graph to ONE head.")
    print("=" * 70)
    sys.exit(1)


if __name__ == "__main__":
    main()
