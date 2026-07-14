// Memory compression worker — runs weekly.
// Compresses old episodic memories into epoch summaries.
// Run as: npm run compress-memory

import dotenv from 'dotenv';
dotenv.config();

import cron from 'node-cron';
import { db, initializeDatabase } from '../db/client';
import { compressOldEpisodes } from '../memory/compressor';
import { logger } from '../middleware/logger';

async function compressAll(): Promise<void> {
  const result = await db.query(`
    SELECT DISTINCT student_id FROM conversation_turns
    WHERE timestamp < NOW() - INTERVAL '30 days'
  `);

  logger.info(`[Compressor] Compressing ${result.rows.length} students`);

  for (const row of result.rows) {
    try {
      await compressOldEpisodes(row.student_id, 30);
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      logger.error(`[Compressor] Failed for ${row.student_id}:`, err);
    }
  }

  logger.info('[Compressor] Compression cycle complete');
}

initializeDatabase().then(() => {
  // Run every Sunday at 3am UTC
  cron.schedule('0 3 * * 0', () => {
    compressAll().catch(err => logger.error('[Compressor] Cron error:', err));
  });

  logger.info('[Compressor] Memory compressor started — runs weekly on Sunday 3am UTC');
});