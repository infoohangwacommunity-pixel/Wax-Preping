// The webhook is the entry point.
// Every student message comes through here.
// It does ONE thing: verify the request, then hand it off.
// All processing happens asynchronously AFTER the 200 response.
// Meta will retry if we don't respond within ~20 seconds.
// We respond in under 100ms. Always.

import express, { Request, Response } from "express";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { eventBus } from "../events/bus";
import { processTutorMessage } from "../agents/crew";
import { sendTextMessage, markAsRead } from "./sender";
import { isMessageProcessed, markMessageProcessed, updateLastSeen } from "../session/manager";
import type { StudentMessageReceived } from "../types/events";

export function createWebhookRouter() {
  const router = express.Router();

  // Meta sends a GET request to verify the webhook endpoint
  router.get("/webhook", (req: Request, res: Response) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      console.log("[Webhook] Verified successfully");
      res.status(200).send(challenge);
    } else {
      console.error("[Webhook] Verification failed");
      res.sendStatus(403);
    }
  });

  // Meta sends a POST request with every incoming message
  router.post("/webhook", async (req: Request, res: Response) => {
    // CRITICAL: Return 200 immediately
    // Everything else happens asynchronously after this
    res.sendStatus(200);

    // Verify the request signature to prevent spoofing
    const signature = req.headers["x-hub-signature-256"] as string;
    const body = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac("sha256", process.env.WHATSAPP_APP_SECRET ?? "")
      .update(body)
      .digest("hex");

    if (!signature || !crypto.timingSafeEqual(
      Buffer.from(`sha256=${expectedSignature}`),
      Buffer.from(signature)
    )) {
      console.error("[Webhook] Signature verification failed — ignoring");
      return;
    }

    // Process the webhook payload asynchronously
    setImmediate(() => {
      handleWebhookPayload(req.body).catch((err) => {
        console.error("[Webhook] Async processing error:", err);
      });
    });
  });

  return router;
}

async function handleWebhookPayload(body: Record<string, unknown>): Promise<void> {
  const entries = (body.entry as Record<string, unknown>[]) ?? [];

  for (const entry of entries) {
    const changes = (entry.changes as Record<string, unknown>[]) ?? [];

    for (const change of changes) {
      const value = change.value as Record<string, unknown>;
      const messages = (value.messages as Record<string, unknown>[]) ?? [];
      const phoneNumberId = (value.metadata as Record<string, unknown>)?.phone_number_id as string;

      for (const message of messages) {
        await processIncomingMessage(message, phoneNumberId);
      }
    }
  }
}

async function processIncomingMessage(
  message: Record<string, unknown>,
  phoneNumberId: string
): Promise<void> {
  const messageId = message.id as string;
  const studentId = message.from as string;
  const messageType = message.type as string;

  // Deduplication — Meta delivers at-least-once
  if (await isMessageProcessed(messageId)) {
    console.log(`[Webhook] Duplicate message ${messageId} — skipping`);
    return;
  }

  await markMessageProcessed(messageId);
  await updateLastSeen(studentId);

  // Mark as read (shows blue ticks)
  if (phoneNumberId) {
    await markAsRead(phoneNumberId, messageId);
  }

  // We only process text messages in Stage 1
  // Image/voice/video support comes in later stages
  if (messageType !== "text") {
    const replyText =
      messageType === "image"
        ? "I can see you sent an image, but I'm still learning to read pictures. Can you describe what you're seeing, or type out the problem?"
        : messageType === "audio"
        ? "I can see you sent a voice note, but I haven't learned to listen yet. Could you type out what you want help with?"
        : "I can see you sent something, but I can only understand text right now. Can you type out your question?";

    if (phoneNumberId) {
      await sendTextMessage(phoneNumberId, studentId, replyText);
    }
    return;
  }

  const rawMessage = ((message.text as Record<string, unknown>)?.body as string) ?? "";
  if (!rawMessage.trim()) return;

  const sessionId = `${studentId}_${Date.now()}`;

  // Emit the event to the bus
  const event: StudentMessageReceived = {
    id: uuidv4(),
    type: "student.message.received",
    studentId,
    sessionId,
    timestamp: new Date(),
    rawMessage,
    messageId,
    modality: "text",
  };

  await eventBus.publish(event);

  // Process and respond
  try {
    const responseText = await processTutorMessage(event);

    if (phoneNumberId && responseText) {
      await sendTextMessage(phoneNumberId, studentId, responseText);
    }
  } catch (error) {
    console.error("[Webhook] Failed to process message:", error);

    // Send a graceful error message to the student
    if (phoneNumberId) {
      await sendTextMessage(
        phoneNumberId,
        studentId,
        "Sorry, something went wrong on my end. Give me a moment and try again."
      );
    }
  }
}