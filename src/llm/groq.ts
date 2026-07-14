import Groq from 'groq-sdk';
import type { LLMMessage, LLMResponse } from '../types/llm';
import { CircuitBreaker } from './circuit_breaker';

let client: Groq | null = null;
const breaker = new CircuitBreaker('groq', 5, 30_000);

function getClient(): Groq {
  if (!client) client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return client;
}

export async function callGroq(
  messages: LLMMessage[],
  model = 'llama-3.3-70b-versatile',
  maxTokens = 1024,
  temperature = 0.7,
  jsonMode = false
): Promise<LLMResponse> {
  return breaker.call(async () => {
    const start = Date.now();

    const response = await getClient().chat.completions.create({
      model,
      messages: messages.map(m => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content })),
      max_tokens: maxTokens,
      temperature,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    });

    const latencyMs = Date.now() - start;
    const content = response.choices[0]?.message?.content ?? '';
    const tokensIn = response.usage?.prompt_tokens ?? 0;
    const tokensOut = response.usage?.completion_tokens ?? 0;

    return { content, modelUsed: model, tokensIn, tokensOut, costUsd: 0, latencyMs };
  });
}

export function isGroqAvailable(): boolean {
  return breaker.isAvailable();
}