import express, { Request, Response, Router } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { processTutorMessage } from '../agents/crew';
import { sendTextMessage, sendVoiceMessage, markAsRead } from './sender';
import { isMessageProcessed, markMessageProcessed, updateLastSeen } from '../session/manager';
import { generateVoiceResponse } from '../encoders/voice';
import { logger } from '../middleware/logger';
import { checkRateLimit } from '../middleware/rate_limiter';

export function createWebhookRouter(): Router {
  const router = express.Router();

  router.get('/webhook', (req: Request, res: Response) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      logger.info('[Webhook] Verified');
      res.status(200).send(challenge);
    } else {
      logger.error('[Webhook] Verification failed');
      res.sendStatus(403);
    }
  });

  router.post('/webhook', async (req: Request, res: Response) => {
    // Return 200 immediately — ALWAYS
    res.sendStatus(200);

    // Verify signature
    const signature = req.headers['x-hub-signature-256'] as string;
    if (signature) {
      const expected = `sha256=${crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET ?? '').update(JSON.stringify(req.body)).digest('hex')}`;
      if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
        logger.warn('[Webhook] Invalid signature');
        return;
      }
    }

    setImmediate(() => {
      processWebhookAsync(req.body).catch(err => logger.error('[Webhook] Async error:', err));
    });
  });

  return router;
}

async function processWebhookAsync(body: Record<string, unknown>): Promise<void> {
  const entries = (body.entry as Record<string, unknown>[]) ?? [];

  for (const entry of entries) {
    const changes = (entry.changes as Record<string, unknown>[]) ?? [];

    for (const change of changes) {
      const value = change.value as Record<string, unknown>;
      const messages = (value.messages as Record<string, unknown>[]) ?? [];
      const metadata = value.metadata as Record<string, unknown>;
      const phoneNumberId = metadata?.phone_number_id as string;

      for (const message of messages) {
        await processMessage(message, phoneNumberId).catch(err =>
          logger.error('[Webhook] Message processing error:', err)
        );
      }
    }
  }
}

async function processMessage(message: Record<string, unknown>, phoneNumberId: string): Promise<void> {
  const messageId = message.id as string;
  const studentId = message.from as string;
  const messageType = message.type as string;

  if (await isMessageProcessed(messageId)) return;
  await markMessageProcessed(messageId);
  await updateLastSeen(studentId);

  if (phoneNumberId) await markAsRead(phoneNumberId, messageId);

  // Rate limiting: max 30 messages per student per hour
  const rateCheck = await checkRateLimit(`student:${studentId}:messages`, 30, 3600);
  if (!rateCheck.allowed) {
    logger.warn(`[Webhook] Rate limit hit for student ${studentId}`);
    if (phoneNumberId) {
      await sendTextMessage(phoneNumberId, studentId, 'Slow down a bit! You can send more messages in an hour. Take a moment to review what we discussed.');
    }
    return;
  }

  const sessionId = `${studentId}_session`;

  // Check if this is likely their first ever message
  const { db } = await import('../db/client');
  const profileCheck = await db.query(`SELECT total_turns FROM student_profiles WHERE student_id = $1`, [studentId]);
  const isFirstMessage = !profileCheck.rows.length || profileCheck.rows[0].total_turns === 0;

  // Handle unsupported types gracefully
  if (!['text', 'image', 'audio', 'document'].includes(messageType)) {
    if (phoneNumberId) {
      const typeReplies: Record<string, string> = {
        video: "I can see you sent a video — I can't watch it yet, but I'm learning! Can you describe what's in it, or type your question?",
        sticker: "Nice sticker 😄 What's on your mind?",
        contacts: "I see you shared a contact. What are you studying today?",
        location: "I see you shared your location. What are you working on?",
      };
      await sendTextMessage(phoneNumberId, studentId, typeReplies[messageType] || "I got your message but can't process this format yet. Try sending text, a photo, or a voice note!");
    }
    return;
  }

  // Extract media info based on type
  let rawMessage = '';
  let mediaId: string | undefined;
  let mediaCaption: string | undefined;

  if (messageType === 'text') {
    rawMessage = (message.text as Record<string, unknown>)?.body as string ?? '';
  } else if (messageType === 'image') {
    const img = message.image as Record<string, unknown>;
    mediaId = img?.id as string;
    mediaCaption = img?.caption as string;
    rawMessage = mediaCaption || 'Student sent an image';
  } else if (messageType === 'audio') {
    const audio = message.audio as Record<string, unknown>;
    mediaId = audio?.id as string;
    rawMessage = 'Voice note';
  } else if (messageType === 'document') {
    const doc = message.document as Record<string, unknown>;
    mediaId = doc?.id as string;
    mediaCaption = doc?.caption as string;
    rawMessage = mediaCaption || 'Student sent a document';
  }

  if (!rawMessage.trim() && !mediaId) return;

  try {
    const responseText = await processTutorMessage({
      studentId,
      sessionId,
      rawMessage,
      messageId,
      modality: messageType as 'text' | 'image' | 'audio' | 'document' | 'video',
      mediaId,
      mediaCaption,
      isFirstMessage,
    });

    if (!phoneNumberId || !responseText) return;

    // For audio input with TTS enabled, optionally respond with voice
    const preferVoice = messageType === 'audio' && process.env.ELEVENLABS_API_KEY;
    if (preferVoice) {
      const audioBuffer = await generateVoiceResponse(responseText);
      if (audioBuffer) {
        await sendVoiceMessage(phoneNumberId, studentId, audioBuffer);
        // Also send text for accessibility
        await sendTextMessage(phoneNumberId, studentId, `_(Text version)_\n${responseText}`);
        return;
      }
    }

    await sendTextMessage(phoneNumberId, studentId, responseText);
  } catch (err) {
    logger.error('[Webhook] Process message error:', err);
    if (phoneNumberId) {
      await sendTextMessage(phoneNumberId, studentId, "Something went wrong on my end. Give me a moment and try again — I'm still here.");
    }
  }
}