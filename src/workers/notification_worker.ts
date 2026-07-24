import 'dotenv/config';
import { initializeDatabase } from '../db/client';
import { processPendingNotifications } from '../brain/notification_agent';
import { logger } from '../middleware/logger';

let running = false;

async function run(): Promise<void> {
  await initializeDatabase();
  logger.info('[NotificationWorker] Started');

  const cycle = async () => {
    if (running) return;
    running = true;
    try {
      await processPendingNotifications();
    } catch (err) {
      logger.error({ err }, '[NotificationWorker] Cycle error');
    } finally {
      running = false;
    }
  };

  await cycle();
  setInterval(() => { cycle().catch(() => {}); }, 5 * 60 * 1000);
}

run().catch(err => { logger.error({ err }, '[NotificationWorker] Fatal'); process.exit(1); });
