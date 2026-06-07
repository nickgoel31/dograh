import asyncio
import os
from dotenv import load_dotenv
load_dotenv('api/.env')

from sqlalchemy import select
from api.db import db_client
from api.db.models import OrganizationUsageCycleModel, OrganizationModel

async def main():
    async with db_client.async_session() as session:
        cycles = await session.execute(select(OrganizationUsageCycleModel))
        orgs = await session.execute(select(OrganizationModel))
        org_map = {o.id: o.name for o in orgs.scalars().all()}
        
        for c in cycles.scalars().all():
            print(f"Cycle ID: {c.id}, Org: {org_map.get(c.organization_id)}, Period: {c.period_start} - {c.period_end}, Custom Minutes: {c.custom_minutes_used}, Total Duration: {c.total_duration_seconds}")

if __name__ == "__main__":
    asyncio.run(main())
