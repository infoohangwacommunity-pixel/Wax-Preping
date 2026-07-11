import redis.asyncio as redis
from app.config import get_settings

_redis_pool = None


async def get_redis():
    global _redis_pool
    settings = get_settings()
    if not settings.REDIS_URL:
        return None
    if _redis_pool is None:
        _redis_pool = redis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            max_connections=20
        )
    return _redis_pool


async def close_redis():
    global _redis_pool
    if _redis_pool:
        await _redis_pool.close()
        _redis_pool = None
