// Main entry point.
// Starts the Express server, initializes the database, and wires up the webhook.

import express from "express";
import dotenv from "dotenv";
import { initializeDatabase } from "./db/client";
import { createWebhookRouter } from "./whatsapp/webhook";

dotenv.config();

async function main() {
  console.log("[WaxPrep] Starting...");

  // Initialize database schema
  await initializeDatabase();
  console.log("[WaxPrep] Database ready");

  const app = express();

  // Parse incoming JSON — required for WhatsApp webhooks
  app.use(express.json());

  // Health check endpoint (Render uses this)
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Mount the webhook router
  app.use("/", createWebhookRouter());

  const port = parseInt(process.env.PORT ?? "3000", 10);
  app.listen(port, "0.0.0.0", () => {
    console.log(`[WaxPrep] Server running on port ${port}`);
    console.log(`[WaxPrep] Webhook URL: https://your-app.onrender.com/webhook`);
  });
}

main().catch((err) => {
  console.error("[WaxPrep] Fatal startup error:", err);
  process.exit(1);
});