// Semantic memory: what the tutor knows about the student as facts and relationships.
// Stored as JSON in PostgreSQL.
// This is the tutor's "private notebook" — never shown to the student.
// The AI edits its own memory blocks through structured tool calls.

import { db } from "../db/client";
import type { StudentProfile } from "../types/student";

type MemoryBlock = keyof StudentProfile["memoryBlocks"];
type MemoryOperation = "append" | "replace" | "delete";

const DEFAULT_MEMORY_BLOCKS: StudentProfile["memoryBlocks"] = {
  humanProfile:
    "New student. Nothing known yet. Observe carefully. Listen more than talk.",
  learningStyle:
    "Learning style unknown. Watch for what makes them curious and what makes them quiet.",
  progress:
    "No concepts covered yet. Start wherever they start.",
  shameMap:
    "Shame triggers unknown. Watch for hedging language, silence, self-deprecation.",
  curiosityMap:
    "Curiosity hooks unknown. Watch for follow-up questions and increased message length.",
  procedural:
    "No special procedures established yet. Be warm, patient, and follow their lead.",
};

export async function getStudentProfile(studentId: string): Promise<StudentProfile> {
  const result = await db.query(
    `SELECT * FROM student_profiles WHERE student_id = $1`,
    [studentId]
  );

  if (result.rows.length === 0) {
    // First time we see this student — create their profile
    await db.query(
      `INSERT INTO student_profiles (student_id, memory_blocks)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [studentId, JSON.stringify(DEFAULT_MEMORY_BLOCKS)]
    );

    return createDefaultProfile(studentId);
  }

  const row = result.rows[0];
  return {
    studentId: row.student_id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    inferredExamTargets: [],
    learningStyle: {
      prefersAnalogies: false,
      analogyDomains: [],
      prefersVisualDescriptions: false,
      prefersMath: false,
      prefersStoryForm: false,
      toleratesAbstraction: 0.5,
    },
    emotionalProfile: {
      shameThreshold: 0.5,
      curiosityLevel: 0.5,
      frustrationTolerance: 0.5,
      prideIntelligence: false,
      respondsToHumor: false,
    },
    conceptProgress: row.concept_progress || {},
    memoryBlocks: {
      ...DEFAULT_MEMORY_BLOCKS,
      ...(row.memory_blocks || {}),
    },
  };
}

function createDefaultProfile(studentId: string): StudentProfile {
  return {
    studentId,
    createdAt: new Date(),
    lastSeenAt: new Date(),
    inferredExamTargets: [],
    learningStyle: {
      prefersAnalogies: false,
      analogyDomains: [],
      prefersVisualDescriptions: false,
      prefersMath: false,
      prefersStoryForm: false,
      toleratesAbstraction: 0.5,
    },
    emotionalProfile: {
      shameThreshold: 0.5,
      curiosityLevel: 0.5,
      frustrationTolerance: 0.5,
      prideIntelligence: false,
      respondsToHumor: false,
    },
    conceptProgress: {},
    memoryBlocks: { ...DEFAULT_MEMORY_BLOCKS },
  };
}

// The AI calls this after each turn to update what it knows
export async function applyMemoryEdit(
  studentId: string,
  block: MemoryBlock,
  operation: MemoryOperation,
  content: string
): Promise<void> {
  const profile = await getStudentProfile(studentId);
  const currentBlocks = profile.memoryBlocks;

  if (operation === "replace") {
    currentBlocks[block] = content;
  } else if (operation === "append") {
    const existing = currentBlocks[block];
    currentBlocks[block] = existing
      ? `${existing}\n\nUpdate: ${content}`
      : content;
  } else if (operation === "delete") {
    currentBlocks[block] = DEFAULT_MEMORY_BLOCKS[block];
  }

  await db.query(
    `UPDATE student_profiles
     SET memory_blocks = $1, last_seen_at = NOW()
     WHERE student_id = $2`,
    [JSON.stringify(currentBlocks), studentId]
  );
}

export async function updateLastSeen(studentId: string): Promise<void> {
  await db.query(
    `INSERT INTO student_profiles (student_id, memory_blocks)
     VALUES ($1, $2)
     ON CONFLICT (student_id) DO UPDATE SET last_seen_at = NOW()`,
    [studentId, JSON.stringify(DEFAULT_MEMORY_BLOCKS)]
  );
}