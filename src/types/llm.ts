export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  modelUsed: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
}

export interface MemoryUpdate {
  block: 'humanProfile' | 'learningStyle' | 'progress' | 'shameMap' | 'curiosityMap' | 'procedural' | 'examStrategy' | 'errorPatterns' | 'breakthroughs';
  operation: 'append' | 'replace' | 'delete';
  content: string;
}

export interface WaxData {
  topic: string;
  subject: string;
  misconception: string;
  masterySignal: boolean;
  masteryType: string;
  memoryUpdates: MemoryUpdate[];
  scheduleReview: boolean;
  usedAnalogy: string;
  examStrategyNote: string;
  symbolicBeliefUpdate?: {
    concept: string;
    claim: string;
    status: 'UNDERSTANDS' | 'CONFUSES' | 'HAS_NOT_SEEN' | 'MASTERS';
    confidence: 'high' | 'medium' | 'low';
    evidence: string;
  };
}