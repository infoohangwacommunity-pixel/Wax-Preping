// The Planner.
// It does not decide "what state the student is in."
// It computes a continuous force vector that shapes the AI's response.
// High warmth + high scaffolding + low pace = gentle, supportive, slow.
// High curiosity + high directness + medium pace = engaged, exploratory, confident.
// The AI reads this force vector and adjusts its tone, depth, and approach.

import type {
  EmotionalSnapshot,
  PedagogicalIntent,
  WorkingMemorySnapshot,
  PlannerForceEmitted,
} from "../types/events";
import type { StudentProfile } from "../types/student";

type ForceVector = PlannerForceEmitted["forceVector"];

// Compute the pedagogical force vector.
// This is the Planner's entire output. Everything else is derived from it.
export function computeForceVector(
  emotionalState: EmotionalSnapshot,
  intent: PedagogicalIntent,
  workingMemory: WorkingMemorySnapshot,
  profile: StudentProfile
): ForceVector {
  // Start with neutral forces
  let warmth = 0.5;
  let scaffolding = 0.5;
  let pacing = 0.0; // -1 = slow down, 0 = normal, +1 = speed up
  let curiosityBait = 0.5;
  let safetyEmphasis = 0.3;
  let directness = 0.5;
  let useAnalogy = 0.5;
  let checkIn = 0.3;

  // --- EMOTIONAL STATE ADJUSTMENTS ---

  // High shame potential: become safer, warmer, more invisible with scaffolding
  if (emotionalState.shamePotential > 0.6) {
    warmth = Math.min(1.0, warmth + 0.35);
    safetyEmphasis = Math.min(1.0, safetyEmphasis + 0.4);
    scaffolding = Math.min(1.0, scaffolding + 0.3);
    pacing = Math.max(-1.0, pacing - 0.4); // slow down
    directness = Math.max(0.0, directness - 0.2); // be gentler
  }

  // High anxiety: ground the student first, don't push forward
  if (emotionalState.arousal > 0.7 && emotionalState.valence < 0.4) {
    warmth = Math.min(1.0, warmth + 0.3);
    pacing = Math.max(-1.0, pacing - 0.5);
    safetyEmphasis = Math.min(1.0, safetyEmphasis + 0.5);
    scaffolding = Math.min(1.0, scaffolding + 0.4);
  }

  // Flow detected: maintain the pace, stay curious with them
  if (emotionalState.flowIndicator > 0.6) {
    curiosityBait = Math.min(1.0, curiosityBait + 0.3);
    pacing = Math.min(1.0, pacing + 0.2);
    checkIn = Math.max(0.0, checkIn - 0.2); // Don't interrupt flow with check-ins
  }

  // Boredom: inject curiosity, speed up, pivot
  if (emotionalState.curiosity < 0.25 && emotionalState.flowIndicator < 0.25) {
    curiosityBait = Math.min(1.0, curiosityBait + 0.5);
    pacing = Math.min(1.0, pacing + 0.3);
    useAnalogy = Math.min(1.0, useAnalogy + 0.4);
  }

  // Low self-efficacy: scaffold heavily, use their own examples
  if (emotionalState.selfEfficacy < 0.35) {
    scaffolding = Math.min(1.0, scaffolding + 0.4);
    useAnalogy = Math.min(1.0, useAnalogy + 0.3);
    warmth = Math.min(1.0, warmth + 0.2);
    checkIn = Math.min(1.0, checkIn + 0.3);
  }

  // --- INTENT ADJUSTMENTS ---

  if (intent.primaryIntent === "expressing_confusion") {
    scaffolding = Math.min(1.0, scaffolding + 0.3);
    pacing = Math.max(-1.0, pacing - 0.2);
    useAnalogy = Math.min(1.0, useAnalogy + 0.3);
  }

  if (intent.primaryIntent === "seeking_clarification") {
    directness = Math.min(1.0, directness + 0.2);
    checkIn = Math.min(1.0, checkIn + 0.2);
  }

  if (intent.primaryIntent === "exploring_curiosity") {
    curiosityBait = Math.min(1.0, curiosityBait + 0.4);
    pacing = Math.min(1.0, pacing + 0.2);
    directness = Math.max(0.0, directness - 0.1); // Wander with them
  }

  if (intent.primaryIntent === "expressing_frustration") {
    warmth = Math.min(1.0, warmth + 0.4);
    safetyEmphasis = Math.min(1.0, safetyEmphasis + 0.3);
    pacing = Math.max(-1.0, pacing - 0.3);
  }

  if (intent.primaryIntent === "showing_understanding") {
    pacing = Math.min(1.0, pacing + 0.2);
    curiosityBait = Math.min(1.0, curiosityBait + 0.3);
    warmth = Math.min(1.0, warmth + 0.2); // Celebrate without being patronizing
  }

  if (intent.hasMisconception) {
    scaffolding = Math.min(1.0, scaffolding + 0.3);
    useAnalogy = Math.min(1.0, useAnalogy + 0.4);
    directness = Math.max(0.0, directness - 0.2); // Correct gently
    safetyEmphasis = Math.min(1.0, safetyEmphasis + 0.2);
  }

  // High exam pressure: be more focused and direct
  if (intent.temporalPressure === "high") {
    directness = Math.min(1.0, directness + 0.3);
    warmth = Math.min(1.0, warmth + 0.2); // Still warm but efficient
    pacing = Math.min(1.0, pacing + 0.2);
  }

  // --- WORKING MEMORY ADJUSTMENTS ---

  // If there's an unresolved question from a previous turn, address it
  if (workingMemory.unresolvedQuestion) {
    checkIn = Math.min(1.0, checkIn + 0.3);
    scaffolding = Math.min(1.0, scaffolding + 0.2);
  }

  // Student has been on the same topic for many turns — might need a fresh angle
  if (workingMemory.turnsInCurrentTopic > 10) {
    curiosityBait = Math.min(1.0, curiosityBait + 0.3);
    useAnalogy = Math.min(1.0, useAnalogy + 0.2);
  }

  // If student is leading the conversation, follow their energy
  if (workingMemory.studentLeadingConversation) {
    directness = Math.max(0.0, directness - 0.15);
    curiosityBait = Math.min(1.0, curiosityBait + 0.2);
  }

  // --- PROFILE-BASED ADJUSTMENTS ---

  if (profile.learningStyle.prefersAnalogies) {
    useAnalogy = Math.min(1.0, useAnalogy + 0.3);
  }

  if (profile.emotionalProfile.shameThreshold < 0.4) {
    // This student is easily shamed — always prioritize safety
    safetyEmphasis = Math.min(1.0, safetyEmphasis + 0.25);
    warmth = Math.min(1.0, warmth + 0.2);
  }

  return {
    warmth: Math.max(0, Math.min(1, warmth)),
    scaffolding: Math.max(0, Math.min(1, scaffolding)),
    pacing: Math.max(-1, Math.min(1, pacing)),
    curiosityBait: Math.max(0, Math.min(1, curiosityBait)),
    safetyEmphasis: Math.max(0, Math.min(1, safetyEmphasis)),
    directness: Math.max(0, Math.min(1, directness)),
    useAnalogy: Math.max(0, Math.min(1, useAnalogy)),
    checkIn: Math.max(0, Math.min(1, checkIn)),
  };
}