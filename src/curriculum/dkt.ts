/**
 * Deep Knowledge Tracing — lightweight sequential model.
 *
 * Full neural DKT (Piech et al.) needs offline training on large logs.
 * This module provides:
 * 1) Event sequence I/O for future training
 * 2) A practical RNN-free sequential predictor: logistic skill state with
 *    recency-weighted history (works on-device / free-tier without torch)
 * 3) Hook points for swapping in a real model artifact later
 *
 * Predicts P(next success | history) per concept and forgetting risk.
 */

export interface TraceStep {
  conceptId: string;
  success: boolean;
  timestamp: number; // ms
}

export interface DktPrediction {
  conceptId: string;
  pNextSuccess: number;
  forgettingRisk: number;
  recommendedAction: 'teach' | 'review' | 'advance' | 'remediate';
}

/**
 * Sequential estimator: exponential recency kernel over past attempts.
 * Not a neural net — production-safe default until offline DKT weights exist.
 */
export function predictFromHistory(
  history: TraceStep[],
  conceptId: string,
  now = Date.now()
): DktPrediction {
  const relevant = history.filter(h => h.conceptId === conceptId);
  if (relevant.length === 0) {
    return {
      conceptId,
      pNextSuccess: 0.35,
      forgettingRisk: 0.5,
      recommendedAction: 'teach',
    };
  }

  let wSum = 0;
  let sSum = 0;
  for (const h of relevant) {
    const days = Math.max(0, (now - h.timestamp) / 86400000);
    const w = Math.exp(-days / 7); // ~1 week half-life-ish decay
    wSum += w;
    sSum += w * (h.success ? 1 : 0);
  }
  const p = wSum > 0 ? sSum / wSum : 0.35;

  const last = relevant[relevant.length - 1];
  const daysSince = Math.max(0, (now - last.timestamp) / 86400000);
  const forgettingRisk = Math.min(0.95, (1 - p) * 0.5 + Math.min(daysSince / 14, 1) * 0.5);

  let recommendedAction: DktPrediction['recommendedAction'] = 'teach';
  if (p >= 0.8 && forgettingRisk < 0.35) recommendedAction = 'advance';
  else if (p >= 0.55 && forgettingRisk >= 0.45) recommendedAction = 'review';
  else if (p < 0.4) recommendedAction = 'remediate';
  else recommendedAction = 'teach';

  return { conceptId, pNextSuccess: p, forgettingRisk, recommendedAction };
}

/** Batch predictions for weak concepts. */
export function predictMany(
  history: TraceStep[],
  conceptIds: string[],
  now = Date.now()
): DktPrediction[] {
  return conceptIds.map(id => predictFromHistory(history, id, now));
}

/**
 * Placeholder for loading a trained DKT artifact (JSON weights).
 * Returns null if no artifact — caller falls back to predictFromHistory.
 */
export function loadNeuralDktArtifact(_path: string): null {
  return null;
}
