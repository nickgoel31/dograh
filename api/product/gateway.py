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


_gateway: PlatformGateway = CoreGateway()


def get_gateway() -> PlatformGateway:
    return _gateway
