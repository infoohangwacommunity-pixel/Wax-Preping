import 'dotenv/config';
import cron from 'node-cron';
import { initializeDatabase } from '../db/client';
import { runNightlyConsolidation } from '../sleep/scheduler';
import { logger } from '../middleware/logger';

initializeDatabase().then(() => {
  cron.schedule('0 3 * * 0', () => runNightlyConsolidation(100).catch(() => {}));
  logger.info('[Compressor] Started — Sundays 3am UTC (sleep mode consolidation)');
});
