"""A one-line summary and mood score for each finished call, written by the AI once from the transcript and then kept."""

import json
import re

from sqlalchemy import select

from api.db.product_models import ProductCallInsightModel

SYSTEM = (
    "You read a phone call transcript between an AI agent and a caller. Reply with JSON only: "
    '{"summary": "<one plain sentence, under 25 words, saying what the caller wanted and what happened>", '
    '"sentiment": <1 to 5, where 1 = upset, 3 = neutral, 5 = delighted>, '
    '"unanswered": [<each question the caller asked that the agent could not answer or got wrong, as a short question; [] if none>]}. Use only what is in the transcript. Never invent details.'
)


def parse(raw: str) -> tuple[str, int | None] | None:
    m = re.search(r"\{.*\}", raw or "", re.S)
    if not m:
        return None
    try:
        d = json.loads(m.group(0))
        summary = str(d.get("summary", "")).strip()[:400]
        s = d.get("sentiment")
        sentiment = int(s) if isinstance(s, (int, float)) and 1 <= int(s) <= 5 else None
    except (ValueError, TypeError):
        return None
    return (summary, sentiment) if summary else None


def unanswered_of(raw: str) -> list[str]:
    m = re.search(r"\{.*\}", raw or "", re.S)
    try:
        items = json.loads(m.group(0)).get("unanswered") if m else None
    except (ValueError, TypeError):
        return []
    return [str(q).strip()[:200] for q in items if str(q).strip()][:5] if isinstance(items, list) else []


def fallback(turns: list[dict]) -> str | None:
    """A plain summary from the transcript itself, for when no AI model could write one."""
    spoken = [t for t in turns if t.get("text")]
    caller = next((t["text"] for t in spoken if t["who"] == "caller"), None)
    if not caller:
        return None
    shortened = caller if len(caller) <= 110 else caller[:107].rsplit(" ", 1)[0] + "..."
    return f'The caller started with: "{shortened}". {len(spoken)} messages were exchanged.'


async def get(session, run_id: int) -> ProductCallInsightModel | None:
    return await session.get(ProductCallInsightModel, run_id)


async def sentiments(session, run_ids: list[int]) -> dict[int, int | None]:
    if not run_ids:
        return {}
    rows = await session.execute(select(ProductCallInsightModel.run_id, ProductCallInsightModel.sentiment).where(ProductCallInsightModel.run_id.in_(run_ids)))
    return {r: s for r, s in rows.all()}


async def ensure(session, llm, *, workspace_id: int, org_id: int, user_id: int, run_id: int, turns: list[dict]) -> ProductCallInsightModel | None:
    """Return the saved insight, creating it from the transcript the first time. None when there is nothing to summarise or no model answers."""
    existing = await get(session, run_id)
    if existing is not None or len(turns) < 2:
        return existing
    transcript = "\n".join(f"{'Agent' if t['who'] == 'agent' else 'Caller'}: {t['text']}" for t in turns if t.get("text"))[:6000]
    try:
        raw = await llm.complete(org_id, user_id, SYSTEM, [{"role": "user", "content": transcript}])
        parsed = parse(raw)
    except Exception:  # noqa: BLE001 - no model available: show the call without a summary and try again next time
        return None
    if parsed is None:
        return None
    row = ProductCallInsightModel(run_id=run_id, workspace_id=workspace_id, summary=parsed[0], sentiment=parsed[1], unanswered=unanswered_of(raw))
    session.add(row)
    await session.commit()
    return row
