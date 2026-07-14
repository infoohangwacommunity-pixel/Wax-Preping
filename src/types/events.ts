// Every piece of communication in the system is an event.
// Modules do not call each other. They emit events and subscribe to them.
// This is the bloodstream of the entire application.

export type EventType =
  | "student.message.received"
  | "planner.force.emitted"
  | "tutor.response.generated"
  | "memory.update.requested"
  | "emotional.alert"
  | "student.silence.detected"
  | "session.started"
  | "session.ended";

export interface BaseEvent {
  id: string;
  type: EventType;
  studentId: string;
  sessionId: string;
  timestamp: Date;
}

export interface StudentMessageReceived extends BaseEvent {
  type: "student.message.received";
  rawMessage: string;
  messageId: string;
  modality: "text" | "image" | "voice" | "video" | "interactive";
  pedagogicalIntent?: PedagogicalIntent;
  workingMemory?: WorkingMemorySnapshot;
}

export interface PlannerForceEmitted extends BaseEvent {
  type: "planner.force.emitted";
  // These are not hardcoded states.
  // They are continuous values from 0.0 to 1.0.
  // The AI uses these to shape its response, not follow a script.
  forceVector: {
    warmth: number;          // How warm and human to sound right now
    scaffolding: number;     // How much structural support to provide
    pacing: number;          // How fast to move (negative = slow down)
    curiosityBait: number;   // How much to lean into wonder and exploration
    safetyEmphasis: number;  // How much to emphasize "no wrong answers"
    directness: number;      // How direct vs. roundabout to be
    useAnalogy: number;      // How strongly to prefer analogies over abstractions
    checkIn: number;         // Whether to explicitly ask "does that make sense?"
  };
}

export interface TutorResponseGenerated extends BaseEvent {
  type: "tutor.response.generated";
  responseText: string;
  emotionalTone: "warm" | "encouraging" | "neutral" | "concerned" | "playful";
  modelUsed: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  usedTool: boolean;
  toolName?: string;
  forceVectorApplied?: PlannerForceEmitted["forceVector"];
}

export interface MemoryUpdateRequested extends BaseEvent {
  type: "memory.update.requested";
  studentMessage: string;
  tutorResponse: string;
  emotionalSnapshot: EmotionalSnapshot;
}

export interface EmotionalAlert extends BaseEvent {
  type: "emotional.alert";
  emotion: "shame_spike" | "anxiety_rising" | "boredom" | "flow_detected" | "disengagement";
  confidence: number;
  urgency: "immediate" | "monitor" | "low";
  recommendedAction: string;
}

export interface StudentSilenceDetected extends BaseEvent {
  type: "student.silence.detected";
  silenceDurationMs: number;
  lastEmotionalState: EmotionalSnapshot;
}

// The student's real-time emotional state.
// Not a label. A continuous vector of dimensions.
export interface EmotionalSnapshot {
  valence: number;        // -1.0 (very negative) to 1.0 (very positive)
  arousal: number;        // 0.0 (calm) to 1.0 (agitated/excited)
  dominance: number;      // 0.0 (overwhelmed) to 1.0 (in control)
  shamePotential: number; // 0.0 (safe) to 1.0 (high shame risk)
  curiosity: number;      // 0.0 (bored) to 1.0 (fascinated)
  selfEfficacy: number;   // 0.0 (helpless) to 1.0 (confident)
  flowIndicator: number;  // 0.0 (not in flow) to 1.0 (deep flow)
}

export interface PedagogicalIntent {
  primaryIntent:
    | "seeking_clarification"
    | "applying_knowledge"
    | "exploring_curiosity"
    | "expressing_confusion"
    | "requesting_example"
    | "showing_understanding"
    | "expressing_frustration"
    | "casual_greeting"
    | "unknown";
  hasMisconception: boolean;
  misconceptionDescription?: string;
  inferredKnowledgeLevel: number;  // 0.0 to 1.0
  inferredTopic?: string;
  temporalPressure: "none" | "low" | "medium" | "high"; // exam urgency
  rawMessage: string;
  emotionalSignals: EmotionalSnapshot;
}

export interface WorkingMemorySnapshot {
  // This lives only for one request. No persistence. No database.
  // It is reconstructed from the conversation window every single time.
  currentTopic: string | null;
  lastMisconception: string | null;
  lastScaffoldUsed: string | null;
  studentConfidence: number;
  turnsInCurrentTopic: number;
  salienceRankedTurns: SalientTurn[];
  backgroundSummary: string;
  unresolvedQuestion: string | null;
  studentLeadingConversation: boolean;
}

export interface SalientTurn {
  role: "student" | "tutor";
  content: string;
  salienceScore: number;
  tags: string[];  // what made this turn salient
}

export type AnyEvent =
  | StudentMessageReceived
  | PlannerForceEmitted
  | TutorResponseGenerated
  | MemoryUpdateRequested
  | EmotionalAlert
  | StudentSilenceDetected;