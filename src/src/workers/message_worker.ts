// Standalone background worker for high-throughput message processing.
// Run this separately: npm run worker
// The webhook just enqueues to Redis; this worker processes them.

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from 'redis';
import { processTutorMessage } from '../agents/crew';
import { sendTextMessage } from '../whatsapp/sender';
import { initializeDatabase } from '../db/client';
import { eventBus } from '../events/bus';
import { logger } from '../middleware/logger';

const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });

async function run(): Promise<void> {
  await initializeDatabase();
  await redis.connect();
  await eventBus.connect();

  logger.info('[Worker] Message worker started');

  while (true) {
    try {
      const job = await redis.brPop('waxprep:message_queue', 5);
      if (!job) continue;

      const payload = JSON.parse(job.element) as {
        studentId: string;
        sessionId: string;
        rawMessage: string;
        messageId: string;
        modality: 'text' | 'image' | 'audio' | 'document' | 'video';
        mediaId?: string;
        mediaCaption?: string;
        phoneNumberId: string;
        isFirstMessage: boolean;
      };

      logger.info(`[Worker] Processing message from ${payload.studentId}`);

      const responseText = await processTutorMessage(payload);

      if (responseText && payload.phoneNumberId) {
        await sendTextMessage(payload.phoneNumberId, payload.studentId, responseText);
      }
    } catch (err) {
      logger.error('[Worker] Job error:', err);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

run().catch(err => {
  logger.error('[Worker] Fatal error:', err);
  process.exit(1);
});