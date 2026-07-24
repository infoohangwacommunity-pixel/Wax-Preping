/**
 * Rate limiter with Redis-backed sliding window.
 * Falls back to in-memory if Redis is unavailable.
 */
import { getRedis } from '../db/redis';
import { logger } from './logger';

const inMemory = new Map<string, { count: number; resetAt: number }>();

function sweepInMemory(): void {
  const now = Date.now();
  for (const [key, entry] of inMemory) {
    if (entry.resetAt <= now) inMemory.delete(key);
  }
}

export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<{ allowed: boolean }> {
  const now = Date.now();

  try {
    const redis = await getRedis();
    if (redis) {
      const redisKey = `ratelimit:${key}`;
      const results = await redis
        .multi()
        .incr(redisKey)
        .expire(redisKey, windowSeconds)
        .exec();

      const count = (results?.[0] as number | null) ?? 0;
      return { allowed: count <= maxRequests };
    }
  } catch (err) {
    logger.warn({ err }, '[RateLimiter] Redis error, falling back to in-memory');
  }

  sweepInMemory();

  const entry = inMemory.get(key);
  if (!entry || entry.resetAt <= now) {
    inMemory.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true };
  }

  entry.count++;
  return { allowed: entry.count <= maxRequests };
}
