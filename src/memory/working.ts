import type { ConversationTurn } from '../types/student';
import type { WorkingMemorySnapshot, SalientTurn } from '../types/student';

function salienceScore(turn: ConversationTurn): number {
  let score = 0;
  const combined = `${turn.studentMessage} ${turn.tutorResponse}`.toLowerCase();

  // Confusion signals
  if (/don't get|confused|doesn't make sense|what does|how does|lost|stuck|i don't understand/.test(combined)) score += 3.0;

  // Misconception addressed
  if (/actually|not quite|small correction|twist here|common mistake|many people think|let me clarify/.test(combined)) score += 2.5;

  // Emotional peak
  if (turn.emotionalSnapshot?.shamePotential > 0.6) score += 2.0;
  if (turn.emotionalSnapshot?.curiosity > 0.7) score += 1.5;

  // Breakthrough moment
  if (/oh i see|got it|makes sense|that explains|now i get|clicked|oh wow|so basically|so that means/.test(combined)) score += 3.0;

  // Analogy introduced
  if (/like|imagine|think of|similar to|just like|same as|remember when/.test(turn.tutorResponse.toLowerCase())) score += 1.5;

  // Question follow-up
  if (turn.studentMessage.includes('?') && turn.studentMessage.length > 25) score += 1.2;

  // Recency bonus
  const ageMs = Date.now() - new Date(turn.timestamp).getTime();
  score += Math.max(0, 2.0 - ageMs / (5 * 60 * 1000));

  return score;
}

function detectStuckLoop(history: ConversationTurn[]): { count: number; approaches: string[] } {
  if (history.length < 3) return { count: 0, approaches: [] };

  const recent = history.slice(-6);
  const studentMessages = recent.map(t => t.studentMessage.toLowerCase());

  const confusionCount = studentMessages.filter(m =>
    /don't get|still confused|same question|don't understand|not making sense/.test(m)
  ).length;

  const approaches: string[] = [];
  recent.forEach(t => {
    if (/like|imagine|think of/.test(t.tutorResponse.toLowerCase())) approaches.push('analogy');
    if (/step by step|first|then|next/.test(t.tutorResponse.toLowerCase())) approaches.push('step_by_step');
    if (/example|for instance|such as/.test(t.tutorResponse.toLowerCase())) approaches.push('example');
    if (/why|what do you think|can you guess/.test(t.tutorResponse.toLowerCase())) approaches.push('socratic');
  });

  return { count: confusionCount, approaches: [...new Set(approaches)] };
}

function findCurrentTopic(history: ConversationTurn[]): { topic: string | null; subject: string | null } {
  if (history.length === 0) return { topic: null, subject: null };

  // Look at recent turns for topic/subject
  for (let i = history.length - 1; i >= Math.max(0, history.length - 5); i--) {
    if (history[i].topic) return { topic: history[i].topic!, subject: history[i].subject || null };
  }

  return { topic: null, subject: null };
}

export function buildWorkingMemory(history: ConversationTurn[]): WorkingMemorySnapshot {
  if (history.length === 0) {
    return {
      currentTopic: null, currentSubject: null, lastMisconception: null,
      lastScaffoldUsed: null, lastAnalogyUsed: null, studentConfidence: 0.5,
      turnsInCurrentTopic: 0, salienceRankedTurns: [], backgroundSummary: 'Beginning of conversation.',
      unresolvedQuestion: null, studentLeadingConversation: false,
      stuckRepetitionCount: 0, approachesAttempted: [], conceptsVisitedThisSession: [],
      hintLevelCurrent: 0,
    };
  }

  const scored = history.map(t => ({ turn: t, score: salienceScore(t) }));
  scored.sort((a, b) => b.score - a.score);

  const focusTurns = scored.slice(0, 4);
  const background = scored.slice(4).map(s => s.turn);

  const salienceRankedTurns: SalientTurn[] = focusTurns.flatMap(({ turn, score }) => [
    { role: 'student' as const, content: turn.studentMessage.slice(0, 300), salienceScore: score, tags: score > 2 ? ['high'] : ['moderate'] },
    { role: 'tutor' as const, content: turn.tutorResponse.slice(0, 300), salienceScore: score * 0.8, tags: [] },
  ]);

  // Find last analogy
  let lastAnalogyUsed: string | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (/think of it as|like a|similar to|just like|imagine/.test(history[i].tutorResponse.toLowerCase())) {
      lastAnalogyUsed = history[i].tutorResponse.slice(0, 200);
      break;
    }
  }

  // Find last misconception
  let lastMisconception: string | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (/actually|small correction|common mistake|not quite|let me clarify/.test(history[i].tutorResponse.toLowerCase())) {
      lastMisconception = history[i].studentMessage.slice(0, 200);
      break;
    }
  }

  // Find last scaffold
  let lastScaffoldUsed: string | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (/step by step|first let|start with|build from|let me show/.test(history[i].tutorResponse.toLowerCase())) {
      lastScaffoldUsed = history[i].tutorResponse.slice(0, 150);
      break;
    }
  }

  const stuckInfo = detectStuckLoop(history);
  const { topic, subject } = findCurrentTopic(history);

  const avgConfidence = history.slice(-3).reduce((sum, t) => sum + (t.emotionalSnapshot?.selfEfficacy ?? 0.5), 0) / Math.min(3, history.length);

  const lastMsg = history[history.length - 1]?.studentMessage || '';
  const studentLeading = lastMsg.length > 40 || lastMsg.includes('?');

  const unresolvedQuestion = (
    lastMsg.includes('?') && history.length > 0 && history[history.length - 1].tutorResponse.length < 80
  ) ? lastMsg : null;

  const conceptsVisited = [...new Set(history.filter(t => t.topic).map(t => t.topic!))];

  const bgSummary = background.length === 0
    ? 'Conversation just started.'
    : background.map(t => `S: ${t.studentMessage.slice(0, 60)} | T: ${t.tutorResponse.slice(0, 60)}`).join(' — ');

  const currentHintLevel = Math.min(stuckInfo.count * 10, 90);

  return {
    currentTopic: topic,
    currentSubject: subject,
    lastMisconception,
    lastScaffoldUsed,
    lastAnalogyUsed,
    studentConfidence: avgConfidence,
    turnsInCurrentTopic: history.length,
    salienceRankedTurns,
    backgroundSummary: bgSummary,
    unresolvedQuestion,
    studentLeadingConversation: studentLeading,
    stuckRepetitionCount: stuckInfo.count,
    approachesAttempted: stuckInfo.approaches,
    conceptsVisitedThisSession: conceptsVisited,
    hintLevelCurrent: currentHintLevel,
  };
}