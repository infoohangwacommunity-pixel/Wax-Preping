// The World Model. WaxPrep predicts the student's future before it happens.
// Runs hourly via world_model_worker.ts
// Outputs predictions stored in world_model_state table.
// The swarm reads these predictions when composing responses.

import { callBrain } from '../brain/llama_server';
import { db } from '../db/client';
import { logger } from '../middleware/logger';

export interface WorldModelPrediction {
  studentId: string;
  predictedNextMistake: string;
  predictedForgetConcepts: string[];
  predictedFrustrationProbability: number;
  predictedFlowProbability: number;
  predictedExamScore: number;
  predictedExamScoreTrend: 'improving' | 'declining' | 'stable';
  willBurnOutIfContinues: boolean;
  optimalStudyWindowsToday: string[];
  modelUpdatedAt: Date;
}

export async function runWorldModel(studentId: string): Promise<WorldModelPrediction | null> {
  try {
    // Gather all data
    const [profile, recentTurns, emotionHistory] = await Promise.all([
      db.query(`SELECT * FROM student_profiles WHERE student_id = $1`, [studentId]),
      db.query(`
        SELECT student_message, topic, subject, ai_analysis, timestamp, mastery_evidenced
        FROM conversation_turns WHERE student_id = $1
        ORDER BY timestamp DESC LIMIT 20`, [studentId]),
      db.query(`
        SELECT (ai_analysis->'emotionalReading') as emotions, timestamp
        FROM conversation_turns WHERE student_id = $1
        ORDER BY timestamp DESC LIMIT 10`, [studentId]),
    ]);

    if (profile.rows.length === 0) return null;

    const row = profile.rows[0];
    const turns = recentTurns.rows;
    const emotions = emotionHistory.rows;

    // Build data narrative for the AI
    const errorDiary = (row.error_diary || []).map((e: { concept: string; count: number }) =>
      `${e.concept} (${e.count}x)`
    ).join(', ');

    const conceptProgress = row.concept_progress || {};
    const lowMastery = Object.entries(conceptProgress)
      .filter(([, v]) => (v as { masteryLevel: number }).masteryLevel < 0.5)
      .map(([k]) => k)
      .slice(0, 5);

    const examTargets = row.exam_targets || [];
    const nextExam = examTargets.find((e: { examDate?: string }) => e.examDate && new Date(e.examDate) > new Date());
    const daysToExam = nextExam?.examDate
      ? Math.ceil((new Date(nextExam.examDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
      : null;

    // Study pattern analysis
    const sessionTimes = turns.map((t: { timestamp: string }) => new Date(t.timestamp as string).getHours());
    const avgStudyHour = sessionTimes.reduce((a: number, b: number) => a + b, 0) / (sessionTimes.length || 1);

    // Emotion trend
    const recentShame = emotions.slice(0, 5).map((e: { emotions?: { shamePotential?: number } }) =>
      e.emotions?.shamePotential || 0
    );
    const shameAvg = recentShame.reduce((a: number, b: number) => a + b, 0) / (recentShame.length || 1);
    const shameTrend = recentShame.length >= 2
      ? recentShame[0] > recentShame[recentShame.length - 1] ? 'rising' : 'falling'
      : 'stable';

    const prompt = `You are a student learning analyst building a predictive world model.

STUDENT DATA:
- Study streak: ${row.study_streak} days
- Total turns: ${row.total_turns}
- Recurring errors: ${errorDiary || 'none'}
- Low mastery concepts (likely to forget): ${lowMastery.join(', ') || 'none'}
- Days to next exam: ${daysToExam || 'no exam set'}
- Average study hour: ${Math.round(avgStudyHour)}:00
- Recent shame trend: ${shameTrend} (current avg: ${shameAvg.toFixed(2)})
- Recent session activity: ${turns.slice(0, 5).map((t: { topic: string; mastery_evidenced: boolean }) => `${t.topic || 'general'} (mastered: ${t.mastery_evidenced})`).join(', ')}

PREDICTIONS NEEDED:
1. What mistake will they likely make in their next 2-3 sessions?
2. Which concepts are they most likely to forget in the next 3 days? (Ebbinghaus forgetting curve)
3. What is the probability (0-1) they will get frustrated in their next session?
4. What is the probability (0-1) they will enter flow state in their next session?
5. If they continue at this pace, what exam score (0-100) do you predict?
6. Is their score trend improving, declining, or stable?
7. Are they at risk of burnout if they continue at this pace?
8. What are the optimal study windows today (given their time pattern)?

Respond in JSON:
{
  "predictedNextMistake": "specific description",
  "predictedForgetConcepts": [],
  "predictedFrustrationProbability": 0.0,
  "predictedFlowProbability": 0.0,
  "predictedExamScore": 0,
  "predictedExamScoreTrend": "improving|declining|stable",
  "willBurnOutIfContinues": false,
  "optimalStudyWindowsToday": ["8:00-10:00", "19:00-21:00"]
}`;

    const response = await callBrain(prompt, 0.3, 600);
    const cleaned = response.replace(/```json|```/g, '').trim();
    const prediction = JSON.parse(cleaned) as Omit<WorldModelPrediction, 'studentId' | 'modelUpdatedAt'>;

    const fullPrediction: WorldModelPrediction = {
      ...prediction,
      studentId,
      modelUpdatedAt: new Date(),
    };

    // Store in database
    await db.query(
      `INSERT INTO world_model_state (
         student_id, predicted_next_mistake, predicted_forget_concepts,
         predicted_frustration_probability, predicted_flow_probability,
         predicted_exam_score, predicted_exam_score_trend, model_updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (student_id) DO UPDATE SET
         predicted_next_mistake = EXCLUDED.predicted_next_mistake,
         predicted_forget_concepts = EXCLUDED.predicted_forget_concepts,
         predicted_frustration_probability = EXCLUDED.predicted_frustration_probability,
         predicted_flow_probability = EXCLUDED.predicted_flow_probability,
         predicted_exam_score = EXCLUDED.predicted_exam_score,
         predicted_exam_score_trend = EXCLUDED.predicted_exam_score_trend,
         model_updated_at = NOW()`,
      [
        studentId,
        fullPrediction.predictedNextMistake,
        fullPrediction.predictedForgetConcepts,
        fullPrediction.predictedFrustrationProbability,
        fullPrediction.predictedFlowProbability,
        fullPrediction.predictedExamScore,
        fullPrediction.predictedExamScoreTrend,
      ]
    );

    // Trigger proactive notifications if needed
    if (fullPrediction.predictedFrustrationProbability > 0.7) {
      await db.query(
        `INSERT INTO notification_queue (id, student_id, type, content, scheduled_at, priority)
         VALUES (gen_random_uuid(), $1, 'frustration_prevention', $2, NOW() + INTERVAL '30 minutes', 7)
         ON CONFLICT DO NOTHING`,
        [studentId, `World model flagged high frustration risk. Send something warm and encouraging before they start their next session.`]
      );
    }

    if (fullPrediction.predictedForgetConcepts.length > 0) {
      await db.query(
        `INSERT INTO notification_queue (id, student_id, type, content, scheduled_at, priority)
         VALUES (gen_random_uuid(), $1, 'spaced_review', $2, NOW() + INTERVAL '2 hours', 6)
         ON CONFLICT DO NOTHING`,
        [studentId, `World model predicts student will forget: ${fullPrediction.predictedForgetConcepts.join(', ')}. Trigger a proactive spaced review using the analogy that worked best.`]
      );
    }

    return fullPrediction;
  } catch (err) {
    logger.error(`[WorldModel] Failed for ${studentId}:`, err);
    return null;
  }
}

export async function getWorldModelState(studentId: string): Promise<WorldModelPrediction | null> {
  const result = await db.query(
    `SELECT * FROM world_model_state WHERE student_id = $1`,
    [studentId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    studentId: row.student_id,
    predictedNextMistake: row.predicted_next_mistake,
    predictedForgetConcepts: row.predicted_forget_concepts || [],
    predictedFrustrationProbability: row.predicted_frustration_probability,
    predictedFlowProbability: row.predicted_flow_probability,
    predictedExamScore: row.predicted_exam_score,
    predictedExamScoreTrend: row.predicted_exam_score_trend,
    willBurnOutIfContinues: false,
    optimalStudyWindowsToday: [],
    modelUpdatedAt: new Date(row.model_updated_at),
  };
}