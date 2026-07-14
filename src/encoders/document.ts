import type { PedagogicalIntent } from '../types/student';
import { routeAndCall } from '../llm/router';
import { logger } from '../middleware/logger';

interface ParsedDocument {
  rawText: string;
  questions: string[];
  topics: string[];
  examBoard: string;
  year: number | null;
  subject: string;
  difficulty: number;
}

async function extractTextFromBuffer(buffer: Buffer): Promise<string> {
  // Use pdf-parse if available
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return data.text;
  } catch {
    logger.warn('[DocumentEncoder] pdf-parse not available');
    return 'PDF document received but could not be parsed';
  }
}

export async function encodeDocumentMessage(
  documentBuffer: Buffer,
  filename?: string
): Promise<{ intent: PedagogicalIntent; parsed: ParsedDocument }> {
  const rawText = await extractTextFromBuffer(documentBuffer);

  // Use LLM to structure the document content
  const structureResponse = await routeAndCall([
    {
      role: 'system',
      content: 'You are analyzing a document sent by a Nigerian student. Extract: exam board (WAEC/JAMB/NECO/other), subject, year, key topics, and the first 3 questions if any. Respond in JSON: { "examBoard": "", "subject": "", "year": null, "topics": [], "questions": [], "difficulty": 0.5 }',
    },
    { role: 'user', content: rawText.slice(0, 3000) },
  ], { jsonMode: true });

  let parsed: ParsedDocument = {
    rawText: rawText.slice(0, 2000),
    questions: [],
    topics: [],
    examBoard: 'unknown',
    year: null,
    subject: 'unknown',
    difficulty: 0.5,
  };

  try {
    const structured = JSON.parse(structureResponse.content);
    parsed = { ...parsed, ...structured };
  } catch {
    logger.warn('[DocumentEncoder] Failed to parse structured LLM output');
  }

  const intent: PedagogicalIntent = {
    primaryIntent: 'exam_prep',
    hasMisconception: false,
    inferredKnowledgeLevel: 0.5,
    inferredSubject: parsed.subject,
    temporalPressure: 'medium',
    rawMessage: `Student sent a ${parsed.examBoard} ${parsed.subject} document. Topics: ${parsed.topics.join(', ')}. ${parsed.questions.length > 0 ? `First question: ${parsed.questions[0]}` : ''}`,
    emotionalSignals: {
      valence: 0.6, arousal: 0.5, dominance: 0.5,
      shamePotential: 0.2, curiosity: 0.5, selfEfficacy: 0.5,
      flowIndicator: 0.3, frustration: 0.2, tiredness: 0.1, excitement: 0.4,
    },
    messageLength: rawText.length,
    containsQuestion: parsed.questions.length > 0,
    languageStyle: 'formal',
    isRepeatedQuestion: false,
    repetitionCount: 0,
  };

  return { intent, parsed };
}