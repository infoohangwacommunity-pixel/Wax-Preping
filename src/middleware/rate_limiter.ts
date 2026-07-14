import { createClient } from 'redis';
import { logger } from './logger';

const redis = createClient({ url: process.env.REDIS_URL });
let connected = false;
const inMemory: Map<string, { count: number; resetAt: number }> = new Map();

redis.connect().then(() => { connected = true; }).catch(() => {
  logger.warn('[RateLimiter] Redis unavailable — using in-memory');
});

export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const resetAt = now + windowMs;

  if (!connected) {
    const entry = inMemory.get(key);
    if (!entry || entry.resetAt < now) {
      inMemory.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: maxRequests - 1, resetAt };
    }
    entry.count++;
    return {
      allowed: entry.count <= maxRequests,
      remaining: Math.max(0, maxRequests - entry.count),
      resetAt: entry.resetAt,
    };
  }

  try {
    const multi = redis.multi();
    multi.incr(key);
    multi.expire(key, windowSeconds);
    const results = await multi.exec();
    const count = results![0] as number;
    return {
      allowed: count <= maxRequests,
      remaining: Math.max(0, maxRequests - count),
      resetAt,
    };
  } catch {
    return { allowed: true, remaining: maxRequests, resetAt };
  }
}