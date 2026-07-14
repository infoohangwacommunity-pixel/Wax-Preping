// Spaced repetition worker — runs daily via cron.
// Sends review reminders to students via WhatsApp.
// Run as: npm run spaced-rep

import dotenv from 'dotenv';
dotenv.config();

import cron from 'node-cron';
import { db, initializeDatabase } from '../db/client';
import { sendTextMessage } from '../whatsapp/sender';
import { getDueReviews, formatSpacedReviewMessage } from '../features/spaced_repetition';
import { logger } from '../middleware/logger';

async function sendDueReviews(): Promise<void> {
  const result = await db.query(`
    SELECT DISTINCT student_id FROM spaced_reviews
    WHERE next_review_at <= NOW() + INTERVAL '2 hours'
  `);

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!;

  for (const row of result.rows) {
    const studentId = row.student_id;
    try {
      const dueReviews = await getDueReviews(studentId);
      if (dueReviews.length === 0) continue;

      const message = formatSpacedReviewMessage(dueReviews);
      if (message) {
        await sendTextMessage(phoneNumberId, studentId, message);
        logger.info(`[SpacedRep] Sent review reminder to ${studentId}`);
      }

      await new Promise(r => setTimeout(r, 500)); // Rate limiting
    } catch (err) {
      logger.error(`[SpacedRep] Failed for ${studentId}:`, err);
    }
  }
}

initializeDatabase().then(() => {
  // Run daily at 8am WAT (7am UTC)
  cron.schedule('0 7 * * *', () => {
    sendDueReviews().catch(err => logger.error('[SpacedRep] Cron error:', err));
  });

  logger.info('[SpacedRep] Spaced repetition worker started — scheduled for 8am WAT daily');
});