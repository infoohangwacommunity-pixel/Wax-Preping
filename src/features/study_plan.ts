import { routeAndCall } from '../llm/router';
import type { StudyPlan, WeeklyTarget } from '../types/student';
import { db } from '../db/client';
import { logger } from '../middleware/logger';

export async function generateStudyPlan(
  studentId: string,
  subject: string,
  examDate: Date,
  conceptGaps: string[],
  studentStrengths: string[]
): Promise<StudyPlan> {
  const weeksUntilExam = Math.max(1, Math.ceil((examDate.getTime() - Date.now()) / (7 * 24 * 60 * 60 * 1000)));
  const effectiveWeeks = Math.min(weeksUntilExam, 12);

  const planResponse = await routeAndCall([
    {
      role: 'system',
      content: `You are a Nigerian exam prep expert for WAEC and JAMB. Create a realistic study plan.
Respond in JSON: { "weeklyTargets": [{ "week": 1, "concepts": ["concept1", "concept2"], "isCompleted": false }] }
Rules: Max 3 concepts per week. Start with gaps. End with revision. Account for student strengths to skip basics they know.`,
    },
    {
      role: 'user',
      content: `Subject: ${subject}
Exam date: ${examDate.toDateString()} (${effectiveWeeks} weeks away)
Concept gaps: ${conceptGaps.join(', ')}
Student strengths: ${studentStrengths.join(', ')}
Create a ${effectiveWeeks}-week study plan.`,
    },
  ], { jsonMode: true });

  let weeklyTargets: WeeklyTarget[] = [];
  try {
    const parsed = JSON.parse(planResponse.content);
    weeklyTargets = parsed.weeklyTargets || [];
  } catch {
    logger.warn('[StudyPlan] Failed to parse plan JSON');
    weeklyTargets = conceptGaps.slice(0, effectiveWeeks * 3).reduce((acc: WeeklyTarget[], concept, i) => {
      const week = Math.floor(i / 3) + 1;
      if (!acc[week - 1]) acc[week - 1] = { week, concepts: [], isCompleted: false };
      acc[week - 1].concepts.push(concept);
      return acc;
    }, []);
  }

  const plan: StudyPlan = {
    createdAt: new Date(),
    examDate,
    subject,
    weeklyTargets,
    currentWeek: 1,
  };

  await db.query(
    `UPDATE student_profiles SET study_plan = $1 WHERE student_id = $2`,
    [JSON.stringify(plan), studentId]
  );

  return plan;
}

export function formatStudyPlanMessage(plan: StudyPlan): string {
  const weeksLeft = plan.weeklyTargets.filter(w => !w.isCompleted).length;
  const lines = [`📚 *${plan.subject} Study Plan — ${weeksLeft} weeks to exam*\n`];

  plan.weeklyTargets.slice(0, 6).forEach(week => {
    const status = week.isCompleted ? '✅' : week.week === plan.currentWeek ? '👉' : '📌';
    lines.push(`${status} Week ${week.week}: ${week.concepts.join(', ')}`);
  });

  if (plan.weeklyTargets.length > 6) {
    lines.push(`...and ${plan.weeklyTargets.length - 6} more weeks`);
  }

  lines.push('\nReply "this week" to see what to study this week.');
  return lines.join('\n');
}