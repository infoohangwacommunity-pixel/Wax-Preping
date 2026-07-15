// Simplified working memory.
// The AI now does the heavy lifting of analysis.
// Working memory just provides the raw material — recent history organized by salience.
// No hardcoded scoring formulas. Just honest data packaging.

import type { ConversationTurn, WorkingMemorySnapshot, SalientTurn } from '../types/student';

function roughSalienceScore(turn: ConversationTurn): number {
  let score = 0;
  const combined = `${turn.studentMessage} ${turn.tutorResponse}`.toLowerCase();

  // Confusion and breakthrough moments are always salient
  if (/don't get|confused|stuck|don't understand|not following/.test(combined)) score += 3;
  if (/oh i see|got it|makes sense|clicked|oh so that's/.test(combined)) score += 3;
  if (/misconception|actually|not quite|interesting twist|common mistake/.test(turn.tutorResponse.toLowerCase())) score += 2.5;
  if (turn.masteryEvidenced) score += 3;
  if (turn.studentMessage.includes('?') && turn.studentMessage.length > 25) score += 1;

  // Recency
  const ageMs = Date.now() - new Date(turn.timestamp).getTime();
  score += Math.max(0, 2 - ageMs / (5 * 60 * 1000));

  return score;
}

export function buildWorkingMemory(history: ConversationTurn[]): WorkingMemorySnapshot {
  if (history.length === 0) {
    return {
      currentTopic: null, currentSubject: null, lastMisconception: null,
      lastAnalogyUsed: null, studentConfidence: 0.5, turnsInCurrentTopic: 0,
      salienceRankedTurns: [], backgroundSummary: 'First message — no history.',
      unresolvedQuestion: null, stuckRepetitionCount: 0, approachesAttempted: [],
      conceptsVisitedThisSession: [], hintLevelCurrent: 0,
    };
  }

  const scored = history.map(t => ({ turn: t, score: roughSalienceScore(t) }));
  scored.sort((a, b) => b.score - a.score);

  const focus = scored.slice(0, 4);
  const background = scored.slice(4).map(s => s.turn);

  const salienceRankedTurns: SalientTurn[] = focus.flatMap(({ turn, score }) => [
    { role: 'student' as const, content: turn.studentMessage.slice(0, 300), salienceScore: score },
    { role: 'tutor' as const, content: turn.tutorResponse.slice(0, 300), salienceScore: score * 0.8 },
  ]);

  // Detect stuck loop — same type of confusion appearing multiple times
  const confusionMessages = history.slice(-6).filter(t =>
    /don't get|still confused|same question|don't understand|not making sense/.test(t.studentMessage.toLowerCase())
  );

  const approachesAttempted: string[] = [];
  history.slice(-6).forEach(t => {
    if (/like|imagine|think of/.test(t.tutorResponse.toLowerCase())) approachesAttempted.push('analogy');
    if (/step by step|first.*then.*finally/.test(t.tutorResponse.toLowerCase())) approachesAttempted.push('step_by_step');
    if (/example|for instance/.test(t.tutorResponse.toLowerCase())) approachesAttempted.push('example');
    if (/why|what do you think|can you guess/.test(t.tutorResponse.toLowerCase())) approachesAttempted.push('socratic');
  });

  const lastTopic = [...history].reverse().find(t => t.topic)?.topic || null;
  const lastSubject = [...history].reverse().find(t => t.subject)?.subject || null;
  const lastMisconception = [...history].reverse().find(t =>
    /actually|small correction|common mistake|not quite|twist here/.test(t.tutorResponse.toLowerCase())
  )?.studentMessage?.slice(0, 200) || null;
  const lastAnalogy = [...history].reverse().find(t =>
    /think of it as|like a|similar to|just like|imagine/.test(t.tutorResponse.toLowerCase())
  )?.tutorResponse?.slice(0, 200) || null;

  const avgConfidence = history.slice(-3).reduce((s, t) => s + (t.aiAnalysis?.emotionalReading?.selfEfficacy ?? 0.5), 0) / Math.min(3, history.length);

  const lastMsg = history[history.length - 1]?.studentMessage || '';
  const unresolvedQuestion = lastMsg.includes('?') && history[history.length - 1]?.tutorResponse?.length < 80 ? lastMsg : null;

  const bgSummary = background.length === 0
    ? 'Only recent turns available.'
    : background.slice(0, 5).map(t => `S: ${t.studentMessage.slice(0, 60)} | T: ${t.tutorResponse.slice(0, 60)}`).join(' — ');

  return {
    currentTopic: lastTopic,
    currentSubject: lastSubject,
    lastMisconception,
    lastAnalogyUsed: lastAnalogy,
    studentConfidence: avgConfidence,
    turnsInCurrentTopic: history.length,
    salienceRankedTurns,
    backgroundSummary: bgSummary,
    unresolvedQuestion,
    stuckRepetitionCount: confusionMessages.length,
    approachesAttempted: [...new Set(approachesAttempted)],
    conceptsVisitedThisSession: [...new Set(history.filter(t => t.topic).map(t => t.topic!))],
    hintLevelCurrent: Math.min(confusionMessages.length * 20, 90),
  };
}

export function formatHistoryForOrchestrator(history: ConversationTurn[], limit = 10): string {
  if (history.length === 0) return 'No previous turns in this session.';

  return history.slice(-limit).map((t, i) =>
    `Turn ${t.turnNumber}:\n  Student: "${t.studentMessage.slice(0, 200)}"\n  Tutor: "${t.tutorResponse.slice(0, 200)}"`
  ).join('\n\n');
}