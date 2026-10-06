from datetime import UTC, datetime

from sqlalchemy import func, or_
from sqlalchemy.future import select

from api.db.base_client import BaseDBClient
from api.db.models import ModelProfileModel, OrganizationModel

_PROFILE_FIELDS = {
    "slug",
    "display_name",
    "description",
    "tier",
    "capabilities",
    "config",
    "allowed_org_ids",
    "is_active",
}


class ResellerClient(BaseDBClient):
    """Model profiles and reseller / client organization tenancy."""

    # ------------------------------------------------------------------ profiles
    async def list_model_profiles(self, active_only: bool = False) -> list[ModelProfileModel]:
        async with self.async_session() as session:
            q = select(ModelProfileModel).order_by(ModelProfileModel.display_name)
            if active_only:
                q = q.where(ModelProfileModel.is_active.is_(True))
            return list((await session.execute(q)).scalars().all())

    async def get_model_profile(self, profile_id: int) -> ModelProfileModel | None:
        async with self.async_session() as session:
            return await session.get(ModelProfileModel, profile_id)

    async def list_model_profiles_for_org(self, organization_id: int) -> list[ModelProfileModel]:
        """Active profiles an organization may choose from."""
        return [
            p
            for p in await self.list_model_profiles(active_only=True)
            if not p.allowed_org_ids or organization_id in p.allowed_org_ids
        ]

    async def create_model_profile(self, **fields) -> ModelProfileModel:
        async with self.async_session() as session:
            profile = ModelProfileModel(
                **{k: v for k, v in fields.items() if k in _PROFILE_FIELDS}
            )
            session.add(profile)
            await session.commit()
            await session.refresh(profile)
            return profile

    async def update_model_profile(self, profile_id: int, **fields) -> ModelProfileModel:
        async with self.async_session() as session:
            profile = await session.get(ModelProfileModel, profile_id)
            if profile is None:
                raise ValueError("Model profile not found")
            for key, value in fields.items():
                if key in _PROFILE_FIELDS:
                    setattr(profile, key, value)
            profile.updated_at = datetime.now(UTC)
            await session.commit()
            await session.refresh(profile)
            return profile

    async def delete_model_profile(self, profile_id: int) -> None:
        async with self.async_session() as session:
            in_use = (
                await session.execute(
                    select(func.count(OrganizationModel.id)).where(
                        OrganizationModel.model_profile_id == profile_id
                    )
                )
            ).scalar_one()
            if in_use:
                raise ValueError(
                    f"Profile is assigned to {in_use} organization(s); reassign them first"
                )
            profile = await session.get(ModelProfileModel, profile_id)
            if profile is not None:
                await session.delete(profile)
                await session.commit()

    # ------------------------------------------------------------------ tenancy
    async def list_child_organizations(self, parent_id: int) -> list[OrganizationModel]:
        async with self.async_session() as session:
            return list(
                (
                    await session.execute(
                        select(OrganizationModel)
                        .where(OrganizationModel.parent_org_id == parent_id)
                        .order_by(OrganizationModel.name)
                    )
                )
                .scalars()
                .all()
            )

    async def count_child_organizations(self, parent_id: int) -> int:
        async with self.async_session() as session:
            return (
                await session.execute(
                    select(func.count(OrganizationModel.id)).where(
                        OrganizationModel.parent_org_id == parent_id
                    )
                )
            ).scalar_one()

    async def get_child_organization(
        self, parent_id: int, child_id: int
    ) -> OrganizationModel | None:
        """A child org, only if it really belongs to ``parent_id`` (tenant check)."""
        async with self.async_session() as session:
            return (
                await session.execute(
                    select(OrganizationModel).where(
                        OrganizationModel.id == child_id,
                        OrganizationModel.parent_org_id == parent_id,
                    )
                )
            ).scalar_one_or_none()

    async def organization_name_or_slug_taken(self, name: str, slug: str) -> bool:
        async with self.async_session() as session:
            return (
                await session.execute(
                    select(OrganizationModel.id).where(
                        or_(OrganizationModel.name == name, OrganizationModel.slug == slug)
                    )
                )
            ).first() is not None

    async def create_child_organization(self, **fields) -> OrganizationModel:
        async with self.async_session() as session:
            org = OrganizationModel(**fields)
            session.add(org)
            await session.commit()
            await session.refresh(org)
            return org

    async def update_organization_fields(self, organization_id: int, **fields) -> OrganizationModel:
        async with self.async_session() as session:
            org = await session.get(OrganizationModel, organization_id)
            if org is None:
                raise ValueError("Organization not found")
            for key, value in fields.items():
                setattr(org, key, value)
            await session.commit()
            await session.refresh(org)
            return org
