/**
 * WaxPrep v3.0 — ACT-R Base-Level Activation Computation
 * Implements the ACT-R activation formula with student-specific parameters.
 */

import type { MemoryChunk, ForgettingParams } from '../../types/cognitive';

/**
 * Compute ACT-R activation for a memory chunk.
 * A(m) = B(m) + Σ(W_j · S_j) + ε
 */
export function computeActivation(
  chunk: MemoryChunk,
  queryEmbedding: number[],
  params: ForgettingParams
): number {
  const now = Date.now();

  // Base-level activation: recency + frequency
  const baseLevel = computeBaseLevelActivation(chunk, params.decay_rate);

  // Contextual boost: semantic similarity to query
  const similarity = cosineSimilarity(queryEmbedding, chunk.embedding);
  const contextualBoost = similarity * params.contextual_boost_weight;

  // Emotional salience boost
  const emotionalBoost = chunk.emotional_salience * params.emotional_salience_weight;

  // Gaussian noise for human-like variability
  const noise = randomGaussian(0, params.noise_stddev);

  return baseLevel + contextualBoost + emotionalBoost + noise;
}

/**
 * ACT-R base-level activation: B(m) = ln(Σ(t - t_i)^-d)
 * Simplified: uses last_accessed and access_count as proxies.
 */
function computeBaseLevelActivation(chunk: MemoryChunk, decayRate: number): number {
  const now = Date.now();
  const hoursSinceAccess = (now - chunk.last_accessed.getTime()) / (1000 * 60 * 60);

  // Simplified formula: ln(access_count * (hours_since + 1)^-d)
  // This captures both frequency (access_count) and recency (hours_since)
  const recencyFactor = Math.pow(hoursSinceAccess + 1, -decayRate);
  const frequencyFactor = Math.max(1, chunk.access_count);

  return Math.log(frequencyFactor * recencyFactor);
}

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

/**
 * Gaussian random number (Box-Muller transform).
 */
function randomGaussian(mean: number, stdDev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return z0 * stdDev + mean;
}

/**
 * Estimate uncertainty of working memory relative to query.
 * Returns 0-1 where 1 = high uncertainty (need memory search).
 */
export function estimateUncertainty(query: string, workingMemoryContext: string): number {
  // Simple heuristic: if working memory is empty or very short, high uncertainty
  if (!workingMemoryContext || workingMemoryContext.length < 50) return 0.8;

  // Check if query keywords appear in working memory
  const queryWords = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const contextWords = new Set(workingMemoryContext.toLowerCase().split(/\s+/));

  let overlap = 0;
  for (const word of queryWords) {
    if (contextWords.has(word)) overlap++;
  }

  const overlapRatio = queryWords.size > 0 ? overlap / queryWords.size : 0;
  // High overlap = low uncertainty, low overlap = high uncertainty
  return Math.max(0, 1 - overlapRatio);
}