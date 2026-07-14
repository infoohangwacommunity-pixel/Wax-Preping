import type { EmotionalSnapshot } from '../types/student';
import type { ConversationTurn } from '../types/student';
import type { EmotionalAlert } from '../types/events';
import { v4 as uuidv4 } from 'uuid';

export function detectEmotionalState(
  currentMessage: string,
  history: ConversationTurn[]
): EmotionalSnapshot {
  const m = currentMessage.toLowerCase();
  const recentHistory = history.slice(-5);
  const recentLengths = recentHistory.map(t => t.studentMessage.length);
  const currentLength = currentMessage.length;
  const avgPrevLength = recentLengths.length > 0
    ? recentLengths.reduce((a, b) => a + b, 0) / recentLengths.length
    : currentLength;

  // Shame
  let shamePotential = 0.15;
  if (/i think|maybe|not sure|i don't know|probably|idk|sorry/.test(m)) shamePotential += 0.2;
  if (/i'm stupid|i'm dumb|i'll never|can't do this|everyone else understands/.test(m)) shamePotential += 0.45;
  if (currentLength < 12 && history.length > 3) shamePotential += 0.12;
  const lengthDecline = recentLengths.filter((l, i) => i > 0 && l < recentLengths[i - 1] * 0.7).length;
  shamePotential += lengthDecline * 0.08;

  // Curiosity
  let curiosity = 0.3;
  if (/\?/.test(currentMessage) && currentLength > 20) curiosity += 0.3;
  if (/why|how|what if|but then|interesting|oh wait|wait so|curious/.test(m)) curiosity += 0.2;
  if (currentLength > avgPrevLength * 1.4) curiosity += 0.15;

  // Frustration
  let frustration = 0.1;
  if (/hate|useless|stupid subject|i give up|why is it|so hard|doesn't work/.test(m)) frustration += 0.55;
  if (/!!!|argh|ugh/.test(currentMessage)) frustration += 0.2;

  // Self-efficacy
  let selfEfficacy = 0.45;
  if (/i get it|i understand|got it|makes sense|i see/.test(m)) selfEfficacy += 0.3;
  selfEfficacy -= shamePotential * 0.3;
  selfEfficacy -= frustration * 0.2;

  // Tiredness
  const hour = new Date().getHours();
  const tiredness = hour >= 23 || hour < 5 ? 0.75 : hour >= 21 ? 0.45 : 0.1;

  // Excitement
  const excitement = curiosity > 0.65 && frustration < 0.3 ? 0.65 : 0.15;

  const valence = Math.max(0, 1 - frustration);
  const arousal = frustration > 0.5 ? 0.75 : curiosity > 0.6 ? 0.6 : 0.4;
  const flowIndicator = curiosity > 0.6 && shamePotential < 0.3 && selfEfficacy > 0.5 ? 0.7 : 0.2;

  return {
    valence: Math.max(0, Math.min(1, valence)),
    arousal: Math.max(0, Math.min(1, arousal)),
    dominance: Math.max(0, Math.min(1, selfEfficacy)),
    shamePotential: Math.max(0, Math.min(1, shamePotential)),
    curiosity: Math.max(0, Math.min(1, curiosity)),
    selfEfficacy: Math.max(0, Math.min(1, selfEfficacy)),
    flowIndicator: Math.max(0, Math.min(1, flowIndicator)),
    frustration: Math.max(0, Math.min(1, frustration)),
    tiredness: Math.max(0, Math.min(1, tiredness)),
    excitement: Math.max(0, Math.min(1, excitement)),
  };
}

export function predictShameTrajectory(recentStates: EmotionalSnapshot[]): number {
  if (recentStates.length < 2) return recentStates[0]?.shamePotential ?? 0.3;
  const shameTrend = recentStates.slice(-3).reduce((acc, s, i, arr) => {
    if (i === 0) return 0;
    return acc + (s.shamePotential - arr[i - 1].shamePotential);
  }, 0);
  const current = recentStates[recentStates.length - 1].shamePotential;
  return Math.max(0, Math.min(1, current + shameTrend * 1.5));
}

export function predictFlowTrajectory(recentStates: EmotionalSnapshot[]): number {
  if (recentStates.length < 2) return recentStates[0]?.flowIndicator ?? 0.2;
  const curiosityTrend = recentStates.length >= 2
    ? recentStates[recentStates.length - 1].curiosity - recentStates[recentStates.length - 2].curiosity
    : 0;
  const current = recentStates[recentStates.length - 1];
  return Math.max(0, Math.min(1, current.flowIndicator + curiosityTrend * 0.5 + current.selfEfficacy * 0.2));
}

export function checkForEmotionalAlert(
  state: EmotionalSnapshot,
  studentId: string,
  sessionId: string
): EmotionalAlert | null {
  if (state.shamePotential > 0.72) {
    return { id: uuidv4(), type: 'emotional.alert', studentId, sessionId, timestamp: new Date(), emotion: 'shame_spike', confidence: state.shamePotential, urgency: 'immediate', recommendedAction: 'invisible_scaffolding_max_warmth' };
  }
  if (state.frustration > 0.7) {
    return { id: uuidv4(), type: 'emotional.alert', studentId, sessionId, timestamp: new Date(), emotion: 'frustration', confidence: state.frustration, urgency: 'immediate', recommendedAction: 'acknowledge_then_reframe' };
  }
  if (state.arousal > 0.72 && state.valence < 0.35) {
    return { id: uuidv4(), type: 'emotional.alert', studentId, sessionId, timestamp: new Date(), emotion: 'anxiety_rising', confidence: state.arousal, urgency: 'immediate', recommendedAction: 'ground_and_reassure' };
  }
  if (state.curiosity < 0.22 && state.flowIndicator < 0.22 && state.frustration < 0.4) {
    return { id: uuidv4(), type: 'emotional.alert', studentId, sessionId, timestamp: new Date(), emotion: 'boredom', confidence: 1 - state.curiosity, urgency: 'monitor', recommendedAction: 'pivot_to_curiosity_hook' };
  }
  if (state.flowIndicator > 0.65) {
    return { id: uuidv4(), type: 'emotional.alert', studentId, sessionId, timestamp: new Date(), emotion: 'flow_detected', confidence: state.flowIndicator, urgency: 'low', recommendedAction: 'maintain_no_interruptions' };
  }
  if (state.selfEfficacy > 0.75 && state.curiosity > 0.7) {
    return { id: uuidv4(), type: 'emotional.alert', studentId, sessionId, timestamp: new Date(), emotion: 'breakthrough', confidence: state.selfEfficacy, urgency: 'low', recommendedAction: 'celebrate_and_extend' };
  }
  return null;
}