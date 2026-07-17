import 'dotenv/config';
import cron from 'node-cron';
import { db, initializeDatabase } from '../db/client';
import { compressOldEpisodes } from '../memory/compressor';
import { consolidateRecentMemory } from '../memory/hierarchical';
import { logger } from '../middleware/logger';

async function compressAll(): Promise<void> {
  // Long-horizon archive compression
  const old = await db.query(
    `SELECT DISTINCT student_id FROM conversation_turns WHERE timestamp < NOW() - INTERVAL '90 days'`
  ).catch(() => ({ rows: [] as { student_id: string }[] }));

  logger.info(`[Compressor] Archiving ${old.rows.length} students (>90d)`);
  for (const row of old.rows) {
    await compressOldEpisodes(row.student_id, 90).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
  }

  // Hierarchical promotion for active students (last 14 days)
  const active = await db.query(
    `SELECT student_id, COUNT(*)::int AS n FROM conversation_turns
     WHERE timestamp > NOW() - INTERVAL '14 days'
     GROUP BY student_id HAVING COUNT(*) >= 8
     ORDER BY n DESC LIMIT 200`
  ).catch(() => ({ rows: [] as { student_id: string }[] }));

  logger.info(`[Compressor] Consolidating recent memory for ${active.rows.length} active students`);
  for (const row of active.rows) {
    await consolidateRecentMemory(row.student_id).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
  }
}

initializeDatabase().then(() => {
  cron.schedule('0 3 * * 0', () => compressAll().catch(() => {}));
  logger.info('[Compressor] Started — Sundays 3am UTC (archive + hierarchical consolidate)');
});
