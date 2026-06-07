import os
from dotenv import load_dotenv
load_dotenv('api/.env')
import asyncio
from api.db import db_client
from sqlalchemy import select
from api.db.models import OrganizationUsageCycleModel, OrganizationModel, WorkflowRunModel

async def main():
    async with db_client.async_session() as s:
        res = await s.execute(select(OrganizationModel).order_by(OrganizationModel.id.desc()).limit(1))
        org = res.scalar_one_or_none()
        if not org:
            print("No orgs")
            return
        print(f"Org: {org.id} - {org.name}")
        
        # Check cycles
        res = await s.execute(select(OrganizationUsageCycleModel).where(OrganizationUsageCycleModel.organization_id == org.id).order_by(OrganizationUsageCycleModel.id.desc()))
        cycles = res.scalars().all()
        for c in cycles:
            print(f"Cycle: id={c.id}, start={c.period_start}, end={c.period_end}, total_dur={c.total_duration_seconds}, custom={c.custom_minutes_used}")
            
        # Check runs
        res = await s.execute(select(WorkflowRunModel).order_by(WorkflowRunModel.id.desc()).limit(5))
        runs = res.scalars().all()
        for r in runs:
            print(f"Run: id={r.id}, duration={r.call_duration_seconds}, tokens={r.used_dograh_tokens}, cost={r.cost_info}")

asyncio.run(main())
