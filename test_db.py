import asyncio
from api.db.client import db_client
from api.db.models import CampaignModel, QueuedRunModel
from sqlalchemy import select, func

async def main():
    async with db_client.async_session() as session:
        # Get latest campaign
        q = select(CampaignModel).order_by(CampaignModel.id.desc()).limit(1)
        res = await session.execute(q)
        camp = res.scalar_one_or_none()
        if not camp:
            print("No campaign found")
            return
            
        print(f"Campaign {camp.id} - {camp.name}")
        print(f"total_rows: {camp.total_rows}")
        print(f"processed_rows: {camp.processed_rows}")
        print(f"failed_rows: {camp.failed_rows}")
        print(f"state: {camp.state}")
        
        # Count queued runs by state
        q2 = select(QueuedRunModel.state, func.count(QueuedRunModel.id)).where(QueuedRunModel.campaign_id == camp.id).group_by(QueuedRunModel.state)
        res2 = await session.execute(q2)
        print("Queued runs by state:")
        for row in res2.all():
            print(f"  {row[0]}: {row[1]}")

asyncio.run(main())
