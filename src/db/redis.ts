import { createClient, RedisClientType } from 'redis';
import { logger } from '../middleware/logger';

let connectPromise: Promise<RedisClientType | null> | null = null;

export async function getRedis(): Promise<RedisClientType | null> {
  if (!process.env.REDIS_URL) return null;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    try {
      const client = createClient({
        url: process.env.REDIS_URL,
        socket: {
          connectTimeout: 10_000,
          reconnectStrategy: (retries: number) => {
            if (retries > 20) {
              logger.error('[Redis] Max reconnection retries reached');
              return new Error('Max retries');
            }
            const delay = Math.min(retries * 500, 10_000);
            logger.warn({ retries, delay }, '[Redis] Reconnecting');
            return delay;
          },
        },
      }) as RedisClientType;
      client.on('error', err => logger.warn({ err }, '[Redis] Connection error'));
      await client.connect();
      logger.info('[Redis] Connected');
      return client;
    } catch (err) {
      logger.error({ err }, '[Redis] Connection failed');
      connectPromise = null;
      return null;
    }
  })();

  return connectPromise;
}
