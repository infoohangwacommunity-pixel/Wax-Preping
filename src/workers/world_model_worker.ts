import 'dotenv/config';
import cron from 'node-cron';
import { db, initializeDatabase } from '../db/client';
import { runWorldModel } from '../world_model/predictive_model';
import { logger } from '../middleware/logger';

let running = false;

async function runForAllActive(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await db.query(
      `SELECT student_id FROM conversation_turns WHERE timestamp > NOW() - INTERVAL '7 days' GROUP BY student_id HAVING COUNT(*) > 3`
    ).catch(() => ({ rows: [] }));

    for (const row of result.rows) {
      await runWorldModel(row.student_id).catch(err => logger.warn({ err, studentId: row.student_id }, '[WorldModelWorker] Failed'));
      await new Promise(r => setTimeout(r, 2000));
    }
  } finally {
    running = false;
  }
}

initializeDatabase().then(() => {
  cron.schedule('0 */2 * * *', () => runForAllActive().catch(() => {}));
  logger.info('[WorldModelWorker] Started — every 2 hours');
  runForAllActive().catch(() => {});
});
