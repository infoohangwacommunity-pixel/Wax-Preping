export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface LLMResponse {
  content: string;
  modelUsed: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface StructuredTutorResponse {
  responseText: string;
  emotionalTone: 'warm' | 'encouraging' | 'neutral' | 'concerned' | 'playful' | 'celebratory';
  confidence: number;
  detectedTopic: string | null;
  detectedSubject: string | null;
  misconceptionAddressed: string | null;
  masterySignalDetected: boolean;
  masteryEvidenceType: string | null;
  memoryUpdates: MemoryUpdate[];
  conceptsToReview: string[];
  suggestedNextConcept: string | null;
  usedTools: string[];
  examStrategyNote: string | null;
}

export interface MemoryUpdate {
  block: 'humanProfile' | 'learningStyle' | 'progress' | 'shameMap' | 'curiosityMap' | 'procedural' | 'examStrategy' | 'errorPatterns' | 'breakthroughs';
  operation: 'append' | 'replace' | 'delete';
  content: string;
}