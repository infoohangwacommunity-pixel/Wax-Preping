// A/B testing for prompt variants.
// Create experiments comparing two versions of a prompt component.
// The system tracks outcomes and determines the winner.

import { db } from '../db/client';

export async function createExperiment(
  componentId: string,
  variantA: string,
  variantB: string
): Promise<string> {
  const experimentId = `exp_${Date.now()}_${componentId}`;
  const endDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO prompt_experiments (experiment_id, component_id, variant_a, variant_b, end_date, student_split)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [experimentId, componentId, variantA, variantB, endDate.toISOString(), 0.5]
  );

  return experimentId;
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export async function getPromptVariant(
  experimentId: string,
  studentId: string,
  variantA: string,
  variantB: string
): Promise<{ variant: 'A' | 'B'; content: string }> {
  const hash = hashString(studentId + experimentId);
  const variant = hash % 2 === 0 ? 'A' : 'B';
  return { variant, content: variant === 'A' ? variantA : variantB };
}

export async function recordExperimentResult(
  experimentId: string,
  studentId: string,
  variant: 'A' | 'B',
  outcome: { masterySignals: number; engagementScore: number; shameEvents: number; frustrationEvents: number }
): Promise<void> {
  await db.query(
    `INSERT INTO prompt_experiment_results (experiment_id, student_id, variant, mastery_signals, engagement_score, shame_events, frustration_events)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [experimentId, studentId, variant, outcome.masterySignals, outcome.engagementScore, outcome.shameEvents, outcome.frustrationEvents]
  );
}

export async function analyzeExperiment(
  experimentId: string
): Promise<{ winner: 'A' | 'B' | 'tie'; improvement: number; confidenceLevel: 'high' | 'medium' | 'low' }> {
  const result = await db.query(
    `SELECT variant, AVG(mastery_signals) as avg_mastery, AVG(engagement_score) as avg_engagement, AVG(shame_events) as avg_shame, COUNT(*) as n
     FROM prompt_experiment_results WHERE experiment_id = $1 GROUP BY variant`,
    [experimentId]
  );

  const rows = result.rows;
  if (rows.length < 2) return { winner: 'tie', improvement: 0, confidenceLevel: 'low' };

  type ExperimentRow = { variant: string; avg_mastery: string; avg_engagement: string; avg_shame: string; n: string };
  const a = rows.find((r: ExperimentRow) => r.variant === 'A') as ExperimentRow;
  const b = rows.find((r: ExperimentRow) => r.variant === 'B') as ExperimentRow;

  if (!a || !b) return { winner: 'tie', improvement: 0, confidenceLevel: 'low' };

  const scoreA = Number(a.avg_mastery) * 0.4 + Number(a.avg_engagement) * 0.3 + (1 - Number(a.avg_shame)) * 0.3;
  const scoreB = Number(b.avg_mastery) * 0.4 + Number(b.avg_engagement) * 0.3 + (1 - Number(b.avg_shame)) * 0.3;

  const n = Number(a.n) + Number(b.n);
  const confidenceLevel = n > 100 ? 'high' : n > 40 ? 'medium' : 'low';

  if (scoreA > scoreB * 1.05) return { winner: 'A', improvement: (scoreA - scoreB) / scoreB, confidenceLevel };
  if (scoreB > scoreA * 1.05) return { winner: 'B', improvement: (scoreB - scoreA) / scoreA, confidenceLevel };
  return { winner: 'tie', improvement: 0, confidenceLevel };
}