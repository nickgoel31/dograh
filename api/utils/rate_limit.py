"""Small fixed-window rate limiter shared across workers.

Backed by Redis so the counter is global across uvicorn workers; if Redis is
unreachable it degrades to a per-process counter instead of failing requests.
"""

import time
from collections import defaultdict

import redis.asyncio as aioredis
from fastapi import HTTPException
from loguru import logger

from api.constants import REDIS_URL

_redis: aioredis.Redis | None = None
_local_hits: dict[str, list[float]] = defaultdict(list)


async def _get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    return _redis


async def hit(key: str, limit: int, window_seconds: int) -> bool:
    """Record a hit for ``key``. Returns True while within ``limit``."""
    try:
        client = await _get_redis()
        redis_key = f"rl:{key}"
        count = await client.incr(redis_key)
        if count == 1:
            await client.expire(redis_key, window_seconds)
        return count <= limit
    except Exception as exc:  # noqa: BLE001 - never fail a request on limiter errors
        logger.warning(f"Redis rate limiter unavailable, using local fallback: {exc}")
        now = time.time()
        hits = [t for t in _local_hits[key] if now - t < window_seconds]
        hits.append(now)
        _local_hits[key] = hits
        return len(hits) <= limit


async def enforce(
    key: str, limit: int, window_seconds: int, detail: str = "Too many requests"
) -> None:
    """Raise HTTP 429 when ``key`` exceeds ``limit`` hits per window."""
    if not await hit(key, limit, window_seconds):
        raise HTTPException(status_code=429, detail=detail)
