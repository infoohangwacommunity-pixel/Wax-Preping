import 'dotenv/config';
import express from 'express';
import { initializeDatabase } from './db/client';
import { eventBus } from './events/bus';
import { createWebhookRouter } from './whatsapp/webhook';
import { logger } from './middleware/logger';
import { MasteryDetected, EmotionalAlert, StuckLoopDetected } from './types/events';
import { applyMemoryEdit } from './memory/semantic';

async function main(): Promise<void> {
  logger.info('[WaxPrep] Starting...');

  await initializeDatabase();
  await eventBus.connect();

  // Subscribe to system events for side effects
  eventBus.subscribe<MasteryDetected>('mastery.detected', async (event) => {
    logger.info(`[Event] Mastery detected: ${event.studentId} mastered ${event.concept}`);
    await applyMemoryEdit(event.studentId, 'breakthroughs', 'append', `Mastered "${event.concept}" via ${event.evidenceType} on ${new Date().toLocaleDateString()}`).catch(() => {});
  });

  eventBus.subscribe<EmotionalAlert>('emotional.alert', async (event) => {
    if (event.emotion === 'shame_spike' || event.emotion === 'frustration') {
      logger.info(`[Event] Emotional alert: ${event.studentId} — ${event.emotion}`);
    }
  });

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '2.0.0', timestamp: new Date().toISOString() });
  });

  app.get('/ready', (_req, res) => {
    res.json({ ready: true });
  });

  app.get('/metrics', async (_req, res) => {
    const { db } = await import('./db/client');
    const [students, sessions, turns, costs] = await Promise.all([
      db.query('SELECT COUNT(*) FROM student_profiles'),
      db.query('SELECT COUNT(*) FROM sessions WHERE started_at > NOW() - INTERVAL \'24 hours\''),
      db.query('SELECT COUNT(*) FROM conversation_turns WHERE timestamp > NOW() - INTERVAL \'24 hours\''),
      db.query('SELECT SUM(cost_usd) FROM cost_tracking WHERE timestamp > NOW() - INTERVAL \'24 hours\''),
    ]);

    res.json({
      totalStudents: parseInt(students.rows[0].count),
      sessionsLast24h: parseInt(sessions.rows[0].count),
      turnsLast24h: parseInt(turns.rows[0].count),
      costLast24hUsd: parseFloat(costs.rows[0].sum || '0').toFixed(4),
    });
  });

  app.use('/', createWebhookRouter());

  const port = parseInt(process.env.PORT || '3000', 10);
  app.listen(port, '0.0.0.0', () => {
    logger.info(`[WaxPrep] Server running on port ${port}`);
    logger.info(`[WaxPrep] Webhook: POST /webhook`);
    logger.info(`[WaxPrep] Health: GET /health`);
    logger.info(`[WaxPrep] Metrics: GET /metrics`);
  });
}

main().catch(err => {
  logger.error('[WaxPrep] Fatal startup error:', err);
  process.exit(1);
});