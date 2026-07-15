import 'dotenv/config';
import express from 'express';
import { initializeDatabase } from './db/client';
import { eventBus } from './events/bus';
import { createWebhookRouter } from './whatsapp/webhook';
import { getBrainStatus } from './brain/llama_server';
import { getConstitution } from './brain/constitution';
import { logger } from './middleware/logger';
import type { MasteryDetected, DefenseTriggered } from './types/events';

async function main(): Promise<void> {
  logger.info('[WaxPrep] Initializing v1.0.0 — The AI is the OS');

  await initializeDatabase();
  await eventBus.connect();

  // Check on-premise model status
  const brainStatus = await getBrainStatus();
  logger.info(`[WaxPrep] Brain (Phi-4 Mini): ${brainStatus.brainOnline ? 'ONLINE' : 'OFFLINE → cloud fallback'}`);
  logger.info(`[WaxPrep] Router (Llama 3.2 1B): ${brainStatus.routerOnline ? 'ONLINE' : 'OFFLINE → cloud fallback'}`);

  // Load constitution
  const constitution = await getConstitution();
  logger.info(`[WaxPrep] Constitution loaded: ${constitution.split('\n')[0]}`);

  // Event subscriptions
  eventBus.subscribe<MasteryDetected>('mastery.detected', async (event) => {
    logger.info(`[Event] MASTERY: ${event.studentId} → "${event.concept}" via ${event.evidenceType}`);
  });

  eventBus.subscribe<DefenseTriggered>('defense.triggered', async (event) => {
    if (event.severity === 'critical') {
      logger.warn(`[Event] DEFENSE CRITICAL: ${event.studentId} — ${event.layer}: ${event.issue}`);
    }
  });

  const app = express();
  app.use(express.json({ limit: '15mb' }));

  app.get('/health', async (_req, res) => {
    const status = await getBrainStatus();
    res.json({
      status: 'ok',
      version: '1.0.0',
      architecture: 'ai-native-swarm',
      brain: status.brainOnline ? 'online' : 'cloud-fallback',
      router: status.routerOnline ? 'online' : 'cloud-fallback',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/constitution', async (_req, res) => {
    const constitution = await getConstitution();
    res.json({ constitution });
  });

  app.post('/constitution', async (req, res) => {
    const { content, adminKey } = req.body;
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    const { setConstitution } = await import('./brain/constitution');
    await setConstitution(content);
    res.json({ success: true });
  });

  app.get('/metrics', async (_req, res) => {
    try {
      const { db } = await import('./db/client');
      const [students, sessions, turns, notifications, worldModels, reflections, defenses] = await Promise.all([
        db.query('SELECT COUNT(*) FROM student_profiles'),
        db.query(`SELECT COUNT(*) FROM sessions WHERE started_at > NOW() - INTERVAL '24 hours'`),
        db.query(`SELECT COUNT(*) FROM conversation_turns WHERE timestamp > NOW() - INTERVAL '24 hours'`),
        db.query(`SELECT COUNT(*) FROM notification_queue WHERE sent = TRUE AND sent_at > NOW() - INTERVAL '24 hours'`),
        db.query(`SELECT COUNT(*) FROM world_model_state WHERE model_updated_at > NOW() - INTERVAL '24 hours'`),
        db.query(`SELECT AVG(confidence_score) FROM ai_reflections WHERE timestamp > NOW() - INTERVAL '24 hours'`),
        db.query(`SELECT COUNT(*) FROM defense_log WHERE timestamp > NOW() - INTERVAL '24 hours'`),
      ]);

      res.json({
        version: '1.0.0',
        totalStudents: parseInt(students.rows[0].count),
        sessionsLast24h: parseInt(sessions.rows[0].count),
        turnsLast24h: parseInt(turns.rows[0].count),
        notificationsSentLast24h: parseInt(notifications.rows[0].count),
        worldModelUpdatesLast24h: parseInt(worldModels.rows[0].count),
        avgReflectionConfidence: parseFloat(reflections.rows[0].avg || '0').toFixed(3),
        defenseTriggers24h: parseInt(defenses.rows[0].count),
        onPremiseBrain: brainStatus.brainOnline,
        onPremiseRouter: brainStatus.routerOnline,
      });
    } catch (err) {
      res.status(500).json({ error: 'Metrics unavailable' });
    }
  });

  app.get('/world-model/:studentId', async (req, res) => {
    const { getWorldModelState } = await import('./world_model/predictive_model');
    const state = await getWorldModelState(req.params.studentId);
    if (!state) return res.status(404).json({ error: 'No world model yet' });
    res.json(state);
  });

  app.use('/', createWebhookRouter());

  const port = parseInt(process.env.PORT || '3000', 10);
  app.listen(port, '0.0.0.0', () => {
    logger.info(`[WaxPrep] Running on port ${port}`);
    logger.info('[WaxPrep] Architecture: AI-Native Swarm');
    logger.info('[WaxPrep] Agents: Router → Emotional → Cultural → Pedagogy → Defense → Curriculum');
    logger.info('[WaxPrep] Brain: On-premise Phi-4 Mini + cloud fallback');
    logger.info('[WaxPrep] World Model: Predictive modeling every 2 hours');
    logger.info('[WaxPrep] Notifications: 100% AI-generated, zero templates');
    logger.info('[WaxPrep] Constitution: Living document in database');
  });
}

main().catch(err => {
  logger.error('[WaxPrep] Fatal:', err);
  process.exit(1);
});