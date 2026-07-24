/**
 * Prompt evolution driven by real teaching outcomes.
 *
 * Phase 3 fitness blends:
 *   - teach rate vs question rate (anti-interrogation)
 *   - mastery signals
 *   - shame / leak penalties
 *   - engagement
 *
 * Not a vanity score — low teach-rate or high question-rate tanks fitness.
 */
import { v4 as uuidv4 } from 'uuid';
import { routeAndCall } from '../llm/router';
import { db } from '../db/client';
import { eventBus } from '../events/bus';
import { invalidatePromptCache } from '../config/prompts';
import { logger } from '../middleware/logger';
import type { PromptEvolved } from '../types/events';

export async function measureComponentFitness(componentId: string): Promise<{ fitness: number; sampleSize: number; details: Record<string, number> }> {
  const result = await db.query(
    `SELECT
       COUNT(*) as sample_size,
       AVG(student_engagement) as avg_engagement,
       AVG(CASE WHEN mastery_signal THEN 1.0 ELSE 0.0 END) as mastery_rate,
       AVG(CASE WHEN shame_spike THEN 1.0 ELSE 0.0 END) as shame_rate,
       AVG(CASE WHEN NOT answer_leak THEN 1.0 ELSE 0.0 END) as no_leak_rate,
       AVG(CASE WHEN frustration_spike THEN 1.0 ELSE 0.0 END) as frustration_rate,
       AVG(CASE WHEN flow_maintained THEN 1.0 ELSE 0.0 END) as flow_rate
     FROM prompt_performance WHERE component_id = $1 AND timestamp > NOW() - INTERVAL '30 days'`,
    [componentId]
  );

  const row = result.rows[0] || {};
  const sampleSize = Number(row.sample_size) || 0;

  // Teaching metrics (generation-focused components)
  let teachRate = 0.5;
  let questionRate = 0.5;
  try {
    const tm = await db.query(
      `SELECT
         AVG(CASE WHEN taught_content THEN 1.0 ELSE 0.0 END) as teach_rate,
         AVG(CASE WHEN asked_question THEN 1.0 ELSE 0.0 END) as question_rate
       FROM teaching_metrics WHERE created_at > NOW() - INTERVAL '30 days'`
    );
    if (tm.rows[0]) {
      teachRate = Number(tm.rows[0].teach_rate) || 0.5;
      questionRate = Number(tm.rows[0].question_rate) || 0.5;
    }
  } catch { /* table may not exist yet */ }

  const engagement = Number(row.avg_engagement) || 0.5;
  const mastery = Number(row.mastery_rate) || 0.5;
  const shame = Number(row.shame_rate) || 0.2;
  const noLeak = Number(row.no_leak_rate) || 0.9;
  const flow = Number(row.flow_rate) || 0.5;
  const frustration = Number(row.frustration_rate) || 0.2;

  // Ideal question rate for a tutor is low-moderate (~0.25–0.4), not 0 and not 0.9
  const questionPenalty = questionRate > 0.55 ? (questionRate - 0.55) * 1.2 : 0;
  const teachBonus = teachRate;

  const fitness =
    engagement * 0.12 +
    mastery * 0.28 +
    (1 - shame) * 0.15 +
    noLeak * 0.1 +
    flow * 0.1 +
    (1 - frustration) * 0.08 +
    teachBonus * 0.22 -
    questionPenalty;

  return {
    fitness: Math.max(0, Math.min(1, fitness)),
    sampleSize,
    details: { engagement, mastery, shame, noLeak, flow, teachRate, questionRate, frustration },
  };
}

export async function evolveComponent(componentId: string, currentContent: string): Promise<{ evolved: boolean; newContent: string }> {
  const { fitness, sampleSize, details } = await measureComponentFitness(componentId);

  if (sampleSize < 20 || fitness > 0.85) {
    return { evolved: false, newContent: currentContent };
  }

  logger.info(`[Evolution] Evolving ${componentId} (fitness: ${fitness.toFixed(3)}, n=${sampleSize}, teach=${details.teachRate?.toFixed(2)}, q=${details.questionRate?.toFixed(2)})`);

  const response = await routeAndCall([
    {
      role: 'system',
      content:
        'You are a prompt-engineering expert for an educational AI tutoring Nigerian students. Improve this prompt using the learning metrics. Goals: higher teach-rate, lower interrogation (question-rate), higher mastery, lower shame. Preserve any JSON schema. Keep under 280 words. Output only the improved prompt text.',
    },
    {
      role: 'user',
      content: `Current prompt:\n"${currentContent}"\n\nFitness: ${fitness.toFixed(3)} (target >0.85)\nMetrics: ${JSON.stringify(details)}\nSample size: ${sampleSize}\n\nWrite an improved version.`,
    },
  ], { tier: 'deep', maxTokens: 700, purpose: 'evolution' });

  const newContent = response.content.trim();
  const estimatedNewFitness = Math.min(fitness + 0.05, 0.99);

  await db.query(
    `UPDATE prompt_components SET current_text = $1, generation = generation + 1 WHERE component_id = $2`,
    [newContent, componentId]
  );

  await db.query(
    `INSERT INTO prompt_evolution_log (component_id, old_content, new_content, old_fitness, new_fitness, reason)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      componentId,
      currentContent.slice(0, 500),
      newContent.slice(0, 500),
      fitness,
      estimatedNewFitness,
      `Learning-outcome evolution teach=${details.teachRate?.toFixed(2)} q=${details.questionRate?.toFixed(2)}`,
    ]
  );

  invalidatePromptCache(componentId);

  const event: PromptEvolved = {
    id: uuidv4(),
    type: 'prompt.evolved',
    studentId: 'system',
    sessionId: 'system',
    timestamp: new Date(),
    componentId,
    oldFitness: fitness,
    newFitness: estimatedNewFitness,
  };
  await eventBus.publish(event).catch(() => {});

  return { evolved: true, newContent };
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
    `INSERT INTO prompt_performance (component_id, student_id, session_id, turn_number, student_engagement, mastery_signal, shame_spike, frustration_spike, flow_maintained, answer_leak)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [componentId, studentId, sessionId, turnNumber, outcome.studentEngagement, outcome.masterySignal, outcome.shameSpike, outcome.frustrationSpike, outcome.flowMaintained, outcome.answerLeak]
  ).catch(() => {});
}
