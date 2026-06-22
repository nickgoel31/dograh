import asyncio
import os
import sys
import argparse
from dotenv import load_dotenv

# Set up environment
load_dotenv("api/.env")

from api.db import db_client
from sqlalchemy.future import select
from api.db.models import CampaignModel, QueuedRunModel
from sqlalchemy import func

async def main():
    async with db_client.async_session() as session:
        # Find campaign
        stmt = select(CampaignModel).where(CampaignModel.name.ilike("%Inmantec Outbound Leads%"))
        result = await session.execute(stmt)
        campaigns = result.scalars().all()
        for campaign in campaigns:
            print(f"Campaign ID: {campaign.id}, Name: {campaign.name}, State: {campaign.state}, Processed: {campaign.processed_rows}, Failed: {campaign.failed_rows}, Total: {campaign.total_rows}")
            
            # Get states of queued runs
            stmt2 = select(QueuedRunModel.state, func.count(QueuedRunModel.id)).where(QueuedRunModel.campaign_id == campaign.id).group_by(QueuedRunModel.state)
            result2 = await session.execute(stmt2)
            states = result2.all()
            print("  Queued Run States:")
            for state, count in states:
                print(f"    {state}: {count}")

            # Get some failed reasons if any
            stmt3 = select(QueuedRunModel.retry_reason).where(QueuedRunModel.campaign_id == campaign.id, QueuedRunModel.state == "failed").group_by(QueuedRunModel.retry_reason)
            result3 = await session.execute(stmt3)
            reasons = result3.scalars().all()
            print("  Failed Retry Reasons:")
            for reason in reasons:
                print(f"    {reason}")
                
            # print error log from orchestrator_metadata or any errors
            if campaign.source_sync_errors:
                print(f"  Sync errors: {campaign.source_sync_errors}")
            
            # Check logs
            from api.db.models import CampaignLogModel
            stmt_logs = select(CampaignLogModel).where(CampaignLogModel.campaign_id == campaign.id).order_by(CampaignLogModel.created_at.desc()).limit(10)
            logs = await session.execute(stmt_logs)
            print("  Recent Logs:")
            for log in logs.scalars().all():
                print(f"    [{log.level}] {log.event}: {log.message}")
            
            print("-" * 40)

if __name__ == "__main__":
    asyncio.run(main())
