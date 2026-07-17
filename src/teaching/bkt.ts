/**
 * Bayesian Knowledge Tracing (Corbett & Anderson, 1995).
 *
 * Replaces the ad-hoc step-up / step-down mastery update with a proper
 * latent-knowledge model:
 *
 *   P(L_t | evidence)  — probability the student has learned the skill
 *
 * Parameters (defaults are classic BKT; can be specialized per concept later):
 *   pL0  — prior P(learned) before any evidence
 *   pT   — P(transition: unlearned → learned after an opportunity)
 *   pG   — P(guess correctly while unlearned)
 *   pS   — P(slip: incorrect while learned)
 *
 * This is still interpretable and cheap (no neural DKT required on the
 * WhatsApp hot path). Deep Knowledge Tracing can sit alongside later for
 * sequence modelling; BKT remains the durable scalar we store as masteryLevel.
 */

export interface BktParams {
  pL0: number;
  pT: number;
  pG: number;
  pS: number;
}

export const DEFAULT_BKT: BktParams = {
  pL0: 0.1,
  pT: 0.15,
  pG: 0.2,
  pS: 0.1,
};

/** Clamp probability into (0, 1) open interval for numerical stability. */
function clampP(p: number): number {
  return Math.max(0.01, Math.min(0.99, p));
}

/**
 * One BKT update given previous P(L) and a binary observation.
 * success=true → correct evidence; false → incorrect / struggle.
 */
export function bktUpdate(
  pL: number,
  success: boolean,
  params: BktParams = DEFAULT_BKT
): number {
  const { pT, pG, pS } = params;
  const prior = clampP(pL);

  // P(evidence | learned) and P(evidence | unlearned)
  const pE_L = success ? 1 - pS : pS;
  const pE_U = success ? pG : 1 - pG;

  // Bayes: P(L | E)
  const numer = pE_L * prior;
  const denom = numer + pE_U * (1 - prior);
  const pL_given_E = denom > 0 ? numer / denom : prior;

  // Learning transition for unlearned students after this opportunity
  const pL_next = pL_given_E + (1 - pL_given_E) * pT;
  return clampP(pL_next);
}

/**
 * Map coarse tutor signals onto BKT observations.
 * neutral → small positive opportunity (exposure) without full success.
 */
export function bktFromResult(
  pL: number,
  result: 'success' | 'struggle' | 'neutral',
  params: BktParams = DEFAULT_BKT
): number {
  if (result === 'success') return bktUpdate(pL, true, params);
  if (result === 'struggle') return bktUpdate(pL, false, params);
  // Neutral engagement: tiny pull toward learning via transition only
  const prior = clampP(pL);
  return clampP(prior + (1 - prior) * params.pT * 0.35);
}

export function masteryBand(pL: number): 'novice' | 'emerging' | 'proficient' | 'mastered' {
  if (pL < 0.3) return 'novice';
  if (pL < 0.6) return 'emerging';
  if (pL < 0.85) return 'proficient';
  return 'mastered';
}

/** Suggest review urgency from BKT + days since last practice. */
export function reviewUrgency(
  pL: number,
  daysSincePractice: number
): 'critical' | 'soon' | 'later' {
  // Simple decay heuristic (not full half-life model): low mastery or long gap
  if (pL < 0.4 || daysSincePractice >= 7) return 'critical';
  if (pL < 0.7 || daysSincePractice >= 3) return 'soon';
  return 'later';
}
