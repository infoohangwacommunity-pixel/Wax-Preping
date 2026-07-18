/**
 * WaxPrep v3.0 — Oblivion Uncertainty-Gated Retrieval
 * The system does NOT always search memory. It first asks:
 * "Do I already have enough context to answer?"
 */

import type { MemoryChunk, ForgettingParams } from '../../types/cognitive';

/**
 * Oblivion recall probability: P(recall) = exp(-hours_since_access / S_t)
 * where S_t = (usage_count + feedback_score + 0.1) * decay_temperature
 */
export function oblivionRecallProbability(chunk: MemoryChunk, now: Date): number {
  const hoursSinceAccess = (now.getTime() - chunk.last_accessed.getTime()) / (1000 * 60 * 60);
  const S_t = (chunk.usage_count + chunk.feedback_score + 0.1) * chunk.decay_temperature;
  return Math.exp(-hoursSinceAccess / S_t);
}

/**
 * Check if a chunk passes the Oblivion gate.
 */
export function passesOblivionGate(
  chunk: MemoryChunk,
  now: Date,
  params: ForgettingParams
): boolean {
  const prob = oblivionRecallProbability(chunk, now);
  return prob > params.oblivion_threshold;
}

/**
 * Update memory access statistics after retrieval.
 * Successful retrievals strengthen the memory.
 */
export function strengthenMemory(chunk: MemoryChunk, success: boolean): MemoryChunk {
  return {
    ...chunk,
    last_accessed: new Date(),
    access_count: chunk.access_count + 1,
    feedback_score: chunk.feedback_score + (success ? 0.1 : -0.05),
    usage_count: chunk.usage_count + 1,
  };
}