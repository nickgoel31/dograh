import time
import uuid
from typing import Optional

import redis.asyncio as aioredis
from loguru import logger

from api.constants import REDIS_URL


class RateLimiter:
    """Sliding window rate limiter to enforce strict per-second limits and concurrent call limits"""

    def __init__(self):
        self.redis_client: Optional[aioredis.Redis] = None
        self.stale_call_timeout = 1200  # 20 minutes in seconds

    async def _get_redis(self) -> aioredis.Redis:
        """Get or create Redis connection"""
        if self.redis_client is None:
            self.redis_client = await aioredis.from_url(
                REDIS_URL, decode_responses=True
            )
        return self.redis_client

    async def acquire_token(self, organization_id: int, rate_limit: int = 1) -> bool:
        """
        Enforces strict rate limit: max N calls per rolling second window
        Returns True if allowed, False if rate limited
        """
        redis_client = await self._get_redis()

        key = f"rate_limit:{organization_id}"
        now = time.time()
        window_start = now - 1.0  # 1 second sliding window

        # Lua script for atomic sliding window operation
        lua_script = """
        local key = KEYS[1]
        local now = tonumber(ARGV[1])
        local window_start = tonumber(ARGV[2])
        local max_requests = tonumber(ARGV[3])
        
        -- Remove timestamps older than window
        redis.call('ZREMRANGEBYSCORE', key, 0, window_start)
        
        -- Count requests in current window
        local current_requests = redis.call('ZCARD', key)
        
        if current_requests < max_requests then
            -- Add current timestamp
            redis.call('ZADD', key, now, now)
            redis.call('EXPIRE', key, 2)  -- Expire after 2 seconds
            return 1
        else
            return 0
        end
        """

        try:
            result = await redis_client.eval(
                lua_script, 1, key, now, window_start, rate_limit
            )
            return bool(result)
        except Exception as e:
            logger.error(f"Rate limiter error: {e}")
            # On error, be conservative and deny
            return False

    async def get_next_available_slot(
        self, organization_id: int, rate_limit: int = 1
    ) -> float:
        """
        Returns seconds until next available slot
        Useful for implementing retry with backoff
        """
        redis_client = await self._get_redis()

        key = f"rate_limit:{organization_id}"

        try:
            # Get oldest timestamp in current window
            oldest = await redis_client.zrange(key, 0, 0, withscores=True)
            if not oldest:
                return 0.0  # Can call immediately

            oldest_time = oldest[0][1]
            next_available = oldest_time + 1.0  # 1 second after oldest
            wait_time = max(0, next_available - time.time())

            return wait_time
        except Exception as e:
            logger.error(f"Rate limiter get_next_available_slot error: {e}")
            return 1.0  # Default wait time on error

    async def try_acquire_concurrent_slot(
        self, organization_id: int, workflow_id: int, org_max_concurrent: int, agent_max_concurrent: int
    ) -> Optional[str]:
        """
        Try to acquire a concurrent call slot.
        Returns a unique slot_id if successful, None if limit reached for either org or agent.
        """
        redis_client = await self._get_redis()

        org_concurrent_key = f"concurrent_calls:org:{organization_id}"
        agent_concurrent_key = f"concurrent_calls:agent:{workflow_id}"
        now = time.time()
        stale_cutoff = now - self.stale_call_timeout

        # Lua script for atomic operation
        lua_script = """
        local org_key = KEYS[1]
        local agent_key = KEYS[2]
        local now = tonumber(ARGV[1])
        local org_max = tonumber(ARGV[2])
        local agent_max = tonumber(ARGV[3])
        local stale_cutoff = tonumber(ARGV[4])
        local slot_id = ARGV[5]
        
        -- Remove stale entries (older than 30 minutes)
        redis.call('ZREMRANGEBYSCORE', org_key, 0, stale_cutoff)
        redis.call('ZREMRANGEBYSCORE', agent_key, 0, stale_cutoff)
        
        -- Get current count
        local org_count = redis.call('ZCARD', org_key)
        local agent_count = redis.call('ZCARD', agent_key)
        
        if org_count < org_max and agent_count < agent_max then
            -- Add new slot to both
            redis.call('ZADD', org_key, now, slot_id)
            redis.call('EXPIRE', org_key, 3600)  -- Expire after 1 hour
            
            redis.call('ZADD', agent_key, now, slot_id)
            redis.call('EXPIRE', agent_key, 3600)
            return slot_id
        else
            return nil
        end
        """

        # Generate unique slot ID (timestamp + random component)
        slot_id = f"{int(now * 1000)}_{uuid.uuid4().hex[:8]}"

        try:
            result = await redis_client.eval(
                lua_script,
                2,
                org_concurrent_key,
                agent_concurrent_key,
                now,
                org_max_concurrent,
                agent_max_concurrent,
                stale_cutoff,
                slot_id,
            )
            return result
        except Exception as e:
            logger.error(f"Concurrent limiter error: {e}")
            return None

    async def release_concurrent_slot(self, organization_id: int, workflow_id: int, slot_id: str) -> bool:
        """
        Release a concurrent call slot.
        Returns True if slot was released from org and agent pools, False otherwise.
        """
        if not slot_id:
            return False

        redis_client = await self._get_redis()
        org_concurrent_key = f"concurrent_calls:org:{organization_id}"
        agent_concurrent_key = f"concurrent_calls:agent:{workflow_id}"

        try:
            removed_org = await redis_client.zrem(org_concurrent_key, slot_id)
            removed_agent = await redis_client.zrem(agent_concurrent_key, slot_id)
            if removed_org or removed_agent:
                logger.debug(
                    f"Released concurrent slot {slot_id} for org {organization_id} and workflow {workflow_id}"
                )
            return bool(removed_org or removed_agent)
        except Exception as e:
            logger.error(f"Error releasing concurrent slot: {e}")
            return False

    async def get_concurrent_count(self, organization_id: int, workflow_id: int = None) -> int:
        """
        Get current number of active concurrent calls for an organization or workflow.
        Automatically cleans up stale entries.
        """
        redis_client = await self._get_redis()
        if workflow_id:
            concurrent_key = f"concurrent_calls:agent:{workflow_id}"
        else:
            concurrent_key = f"concurrent_calls:org:{organization_id}"

        try:
            # Clean up stale entries first
            stale_cutoff = time.time() - self.stale_call_timeout
            await redis_client.zremrangebyscore(concurrent_key, 0, stale_cutoff)

            # Get current count
            count = await redis_client.zcard(concurrent_key)
            return count
        except Exception as e:
            logger.error(f"Error getting concurrent count: {e}")
            return 0

    async def store_workflow_slot_mapping(
        self, workflow_run_id: int, organization_id: int, workflow_id: int, slot_id: str
    ) -> bool:
        """
        Store the mapping between workflow_run_id and its concurrent slot.
        Used for cleanup when calls complete.
        """
        redis_client = await self._get_redis()
        mapping_key = f"workflow_slot_mapping:{workflow_run_id}"

        try:
            # Store as a hash with TTL
            await redis_client.hset(
                mapping_key, mapping={"org_id": organization_id, "workflow_id": workflow_id, "slot_id": slot_id}
            )
            # Set expiry to match stale timeout
            await redis_client.expire(mapping_key, self.stale_call_timeout)
            return True
        except Exception as e:
            logger.error(f"Error storing workflow slot mapping: {e}")
            return False

    async def get_workflow_slot_mapping(
        self, workflow_run_id: int
    ) -> Optional[tuple[int, int, str]]:
        """
        Get the concurrent slot mapping for a workflow run.
        Returns (organization_id, workflow_id, slot_id) tuple or None if not found.
        """
        redis_client = await self._get_redis()
        mapping_key = f"workflow_slot_mapping:{workflow_run_id}"

        try:
            mapping = await redis_client.hgetall(mapping_key)
            if mapping and "org_id" in mapping and "slot_id" in mapping:
                return (int(mapping["org_id"]), int(mapping.get("workflow_id", 0)), mapping["slot_id"])
            return None
        except Exception as e:
            logger.error(f"Error getting workflow slot mapping: {e}")
            return None

    async def delete_workflow_slot_mapping(self, workflow_run_id: int) -> bool:
        """
        Delete the workflow slot mapping after releasing the slot.
        """
        redis_client = await self._get_redis()
        mapping_key = f"workflow_slot_mapping:{workflow_run_id}"

        try:
            deleted = await redis_client.delete(mapping_key)
            return bool(deleted)
        except Exception as e:
            logger.error(f"Error deleting workflow slot mapping: {e}")
            return False

    # ======== FROM NUMBER POOL METHODS ========

    @staticmethod
    def _from_number_pool_key(
        organization_id: int, telephony_configuration_id: int | None
    ) -> str:
        return f"from_number_pool:{organization_id}:{telephony_configuration_id}"

    async def initialize_from_number_pool(
        self,
        organization_id: int,
        from_numbers: list[str],
        telephony_configuration_id: int | None,
    ) -> bool:
        """
        Initialize the from_number pool for an organization + telephony config.
        Uses ZADD NX so it won't overwrite numbers that are already in use.

        Pools are scoped per (organization_id, telephony_configuration_id) so
        that orgs with multiple telephony configurations do not leak caller IDs
        across configs.
        """
        if not from_numbers:
            return False

        redis_client = await self._get_redis()
        key = self._from_number_pool_key(organization_id, telephony_configuration_id)

        try:
            # ZADD NX: only add members that don't already exist (preserves in-use scores)
            members = {number: 0 for number in from_numbers}
            await redis_client.zadd(key, members, nx=True)
            await redis_client.expire(key, 3600)  # 1 hour TTL
            return True
        except Exception as e:
            logger.error(f"Error initializing from_number pool: {e}")
            return False

    async def acquire_from_number(
        self, organization_id: int, telephony_configuration_id: int | None
    ) -> Optional[str]:
        """
        Acquire a from_number from the pool.
        Since phone numbers can support multiple concurrent calls, we select a random
        number from the pool of configured numbers.
        """
        redis_client = await self._get_redis()
        key = self._from_number_pool_key(organization_id, telephony_configuration_id)

        try:
            # Retrieve all configured phone numbers from the sorted set
            available = await redis_client.zrange(key, 0, -1)
            if not available:
                return None
            import random
            chosen = random.choice(available)
            logger.debug(f"Acquired from_number {chosen} for org {organization_id} (non-exclusive)")
            return chosen
        except Exception as e:
            logger.error(f"Error acquiring from_number: {e}")
            return None

    async def release_from_number(
        self,
        organization_id: int,
        from_number: str,
        telephony_configuration_id: int | None,
    ) -> bool:
        """
        Release a from_number back to its (org, telephony config) pool by
        setting its score to 0. Harmless if already released (score already 0).
        """
        if not from_number:
            return False

        redis_client = await self._get_redis()
        key = self._from_number_pool_key(organization_id, telephony_configuration_id)

        lua_script = """
        local key = KEYS[1]
        local from_number = ARGV[1]

        local score = redis.call('ZSCORE', key, from_number)
        if score then
            redis.call('ZADD', key, 0, from_number)
            return 1
        end
        return 0
        """

        try:
            result = await redis_client.eval(lua_script, 1, key, from_number)
            if result:
                logger.debug(
                    f"Released from_number {from_number} for org {organization_id}"
                )
            return bool(result)
        except Exception as e:
            logger.error(f"Error releasing from_number: {e}")
            return False

    async def store_workflow_from_number_mapping(
        self,
        workflow_run_id: int,
        organization_id: int,
        from_number: str,
        telephony_configuration_id: int | None,
    ) -> bool:
        """
        Store the mapping between workflow_run_id and its from_number, plus
        the telephony_configuration_id so cleanup can release back to the
        correct pool.
        """
        redis_client = await self._get_redis()
        mapping_key = f"workflow_from_number:{workflow_run_id}"

        try:
            # Redis hashes can't store None — use empty string sentinel for legacy
            # campaigns whose telephony_configuration_id has not been backfilled.
            tcid_value = (
                "" if telephony_configuration_id is None else telephony_configuration_id
            )
            await redis_client.hset(
                mapping_key,
                mapping={
                    "org_id": organization_id,
                    "from_number": from_number,
                    "telephony_configuration_id": tcid_value,
                },
            )
            await redis_client.expire(mapping_key, 1800)  # 30 min TTL
            return True
        except Exception as e:
            logger.error(f"Error storing workflow from_number mapping: {e}")
            return False

    async def get_workflow_from_number_mapping(
        self, workflow_run_id: int
    ) -> Optional[tuple[int, str, int | None]]:
        """
        Get the from_number mapping for a workflow run.
        Returns (organization_id, from_number, telephony_configuration_id) or
        None if not found. telephony_configuration_id is None for legacy entries.
        """
        redis_client = await self._get_redis()
        mapping_key = f"workflow_from_number:{workflow_run_id}"

        try:
            mapping = await redis_client.hgetall(mapping_key)
            if mapping and "org_id" in mapping and "from_number" in mapping:
                raw_tcid = mapping.get("telephony_configuration_id", "")
                tcid = int(raw_tcid) if raw_tcid not in (None, "") else None
                return (int(mapping["org_id"]), mapping["from_number"], tcid)
            return None
        except Exception as e:
            logger.error(f"Error getting workflow from_number mapping: {e}")
            return None

    async def delete_workflow_from_number_mapping(self, workflow_run_id: int) -> bool:
        """
        Delete the workflow from_number mapping after releasing the number.
        """
        redis_client = await self._get_redis()
        mapping_key = f"workflow_from_number:{workflow_run_id}"

        try:
            deleted = await redis_client.delete(mapping_key)
            return bool(deleted)
        except Exception as e:
            logger.error(f"Error deleting workflow from_number mapping: {e}")
            return False

    async def close(self):
        """Close Redis connection"""
        if self.redis_client:
            await self.redis_client.close()
            self.redis_client = None


# Global rate limiter instance
rate_limiter = RateLimiter()
