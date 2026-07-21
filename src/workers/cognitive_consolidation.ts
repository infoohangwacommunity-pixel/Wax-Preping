/**
 * WaxPrep v3.0 — Cognitive Consolidation Worker
 * Background worker entry point for sleep mode and memory compression.
 */

import 'dotenv/config';
import { startSleepScheduler, runNightlyConsolidation } from '../sleep/scheduler';
import { migrateExistingDataToGraph } from '../graph/migration';
import { initializeDatabase } from '../db/client';
import { logger } from '../middleware/logger';
import { runSleepMode } from '../sleep/pipeline';

const COMMAND = process.argv[2];

async function main(): Promise<void> {
  await initializeDatabase();

  switch (COMMAND) {
    case 'sleep':
      logger.info('[Worker] Starting sleep mode scheduler');
      await startSleepScheduler();
      // Keep process alive
      setInterval(() => {}, 1000 * 60 * 60);
      break;

    case 'run-once':
      logger.info('[Worker] Running one-time consolidation');
      await runNightlyConsolidation(parseInt(process.env.MAX_STUDENTS || '100', 10));
      process.exit(0);
      break;

    case 'migrate-graph':
      logger.info('[Worker] Migrating existing data to graph');
      const result = await migrateExistingDataToGraph();
      logger.info(result, '[Worker] Migration complete');
      process.exit(0);
      break;

    default:
      logger.info('[Worker] No command specified. Usage: tsx src/workers/cognitive_consolidation.ts [sleep|run-once|migrate-graph]');
      process.exit(1);
  }
}

main().catch(err => {
  logger.error({ err }, '[Worker] Fatal error');
  process.exit(1);
});
