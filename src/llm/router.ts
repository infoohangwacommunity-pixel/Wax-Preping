import { callGroq, isGroqAvailable } from './groq';
import { callOpenRouter, isOpenRouterAvailable } from './openrouter';
import { callZAI, isZAIAvailable } from './zai';
import type { LLMMessage, LLMResponse } from '../types/llm';
import { logger } from '../middleware/logger';
import { db } from '../db/client';

function estimateComplexity(messages: LLMMessage[]): number {
  const combined = messages.map(m => m.content).join(' ');
  let complexity = 0.3;
  const tokenEstimate = combined.length / 4;
  if (tokenEstimate > 3000) complexity += 0.2;
  if (tokenEstimate > 6000) complexity += 0.15;
  if (/theorem|derivative|integral|electromagnetic|quantum|calculus|biochemistry|organic chemistry/.test(combined.toLowerCase())) {
    complexity += 0.2;
  }
  if (/CRITICAL|HIGH — be especially|shame_potential.*0\.[7-9]/.test(combined)) {
    complexity += 0.1;
  }
  return Math.min(1.0, complexity);
}

export async function routeAndCall(
  messages: LLMMessage[],
  options: { jsonMode?: boolean; maxTokens?: number; requiresReasoning?: boolean } = {}
): Promise<LLMResponse> {
  const complexity = estimateComplexity(messages);
  const maxTokens = options.maxTokens || (complexity > 0.7 ? 1500 : 1024);
  const jsonMode = options.jsonMode || false;

  const providers = [
    {
      name: 'groq',
      available: isGroqAvailable,
      call: () => callGroq(messages, 'llama-3.3-70b-versatile', maxTokens, 0.7, jsonMode),
    },
    {
      name: 'openrouter',
      available: isOpenRouterAvailable,
      call: () => callOpenRouter(messages, 'meta-llama/llama-3.1-8b-instruct:free', maxTokens),
    },
    {
      name: 'zai',
      available: isZAIAvailable,
      call: () => callZAI(messages, 'glm-4.7-flash', maxTokens),
    },
  ];

  for (const provider of providers) {
    if (!provider.available()) {
      logger.warn(`[Router] ${provider.name} circuit open — skipping`);
      continue;
    }

    try {
      const result = await provider.call();

      // Track cost
      await trackCost(provider.name, result.tokensIn, result.tokensOut, result.costUsd).catch(() => {});

      return result;
    } catch (err: unknown) {
      const e = err as { status?: number };
      logger.warn(`[Router] ${provider.name} failed (status: ${e?.status}) — trying next`);

      if (e?.status === 429) {
        await new Promise(r => setTimeout(r, 3000));
      }

      continue;
    }
  }

  throw new Error('All LLM providers exhausted');
}

async function trackCost(model: string, tokensIn: number, tokensOut: number, costUsd: number): Promise<void> {
  await db.query(
    `INSERT INTO cost_tracking (student_id, model, tokens_in, tokens_out, cost_usd)
     VALUES ('system', $1, $2, $3, $4)`,
    [model, tokensIn, tokensOut, costUsd]
  );
}