// Ephemeral working memory.
// Lives only for the duration of one request.
// Reconstructed from the conversation window every single time.
// No database. No Redis. Nothing persists.
// Think of this as the tutor's short-term mental workspace
// that gets wiped and rebuilt fresh on every message received.

import type { ConversationTurn } from "../types/student";
import type { WorkingMemorySnapshot, SalientTurn } from "../types/events";

// These signals tell us which turns are worth keeping in the
// tutor's active attention. Everything else gets compressed to a summary.
function computeSalienceScore(turn: ConversationTurn): number {
  let score = 0;

  const combined = (turn.studentMessage + " " + turn.tutorResponse).toLowerCase();

  // The student revealed confusion or didn't understand something
  if (/don't get|don't understand|confused|what does|why does|how does|makes no sense|lost me|i'm stuck/.test(combined)) {
    score += 3.0;
  }

  // A misconception was present
  if (turn.emotionalSnapshot && turn.emotionalSnapshot.shamePotential > 0.5) {
    score += 2.5;
  }

  // The topic shifted in this turn
  if (/actually|wait|so you mean|so basically|let me try|let me think|oh so/.test(combined)) {
    score += 1.5;
  }

  // The student showed understanding or a breakthrough
  if (/oh i see|got it|so basically|makes sense|ah okay|now i understand|that makes sense/.test(combined)) {
    score += 2.0;
  }

  // The student asked a follow-up question (shows engagement)
  if (/\?/.test(turn.studentMessage) && turn.studentMessage.length > 20) {
    score += 1.0;
  }

  // The tutor introduced an analogy (high value for recall)
  if (/like|imagine|think of it as|similar to|just like/.test(turn.tutorResponse.toLowerCase())) {
    score += 1.2;
  }

  // Recency matters — more recent turns are more relevant
  const ageInTurns = Date.now() - turn.timestamp.getTime();
  const recencyBonus = Math.max(0, 2.0 - ageInTurns / (60 * 1000));
  score += recencyBonus;

  return score;
}

function inferCurrentTopic(turns: ConversationTurn[]): string | null {
  if (turns.length === 0) return null;

  // The most recent student messages likely reveal the current topic
  const recentMessages = turns
    .slice(-5)
    .map((t) => t.studentMessage)
    .join(" ")
    .toLowerCase();

  // We don't hardcode subjects. We extract whatever concept is being discussed.
  // The LLM will do the heavy lifting. We just give it the raw material.
  return recentMessages.length > 0 ? recentMessages.slice(0, 200) : null;
}

function inferStudentConfidence(turns: ConversationTurn[]): number {
  if (turns.length === 0) return 0.5;

  const recent = turns.slice(-3);
  const avgSelfEfficacy =
    recent.reduce((sum, t) => sum + (t.emotionalSnapshot?.selfEfficacy ?? 0.5), 0) /
    recent.length;

  return avgSelfEfficacy;
}

function findLastMisconception(turns: ConversationTurn[]): string | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    const msg = (turn.studentMessage + " " + turn.tutorResponse).toLowerCase();
    if (/wrong|misconception|actually|correction|not quite|that's not|not exactly/.test(msg)) {
      return turn.studentMessage;
    }
  }
  return null;
}

function findLastScaffoldUsed(turns: ConversationTurn[]): string | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (/think of it as|imagine|like a|similar to|the same way|just like/.test(turn.tutorResponse.toLowerCase())) {
      return turn.tutorResponse.slice(0, 200);
    }
  }
  return null;
}

function compressBackgroundTurns(turns: ConversationTurn[]): string {
  if (turns.length === 0) return "No previous context.";

  return turns
    .map((t) => `S: ${t.studentMessage.slice(0, 80)} | T: ${t.tutorResponse.slice(0, 80)}`)
    .join(" | ");
}

function findUnresolvedQuestion(turns: ConversationTurn[]): string | null {
  if (turns.length === 0) return null;

  const lastTurn = turns[turns.length - 1];

  // If the last student message was a question and the tutor's response
  // didn't seem to fully address it, flag it
  if (
    lastTurn.studentMessage.includes("?") &&
    lastTurn.tutorResponse.length < 100
  ) {
    return lastTurn.studentMessage;
  }

  return null;
}

// Build the working memory snapshot from the conversation history.
// Call this on every incoming message. It is cheap. It is ephemeral. It is critical.
export function buildWorkingMemory(history: ConversationTurn[]): WorkingMemorySnapshot {
  if (history.length === 0) {
    return {
      currentTopic: null,
      lastMisconception: null,
      lastScaffoldUsed: null,
      studentConfidence: 0.5,
      turnsInCurrentTopic: 0,
      salienceRankedTurns: [],
      backgroundSummary: "This is the beginning of the conversation.",
      unresolvedQuestion: null,
      studentLeadingConversation: false,
    };
  }

  // Score every turn for salience
  const scored = history.map((turn) => ({
    turn,
    score: computeSalienceScore(turn),
  }));

  // Sort by salience and pick the top 4 (human working memory: 4 ± 1 items)
  scored.sort((a, b) => b.score - a.score);
  const focusTurns = scored.slice(0, 4);
  const backgroundTurns = scored.slice(4).map((s) => s.turn);

  const salienceRankedTurns: SalientTurn[] = focusTurns.flatMap(({ turn, score }) => [
    {
      role: "student" as const,
      content: turn.studentMessage,
      salienceScore: score,
      tags: score > 2 ? ["high_salience"] : ["moderate_salience"],
    },
    {
      role: "tutor" as const,
      content: turn.tutorResponse,
      salienceScore: score * 0.8,
      tags: [],
    },
  ]);

  const studentMessages = history.map((t) => t.studentMessage);
  const lastMessage = studentMessages[studentMessages.length - 1] || "";
  const studentLeading = lastMessage.includes("?") || lastMessage.length > 50;

  return {
    currentTopic: inferCurrentTopic(history),
    lastMisconception: findLastMisconception(history),
    lastScaffoldUsed: findLastScaffoldUsed(history),
    studentConfidence: inferStudentConfidence(history),
    turnsInCurrentTopic: history.length,
    salienceRankedTurns,
    backgroundSummary: compressBackgroundTurns(backgroundTurns),
    unresolvedQuestion: findUnresolvedQuestion(history),
    studentLeadingConversation: studentLeading,
  };
}