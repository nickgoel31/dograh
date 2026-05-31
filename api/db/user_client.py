import uuid
from datetime import datetime, timezone

from loguru import logger
from pydantic import ValidationError
from sqlalchemy.future import select

from api.db.base_client import BaseDBClient
from api.db.models import UserConfigurationModel, UserModel
from api.schemas.user_configuration import UserConfiguration


class UserClient(BaseDBClient):
    async def get_or_create_user_by_provider_id(
        self, provider_id: str
    ) -> tuple[UserModel, bool]:
        """Return (user, was_created) tuple."""
        async with self.async_session() as session:
            # First try to get existing user
            result = await session.execute(
                select(UserModel).where(UserModel.provider_id == provider_id)
            )
            user = result.scalars().first()

            if user is not None:
                return user, False

            # Use PostgreSQL's INSERT ... ON CONFLICT DO NOTHING
            # This is atomic and handles race conditions at the database level
            from sqlalchemy.dialects.postgresql import insert

            stmt = insert(UserModel.__table__).values(
                provider_id=provider_id,
                created_at=datetime.now(timezone.utc),
                selected_organization_id=None,  # Will be set later
                is_superuser=False,  # Default value
            )
            # ON CONFLICT DO NOTHING - if another request already inserted, this becomes a no-op
            stmt = stmt.on_conflict_do_nothing(index_elements=["provider_id"])

            result = await session.execute(stmt)
            await session.commit()
            was_created = result.rowcount > 0

            # Now fetch the user (either the one we just created or the one that existed)
            result = await session.execute(
                select(UserModel).where(UserModel.provider_id == provider_id)
            )
            user = result.scalars().first()

            if user is None:
                # This should never happen, but handle it just in case
                error_msg = (
                    f"Failed to create or fetch user with provider_id {provider_id}"
                )
                raise ValueError(error_msg)
        return user, was_created

    async def get_user_by_id(self, user_id: int) -> UserModel | None:
        """Fetch a user by their internal ID."""
        async with self.async_session() as session:
            result = await session.execute(
                select(UserModel).where(UserModel.id == user_id)
            )
            return result.scalars().first()

    async def get_user_configurations(self, user_id: int) -> UserConfiguration:
        async with self.async_session() as session:
            result = await session.execute(
                select(UserConfigurationModel).where(
                    UserConfigurationModel.user_id == user_id
                )
            )
            configuration_obj = result.scalars().first()
            if not configuration_obj:
                return UserConfiguration()

            try:
                return UserConfiguration.model_validate(
                    {
                        **configuration_obj.configuration,
                        "last_validated_at": configuration_obj.last_validated_at,
                    }
                )
            except ValidationError as e:
                # If configuration contains an unsupported provider,
                # return a default configuration without failing
                logger.warning(
                    f"Failed to validate user configuration for user {user_id}: {e}. "
                    "Returning default configuration."
                )
                return UserConfiguration()

    async def update_user_configuration(
        self, user_id: int, configuration: UserConfiguration
    ) -> UserConfiguration:
        async with self.async_session() as session:
            result = await session.execute(
                select(UserConfigurationModel).where(
                    UserConfigurationModel.user_id == user_id
                )
            )
            configuration_obj = result.scalars().first()
            if not configuration_obj:
                configuration_obj = UserConfigurationModel(
                    user_id=user_id, configuration=configuration.model_dump()
                )
                session.add(configuration_obj)
            else:
                configuration_obj.configuration = configuration.model_dump()
            try:
                await session.commit()
            except Exception as e:
                await session.rollback()
                raise e
            await session.refresh(configuration_obj)
        return UserConfiguration.model_validate(configuration_obj.configuration)

    async def update_user_configuration_last_validated_at(self, user_id: int) -> None:
        async with self.async_session() as session:
            result = await session.execute(
                select(UserConfigurationModel).where(
                    UserConfigurationModel.user_id == user_id
                )
            )
            configuration_obj = result.scalars().first()
            if not configuration_obj:
                raise ValueError(f"User configuration with ID {user_id} not found")
            configuration_obj.last_validated_at = datetime.now()
            try:
                await session.commit()
            except Exception as e:
                await session.rollback()
                raise e
            await session.refresh(configuration_obj)

    async def update_user_selected_organization(
        self, user_id: int, organization_id: int
    ) -> None:
        """Update the user's selected organization ID."""
        async with self.async_session() as session:
            from sqlalchemy import update

            # Use a direct UPDATE statement to avoid race conditions
            # This is atomic at the database level
            stmt = (
                update(UserModel)
                .where(UserModel.id == user_id)
                .values(selected_organization_id=organization_id)
            )

            result = await session.execute(stmt)

            if result.rowcount == 0:
                raise ValueError(f"User with ID {user_id} not found")

            await session.commit()

    async def update_user_email(self, user_id: int, email: str) -> None:
        """Update the user's email address."""
        async with self.async_session() as session:
            from sqlalchemy import update

            stmt = update(UserModel).where(UserModel.id == user_id).values(email=email)
            await session.execute(stmt)
            await session.commit()

    async def get_user_by_email(self, email: str) -> UserModel | None:
        """Fetch a user by their email address."""
        async with self.async_session() as session:
            result = await session.execute(
                select(UserModel).where(UserModel.email == email)
            )
            return result.scalars().first()

    async def create_user_with_email(
        self, email: str, password_hash: str, name: str | None = None, role: str = "admin"
    ) -> UserModel:
        """Create a new user with email and password hash."""
        async with self.async_session() as session:
            user = UserModel(
                provider_id=f"oss_{int(datetime.now(timezone.utc).timestamp())}_{uuid.uuid4()}",
                email=email,
                password_hash=password_hash,
                role=role,
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
            return user

    async def get_all_users_paginated(self, page: int = 1, limit: int = 50) -> tuple[list[UserModel], int]:
        """Fetch all users paginated for superadmin view."""
        async with self.async_session() as session:
            from sqlalchemy import func
            
            # Count total
            count_stmt = select(func.count()).select_from(UserModel)
            total_count = (await session.execute(count_stmt)).scalar() or 0
            
            # Get users
            stmt = select(UserModel).offset((page - 1) * limit).limit(limit).order_by(UserModel.id.desc())
            result = await session.execute(stmt)
            users = result.scalars().all()
            return list(users), total_count

    async def update_user_role_and_superuser(
        self, user_id: int, role: str | None = None, is_superuser: bool | None = None
    ) -> UserModel:
        """Update a user's role and/or superuser status."""
        async with self.async_session() as session:
            result = await session.execute(
                select(UserModel).where(UserModel.id == user_id)
            )
            user = result.scalars().first()
            if not user:
                raise ValueError(f"User with ID {user_id} not found")
            
            if role is not None:
                user.role = role
            if is_superuser is not None:
                user.is_superuser = is_superuser
                
            await session.commit()
            await session.refresh(user)
            return user

    async def get_users_by_organization_id(self, organization_id: int) -> list[UserModel]:
        """Fetch all users associated with a specific organization."""
        async with self.async_session() as session:
            from api.db.models import organization_users_association
            stmt = (
                select(UserModel)
                .join(organization_users_association)
                .where(organization_users_association.c.organization_id == organization_id)
            )
            result = await session.execute(stmt)
            return list(result.scalars().all())

    async def remove_user_from_organization(self, user_id: int, organization_id: int) -> None:
        """Remove a user from an organization association."""
        async with self.async_session() as session:
            from api.db.models import organization_users_association
            from sqlalchemy import delete
            stmt = delete(organization_users_association).where(
                (organization_users_association.c.user_id == user_id) &
                (organization_users_association.c.organization_id == organization_id)
            )
            await session.execute(stmt)
            await session.commit()
