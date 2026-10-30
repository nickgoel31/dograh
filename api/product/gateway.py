"""The single seam between the product layer and the core platform.

Everything the product needs from the platform's workflow store goes through
``PlatformGateway`` so (a) platform names and shapes stay out of product code
and (b) tests can swap in an in-memory fake.
"""

from typing import Protocol


class PlatformGateway(Protocol):
    async def create_agent(self, org_id: int, user_id: int, name: str, definition: dict) -> int: ...

    async def save_draft(self, org_id: int, agent_ref: int, name: str, definition: dict) -> None: ...

    async def publish(self, org_id: int, agent_ref: int) -> None: ...

    async def published_definition(self, org_id: int, agent_ref: int) -> dict | None: ...

    async def working_definition(self, org_id: int, agent_ref: int) -> dict | None:
        """Draft if one exists, else the published graph."""
        ...

    async def list_versions(self, org_id: int, agent_ref: int) -> list[dict]:
        """Newest first: {number, status, created_at, published_at, definition}."""
        ...

    async def set_model_overrides(self, org_id: int, agent_ref: int, overrides: dict | None) -> None:
        """Set (or clear) the agent's per-agent model/voice overrides on its draft."""
        ...

    async def start_test_run(self, org_id: int, user_id: int, agent_ref: int) -> int:
        """Create a browser test call against the draft (or published) graph."""
        ...

    async def serve_signaling(self, ws, org_id: int, user_id: int, agent_ref: int, run_id: int) -> None:
        """Run the browser<->agent audio signalling on an authenticated, not-yet-accepted socket."""
        ...


class CoreGateway:
    """Real implementation on the core workflow store. Not covered by the SQLite tests."""

    @staticmethod
    def _db():
        from api.db import db_client

        return db_client

    async def create_agent(self, org_id, user_id, name, definition) -> int:
        wf = await self._db().create_workflow(name, definition, user_id, org_id)
        return wf.id

    async def save_draft(self, org_id, agent_ref, name, definition) -> None:
        await self._db().update_workflow(
            agent_ref, name, definition, None, None, organization_id=org_id
        )

    async def publish(self, org_id, agent_ref) -> None:
        db = self._db()
        if await db.get_workflow(agent_ref, organization_id=org_id) is None:
            raise LookupError("agent not found")
        if await db.get_draft_version(agent_ref) is not None:
            await db.publish_workflow_draft(agent_ref)

    async def published_definition(self, org_id, agent_ref) -> dict | None:
        wf = await self._db().get_workflow(agent_ref, organization_id=org_id)
        if wf is None:
            return None
        rel = getattr(wf, "released_definition", None)
        return (rel.workflow_json if rel else wf.workflow_definition) or None

    async def working_definition(self, org_id, agent_ref) -> dict | None:
        db = self._db()
        if await db.get_workflow(agent_ref, organization_id=org_id) is None:
            return None
        draft = await db.get_draft_version(agent_ref)
        if draft is not None:
            return draft.workflow_json
        return await self.published_definition(org_id, agent_ref)

    async def list_versions(self, org_id, agent_ref) -> list[dict]:
        db = self._db()
        if await db.get_workflow(agent_ref, organization_id=org_id) is None:
            raise LookupError("agent not found")
        return [
            {
                "number": v.version_number,
                "status": v.status,
                "created_at": v.created_at,
                "published_at": v.published_at,
                "definition": v.workflow_json or {},
            }
            for v in await db.get_workflow_versions(agent_ref)
            if v.version_number is not None
        ]

    async def set_model_overrides(self, org_id, agent_ref, overrides) -> None:
        db = self._db()
        wf = await db.get_workflow(agent_ref, organization_id=org_id)
        if wf is None:
            raise LookupError("agent not found")
        draft = await db.get_draft_version(agent_ref)
        if draft is not None:
            cfg = dict(draft.workflow_configurations or {})
        else:
            rel = wf.released_definition
            cfg = dict((rel.workflow_configurations if rel else wf.workflow_configurations) or {})
        if overrides:
            cfg["model_overrides"] = overrides
        else:
            cfg.pop("model_overrides", None)
        await db.save_workflow_draft(agent_ref, workflow_configurations=cfg)

    async def start_test_run(self, org_id, user_id, agent_ref) -> int:
        import time

        run = await self._db().create_workflow_run(
            f"TEST-{int(time.time())}", agent_ref, "smallwebrtc", user_id,
            use_draft=True, organization_id=org_id,
        )
        return run.id

    async def serve_signaling(self, ws, org_id, user_id, agent_ref, run_id) -> None:
        from api.routes.webrtc_signaling import signaling_manager

        user = await self._db().get_user_by_id(user_id)
        if user is None:
            await ws.close(code=1008, reason="session_expired")
            return
        # The platform scopes quota and config lookups by the user's active org.
        user.selected_organization_id = org_id
        await signaling_manager.handle_websocket(ws, agent_ref, run_id, user)


_gateway: PlatformGateway = CoreGateway()


def get_gateway() -> PlatformGateway:
    return _gateway
