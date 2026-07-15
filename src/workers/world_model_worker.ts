import 'dotenv/config';
import cron from 'node-cron';
import { db, initializeDatabase } from '../db/client';
import { runWorldModel } from '../world_model/predictive_model';
import { logger } from '../middleware/logger';

async function runWorldModelForAllActiveStudents(): Promise<void> {
  const result = await db.query(
    `SELECT student_id FROM student_profiles
     WHERE last_seen_at > NOW() - INTERVAL '7 days'
     AND total_turns > 3
     ORDER BY last_seen_at DESC`
  );

  logger.info(`[WorldModelWorker] Running for ${result.rows.length} students`);

  for (const row of result.rows) {
    await runWorldModel(row.student_id).catch(err =>
      logger.error(`[WorldModelWorker] Failed for ${row.student_id}:`, err)
    );
    await new Promise(r => setTimeout(r, 2000));
  }

  logger.info('[WorldModelWorker] Cycle complete');
}

initializeDatabase().then(() => {
  // Run every 2 hours
  cron.schedule('0 */2 * * *', () => {
    runWorldModelForAllActiveStudents().catch(err =>
      logger.error('[WorldModelWorker] Cron error:', err)
    );
  });

  logger.info('[WorldModelWorker] Started — runs every 2 hours');
  runWorldModelForAllActiveStudents().catch(() => {});
});