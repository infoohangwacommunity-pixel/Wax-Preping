/**
 * Instant (no-LLM) fact extraction for high-signal student statements.
 *
 * The deep student-model updater runs async after the reply. Without this
 * module, the next turn often still lacks "intended_course=anatomy" and the
 * tutor re-interviews. These heuristics write durable facts immediately when
 * the evidence is obvious from the text.
 */
import { upsertStudentFacts } from './semantic';
import { logger } from '../middleware/logger';

interface Extracted {
  key: string;
  value: string;
  confidence: number;
}

export function extractInstantFacts(message: string): Extracted[] {
  const text = message || '';
  const facts: Extracted[] = [];

  const KNOWN_COURSES = 'anatomy|medicine and surgery|medicine|surgery|nursing|pharmacy|physiotherapy|computer science|engineering|law|accounting|biology|biochemistry|microbiology|mass communication';
  const courseKnown = text.match(new RegExp(`\\b(${KNOWN_COURSES})\\b`, 'i'));
  const coursePhrase = text.match(
    /\b(?:study|studying|admission\s+to\s+study|want(?:ed)?\s+to\s+study|course\s+in)\s+([a-zA-Z][a-zA-Z\s]{2,30}?)(?:\s+in\b|\s+at\b|[.,!?]|$)/i
  );
  if (courseKnown || coursePhrase) {
    let value = (courseKnown?.[1] || coursePhrase?.[1] || '').trim().toLowerCase();
    value = value.replace(/\s+so had to switch.*$/i, '').replace(/\s+/g, ' ').trim();
    if (value) {
      facts.push({ key: 'intended_course', value, confidence: courseKnown ? 0.92 : 0.8 });
      if (/anatomy|medicine|surgery|nursing|physio|biology|biochem|microbio/.test(value)) {
        facts.push({ key: 'subject_interest', value: 'biology', confidence: 0.85 });
      }
    }
  }

  const school = text.match(/\b(?:in|at)\s+([A-Z][A-Za-z\s]{2,40}(?:University|Polytechnic|College|Secondary|School))/);
  if (school) {
    facts.push({ key: 'target_school', value: school[1].trim(), confidence: 0.85 });
  }

  if (/\b(jamb|waec|neco|utme)\b/i.test(text)) {
    const exam = (text.match(/\b(jamb|waec|neco|utme)\b/i) || [])[1];
    if (exam) facts.push({ key: 'exam_type', value: exam.toUpperCase(), confidence: 0.8 });
  }

  const score = text.match(/\b(?:got|scored|score)\s+(\d{2,3})\s+in\s+(jamb|waec|neco|utme)\b/i)
    || text.match(/\b(\d{2,3})\s+in\s+(jamb|waec|neco|utme)\b/i);
  if (score) {
    facts.push({ key: `${score[2].toLowerCase()}_score`, value: score[1], confidence: 0.9 });
  }

  if (/\bfoundation\s+is\s+poor\b/i.test(text) || /\bdid\s+not\s+do\s+ss\s*3\b/i.test(text) || /\bdidn'?t\s+do\s+ss\s*3\b/i.test(text)) {
    facts.push({ key: 'foundation_level', value: 'poor', confidence: 0.9 });
  }

  if (/\bhave\s+not\s+been\s+reading\b/i.test(text) || /\bhaven'?t\s+(been\s+)?reading\b/i.test(text)) {
    facts.push({ key: 'study_habit', value: 'not_reading_recently', confidence: 0.8 });
  }

  if (/\bscience\s+student\b/i.test(text)) {
    facts.push({ key: 'track', value: 'science', confidence: 0.85 });
  }

  // de-dupe by key (last wins)
  const map = new Map<string, Extracted>();
  for (const f of facts) map.set(f.key, f);
  return [...map.values()];
}

export async function applyInstantFacts(studentId: string, message: string): Promise<void> {
  const facts = extractInstantFacts(message);
  if (facts.length === 0) return;
  try {
    await upsertStudentFacts(
      studentId,
      facts.map(f => ({ key: f.key, value: f.value, confidence: f.confidence }))
    );
  } catch (err) {
    logger.debug({ err }, '[InstantFacts] upsert failed');
  }
}
