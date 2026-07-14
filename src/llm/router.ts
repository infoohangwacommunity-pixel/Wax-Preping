// The LLM router decides which model to use for each request.
// It starts with the cheapest option (Groq free) and escalates only if needed.
// The routing logic is based on task complexity, not hardcoded rules.

import { callGroq } from "./groq";
import type { LLMMessage, LLMResponse } from "../types/llm";

// Estimate task complexity from the assembled prompt
function estimateComplexity(messages: LLMMessage[]): number {
  const systemContent = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join(" ");

  const userContent = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ");

  const combined = systemContent + userContent;
  let complexity = 0.3; // Baseline

  // More context = potentially harder task
  const tokenEstimate = combined.length / 4;
  if (tokenEstimate > 3000) complexity += 0.2;
  if (tokenEstimate > 6000) complexity += 0.15;

  // Math or science keywords
  if (/theorem|derivative|integral|quantum|electromagnetic|biochemistry/.test(combined.toLowerCase())) {
    complexity += 0.15;
  }

  // Student is frustrated or in a critical moment
  if (/shame|frustrated|i give up|i can't do|HIGH — be especially|CRITICAL/.test(combined)) {
    complexity += 0.1;
  }

  return Math.min(1.0, complexity);
}

export async function routeAndCall(
  messages: LLMMessage[],
  requiresTools = false
): Promise<LLMResponse> {
  const complexity = estimateComplexity(messages);

  // Stage 1 only uses Groq (free tier, llama-3.3-70b-versatile)
  // Later stages will add OpenRouter, DeepSeek, etc.
  // The interface stays the same — only this function changes.

  try {
    const model = complexity > 0.7
      ? "llama-3.3-70b-versatile"    // More capable for complex explanations
      : "llama-3.3-70b-versatile";   // Same for now — add mixtral or others later

    return await callGroq(messages, model, 1024, 0.7);
  } catch (error: unknown) {
    const err = error as { status?: number; error?: { type?: string } };
    console.error("[Router] Groq call failed:", err);

    // If rate limited, wait briefly and retry once
    if (err?.status === 429 || err?.error?.type === "rate_limit_exceeded") {
      console.log("[Router] Rate limited — waiting 5 seconds and retrying");
      await new Promise((r) => setTimeout(r, 5000));
      return await callGroq(messages, "llama-3.3-70b-versatile", 1024, 0.7);
    }

    throw error;
  }
}