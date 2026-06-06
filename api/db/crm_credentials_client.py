import json
from datetime import UTC, datetime
from typing import Any, Dict, List, Optional
from sqlalchemy.future import select

from api.db.base_client import BaseDBClient
from api.db.models import CRMCredentialModel
from api.utils.encryption import encrypt_json, decrypt_json


class CRMCredentialClient(BaseDBClient):
    async def get_crm_credential(
        self,
        organization_id: int,
        provider: str,
    ) -> Optional[CRMCredentialModel]:
        """Retrieve CRM credential for a specific provider and organization."""
        async with self.async_session() as session:
            query = select(CRMCredentialModel).where(
                CRMCredentialModel.organization_id == organization_id,
                CRMCredentialModel.provider == provider,
            )
            result = await session.execute(query)
            return result.scalar_one_or_none()

    async def list_crm_credentials(
        self,
        organization_id: int,
    ) -> List[CRMCredentialModel]:
        """List all CRM credentials for an organization."""
        async with self.async_session() as session:
            query = select(CRMCredentialModel).where(
                CRMCredentialModel.organization_id == organization_id
            )
            result = await session.execute(query)
            return list(result.scalars().all())

    async def create_crm_credential(
        self,
        organization_id: int,
        provider: str,
        name: str,
        credentials_data: Dict[str, Any],
    ) -> CRMCredentialModel:
        """Create or replace a CRM credential."""
        encrypted_credentials = encrypt_json(credentials_data)
        
        async with self.async_session() as session:
            # Check if it already exists
            query = select(CRMCredentialModel).where(
                CRMCredentialModel.organization_id == organization_id,
                CRMCredentialModel.provider == provider,
            )
            result = await session.execute(query)
            existing = result.scalar_one_or_none()

            if existing:
                existing.name = name
                existing.credentials = encrypted_credentials
                existing.is_active = True
                existing.created_at = datetime.now(UTC)
                credential = existing
            else:
                credential = CRMCredentialModel(
                    organization_id=organization_id,
                    provider=provider,
                    name=name,
                    credentials=encrypted_credentials,
                    is_active=True,
                )
                session.add(credential)

            try:
                await session.commit()
            except Exception as e:
                await session.rollback()
                raise e
            await session.refresh(credential)
            return credential

    async def delete_crm_credential(
        self,
        organization_id: int,
        provider: str,
    ) -> bool:
        """Delete CRM credential for a provider."""
        async with self.async_session() as session:
            query = select(CRMCredentialModel).where(
                CRMCredentialModel.organization_id == organization_id,
                CRMCredentialModel.provider == provider,
            )
            result = await session.execute(query)
            credential = result.scalar_one_or_none()
            if not credential:
                return False
            
            await session.delete(credential)
            try:
                await session.commit()
                return True
            except Exception as e:
                await session.rollback()
                raise e
