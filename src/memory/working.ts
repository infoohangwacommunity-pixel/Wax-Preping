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
  if (/don't get|don't understand|confused|what does|why does|how does|makes no sense|lost me|i