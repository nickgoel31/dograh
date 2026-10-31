"""After every finished call, send it to the services the workspace connected (CRM, Slack, Sheets, WhatsApp). Once per call and service."""

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from api.db.models import WorkflowModel, WorkflowRunModel
from api.db.product_models import ProductIntegrationModel, ProductPushModel, ProductWorkspaceModel
from api.product import connectors, emailer, insights
from api.product import contacts as ct
from api.product import conversations as conv
from api.product.ids import encode_call_id

log = logging.getLogger(__name__)
LOOKBACK = timedelta(hours=36)
MOODS = {1: "upset", 2: "unhappy", 3: "neutral", 4: "happy", 5: "delighted"}


async def push_calls(session, llm, transport=None, limit: int = 20) -> int:
    sent = 0
    for ws in (await session.scalars(select(ProductWorkspaceModel))).all():
        rows = [r for r in (await session.scalars(select(ProductIntegrationModel).where(ProductIntegrationModel.workspace_id == ws.id))).all() if connectors.REGISTRY.get(r.kind) and connectors.REGISTRY[r.kind].push]
        if not rows:
            continue
        runs = (await session.scalars(
            select(WorkflowRunModel).join(WorkflowModel, WorkflowRunModel.workflow_id == WorkflowModel.id)
            .where(WorkflowModel.organization_id == ws.live_org_id, WorkflowRunModel.is_completed.is_(True), WorkflowRunModel.created_at > datetime.now(UTC) - LOOKBACK)
            .order_by(WorkflowRunModel.id.desc()).limit(60))).all()
        for r in runs:
            todo = [x for x in rows if await session.get(ProductPushModel, (r.id, x.kind)) is None]
            if not todo or sent >= limit:
                continue
            turns = conv.build_transcript((r.logs or {}).get("realtime_feedback_events"))
            ins = await insights.ensure(session, llm, workspace_id=ws.id, org_id=ws.live_org_id, user_id=ws.owner_user_id, run_id=r.id, turns=turns)
            name, phone = conv.caller_of(r.initial_context, r.gathered_context)
            ev = {"name": None if name == phone else name, "phone": ct.normalize(phone) or phone, "summary": ins.summary if ins else insights.fallback(turns),
                  "mood": MOODS.get(ins.sentiment or 0) if ins else None, "when": (r.created_at or datetime.now(UTC)).strftime("%Y-%m-%d %H:%M"),
                  "link": f"{emailer.app_url()}/conversations/{encode_call_id(r.id)}"}
            for x in todo:
                ok = True
                try:
                    async with connectors.client(transport) as http:
                        await connectors.REGISTRY[x.kind].push(x.config, http, ev)
                except Exception as e:  # noqa: BLE001 - one broken service must not stop the others; the call is marked so it isn't retried forever
                    ok = False
                    log.warning("push to %s failed: %s", x.kind, e)
                session.add(ProductPushModel(run_id=r.id, kind=x.kind, workspace_id=ws.id, ok=ok))
                sent += ok
            await session.commit()
    return sent
