import type { EmotionalSnapshot, PedagogicalIntent, WorkingMemorySnapshot } from './student';

export type EventType =
  | 'student.message.received'
  | 'student.image.received'
  | 'student.voice.received'
  | 'student.document.received'
  | 'planner.force.emitted'
  | 'tutor.response.generated'
  | 'memory.update.requested'
  | 'emotional.alert'
  | 'student.silence.detected'
  | 'session.started'
  | 'session.ended'
  | 'mastery.detected'
  | 'misconception.detected'
  | 'flow.state.entered'
  | 'shame.spike.detected'
  | 'stuck.loop.detected'
  | 'exam.approaching'
  | 'study.streak.updated'
  | 'spaced.review.due';

export interface BaseEvent {
  id: string;
  type: EventType;
  studentId: string;
  sessionId: string;
  timestamp: Date;
}

export interface StudentMessageReceived extends BaseEvent {
  type: 'student.message.received';
  rawMessage: string;
  messageId: string;
  modality: 'text' | 'image' | 'voice' | 'video' | 'interactive' | 'document';
  pedagogicalIntent?: PedagogicalIntent;
  workingMemory?: WorkingMemorySnapshot;
  isFirstMessage?: boolean;
}

export interface PlannerForceEmitted extends BaseEvent {
  type: 'planner.force.emitted';
  forceVector: ForceVector;
}

export interface ForceVector {
  warmth: number;
  scaffolding: number;
  pacing: number;
  curiosityBait: number;
  safetyEmphasis: number;
  directness: number;
  useAnalogy: number;
  checkIn: number;
  metacognitive: number;
  socratic: number;
  culturalGrounding: number;
  hintLevel: number;
}

export interface TutorResponseGenerated extends BaseEvent {
  type: 'tutor.response.generated';
  responseText: string;
  responseVoiceUrl?: string;
  emotionalTone: 'warm' | 'encouraging' | 'neutral' | 'concerned' | 'playful' | 'celebratory';
  modelUsed: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  usedTools: string[];
  forceVectorApplied?: ForceVector;
  masteryDetected?: string;
  misconceptionAddressed?: string;
}

export interface EmotionalAlert extends BaseEvent {
  type: 'emotional.alert';
  emotion: 'shame_spike' | 'anxiety_rising' | 'boredom' | 'flow_detected' | 'disengagement' | 'frustration' | 'breakthrough';
  confidence: number;
  urgency: 'immediate' | 'monitor' | 'low';
  recommendedAction: string;
}

export interface StuckLoopDetected extends BaseEvent {
  type: 'stuck.loop.detected';
  concept: string;
  repetitionCount: number;
  approachesAttempted: string[];
}

export interface MasteryDetected extends BaseEvent {
  type: 'mastery.detected';
  concept: string;
  evidenceType: 'self_explanation' | 'novel_application' | 'transfer' | 'teach_back';
  masteryLevel: number;
}

export interface SpacedReviewDue extends BaseEvent {
  type: 'spaced.review.due';
  concepts: string[];
  urgency: 'critical' | 'soon' | 'optional';
}

export type AnyEvent =
  | StudentMessageReceived
  | PlannerForceEmitted
  | TutorResponseGenerated
  | EmotionalAlert
  | StuckLoopDetected
  | MasteryDetected
  | SpacedReviewDue;