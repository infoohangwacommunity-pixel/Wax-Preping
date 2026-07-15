// Prompt Evolution Engine.
// Runs weekly to improve prompt components based on real performance data.
// The AI generates variations of its own prompts and evaluates which performs better.
// This is how WaxPrep improves without human intervention.

import { routeAndCall } from '../llm/router';
import { db } from '../db/client';
import { logger } from '../middleware/logger';

export interface ComponentFitness {
  componentId: string;
  avgEngagement: number;
  masteryRate: number;
  shameRate: number;
  frustrationRate: number;
  noLeakRate: number;
  overallFitness: number;
  sampleSize: number;
}

export async function measureComponentFitness(
  componentId: string
): Promise<ComponentFitness> {
  const result = await db.query(
    `SELECT
       COUNT(*) as sample_size,
       AVG(student_engagement) as avg_engagement,
       AVG(CASE WHEN mastery_signal THEN 1.0 ELSE 0.0 END) as mastery_rate,
       AVG(CASE WHEN shame_spike THEN 1.0 ELSE 0.0 END) as shame_rate,
       AVG(CASE WHEN frustration_spike THEN 1.0 ELSE 0.0 END) as frustration_rate,
       AVG(CASE WHEN NOT answer_leak THEN 1.0 ELSE 0.0 END) as no_leak_rate
     FROM prompt_performance
     WHERE component_id = $1 AND timestamp > NOW() - INTERVAL '30 days'`,
    [componentId]
  );

  const row = result.rows[0];
  const fitness =
    (Number(row.avg_engagement) || 0.5) * 0.2 +
    (Number(row.mastery_rate) || 0.5) * 0.3 +
    (1 - (Number(row.shame_rate) || 0.2)) * 0.2 +
    (1 - (Number(row.frustration_rate) || 0.2)) * 0.15 +
    (Number(row.no_leak_rate) || 0.9) * 0.15;

  return {
    componentId,
    avgEngagement: Number(row.avg_engagement) || 0.5,
    masteryRate: Number(row.mastery_rate) || 0.5,
    shameRate: Number(row.shame_rate) || 0.2,
    frustrationRate: Number(row.frustration_rate) || 0.2,
    noLeakRate: Number(row.no_leak_rate) || 0.9,
    overallFitness: fitness,
    sampleSize: Number(row.sample_size) || 0,
  };
}

export async function evolveComponent(
  componentId: string,
  currentContent: string
): Promise<{ evolved: boolean; newContent: string; improvement: number }> {
  const fitness = await measureComponentFitness(componentId);

  if (fitness.sampleSize < 20) {
    logger.info(`[Evolution] Component ${componentId} has insufficient data (${fitness.sampleSize} samples)`);
    return { evolved: false, newContent: currentContent, improvement: 0 };
  }

  if (fitness.overallFitness > 0.82) {
    logger.info(`[Evolution] Component ${componentId} fitness ${fitness.overallFitness.toFixed(3)} — no evolution needed`);
    return { evolved: false, newContent: currentContent, improvement: 0 };
  }

  logger.info(`[Evolution] Evolving component ${componentId} (fitness: ${fitness.overallFitness.toFixed(3)})`);

  // Use AI to generate improved version
  const evolutionPrompt = `You are a prompt engineering expert for an AI tutor serving Nigerian students.

Current prompt component:
"""
${currentContent}
"""

Performance data (last 30 days, ${fitness.sampleSize} samples):
- Student engagement: ${(fitness.avgEngagement * 100).toFixed(0)}%
- Mastery signals: ${(fitness.masteryRate * 100).toFixed(0)}%
- Shame spikes (bad): ${(fitness.shameRate * 100).toFixed(0)}%
- Frustration spikes (bad): ${(fitness.frustrationRate * 100).toFixed(0)}%
- No answer leaks: ${(fitness.noLeakRate * 100).toFixed(0)}%

Problems to fix:
${fitness.shameRate > 0.15 ? '- Too many shame spikes — make the language warmer and more inviting' : ''}
${fitness.masteryRate < 0.3 ? '- Low mastery rate — add more explicit understanding checks or socratic prompts' : ''}
${fitness.avgEngagement < 0.4 ? '- Low engagement — add more curiosity-inducing elements or cultural connections' : ''}
${fitness.noLeakRate < 0.9 ? '- Answer leaks detected — strengthen guidance-without-answers instruction' : ''}
${fitness.frustrationRate > 0.2 ? '- High frustration — add more reassurance and validation' : ''}

Write an improved version of this prompt component that addresses these issues.
Keep it under 200 words. Be specific. Maintain Nigerian cultural grounding.
Respond with ONLY the improved prompt text.`;

  const response = await routeAndCall([
    { role: 'system', content: 'You are an expert at writing prompts for Nigerian educational AI systems.' },
    { role: 'user', content: evolutionPrompt },
  ]);

  const newContent = response.content.trim();

  // Evaluate the new version before saving
  const evalResponse = await routeAndCall([
    {
      role: 'system',
      content: `Rate this prompt component for an AI tutor on: engagement (0-1), mastery_support (0-1), shame_prevention (0-1), answer_leak_prevention (0-1). Respond in JSON: {"engagement": 0.8, "mastery_support": 0.7, "shame_prevention": 0.9, "answer_leak_prevention": 0.95, "overall": 0.85}`,
    },
    { role: 'user', content: `Prompt: "${newContent}"` },
  ], { jsonMode: true });

  let predictedFitness = fitness.overallFitness;
  try {
    const eval_ = JSON.parse(evalResponse.content);
    predictedFitness = eval_.overall || fitness.overallFitness;
  } catch { /* keep current */ }

  if (predictedFitness > fitness.overallFitness) {
    await db.query(
      `UPDATE prompt_components SET content = $1, version = version + 1, updated_at = NOW() WHERE component_id = $2`,
      [newContent, componentId]
    );

    await db.query(
      `INSERT INTO prompt_evolution_log (component_id, old_content, new_content, old_fitness, new_fitness, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [componentId, currentContent, newContent, fitness.overallFitness, predictedFitness, 'Performance-driven evolution']
    );

    logger.info(`[Evolution] Component ${componentId} improved: ${fitness.overallFitness.toFixed(3)} → ${predictedFitness.toFixed(3)}`);
    return { evolved: true, newContent, improvement: predictedFitness - fitness.overallFitness };
  }

  logger.info(`[Evolution] No improvement found for ${componentId}`);
  return { evolved: false, newContent: currentContent, improvement: 0 };
}

export async function recordPromptPerformance(
  componentId: string,
  studentId: string,
  sessionId: string,
  turnNumber: number,
  outcome: {
    studentEngagement: number;
    masterySignal: boolean;
    shameSpike: boolean;
    frustrationSpike: boolean;
    flowMaintained: boolean;
    answerLeak: boolean;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO prompt_performance 
     (component_id, student_id, session_id, turn_number, student_engagement, mastery_signal, shame_spike, frustration_spike, flow_maintained, answer_leak)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      componentId, studentId, sessionId, turnNumber,
      outcome.studentEngagement, outcome.masterySignal,
      outcome.shameSpike, outcome.frustrationSpike,
      outcome.flowMaintained, outcome.answerLeak,
    ]
  );
}