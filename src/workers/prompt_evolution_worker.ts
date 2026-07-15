// Prompt evolution worker. Runs weekly.
// Reads performance data and improves prompt components.

import dotenv from 'dotenv';
dotenv.config();

import cron from 'node-cron';
import { db, initializeDatabase } from '../db/client';
import { evolveComponent } from '../prompts/evolution';
import { logger } from '../middleware/logger';

async function runEvolution(): Promise<void> {
  const result = await db.query(
    `SELECT component_id, content FROM prompt_components`
  );

  logger.info(`[PromptEvolution] Checking ${result.rows.length} components`);

  for (const row of result.rows) {
    try {
      const outcome = await evolveComponent(row.component_id, row.content);
      if (outcome.evolved) {
        logger.info(`[PromptEvolution] Evolved ${row.component_id} — improvement: +${(outcome.improvement * 100).toFixed(1)}%`);
      }
      await new Promise(r => setTimeout(r, 3000)); // Rate limiting between evolution calls
    } catch (err) {
      logger.error(`[PromptEvolution] Failed for ${row.component_id}:`, err);
    }
  }

  logger.info('[PromptEvolution] Evolution cycle complete');
}

initializeDatabase().then(() => {
  // Run every Sunday at 2am UTC
  cron.schedule('0 2 * * 0', () => {
    runEvolution().catch(err => logger.error('[PromptEvolution] Cron error:', err));
  });

  logger.info('[PromptEvolution] Worker started — runs Sundays at 2am UTC');

  // Also run immediately if called directly
  if (process.argv.includes('--now')) {
    runEvolution().catch(err => logger.error('[PromptEvolution] Immediate run error:', err));
  }
});