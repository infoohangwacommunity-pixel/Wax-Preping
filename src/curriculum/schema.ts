/**
 * Curriculum Intelligence — domain types.
 *
 * Content is NEVER hard-coded in TypeScript subject maps.
 * It lives in versioned curriculum packs (JSON) + Postgres tables,
 * loaded via the ingestion pipeline.
 *
 * Research basis:
 * - ITS knowledge graphs / prerequisite structures
 * - Competency-based education mapping
 * - Mastery learning sequencing
 * - Nigerian exam boards (WAEC / NECO / JAMB / NERDC structure) as metadata tags
 */

export type ExamBoard = 'WAEC' | 'NECO' | 'JAMB' | 'NERDC' | 'GENERAL';
export type EducationLevel = 'primary' | 'jss' | 'sss' | 'utme' | 'foundation' | 'tertiary_prep';

export interface CurriculumPackMeta {
  packId: string;
  version: string;
  title: string;
  source: string;
  sourceUrl?: string;
  license?: string;
  boards: ExamBoard[];
  levels: EducationLevel[];
  importedAt?: string;
}

export interface CurriculumSubject {
  subjectId: string;
  name: string;
  aliases: string[];
  boards: ExamBoard[];
  levels: EducationLevel[];
}

export interface CurriculumConcept {
  conceptId: string;
  subjectId: string;
  title: string;
  description?: string;
  /** Ordered index within subject path (soft ordering; graph edges are authoritative). */
  sequenceIndex: number;
  difficulty: number; // 0-1
  bloomTarget?: 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
  examTags: ExamBoard[];
  objectives?: string[];
  misconceptions?: string[];
  localHooks?: string[];
  microLesson?: string;
  keywords?: string[];
}

export interface CurriculumEdge {
  fromConceptId: string;
  toConceptId: string;
  relation: 'prerequisite' | 'leads_to' | 'related' | 'review_of';
  weight?: number;
}

export interface CurriculumPack {
  meta: CurriculumPackMeta;
  subjects: CurriculumSubject[];
  concepts: CurriculumConcept[];
  edges: CurriculumEdge[];
}

export interface ConceptMasteryView {
  conceptId: string;
  masteryLevel: number;
  attemptCount?: number;
  lastPracticed?: string | Date | null;
}

export interface NavigationResult {
  concept: CurriculumConcept;
  reason: string;
  prereqGaps: string[];
  pathPosition: { index: number; total: number };
}
