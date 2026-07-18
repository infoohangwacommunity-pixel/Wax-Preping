/**
 * WaxPrep v3.0 — Graph Migration Service
 * Migrates existing relational data into the cognitive graph.
 * Idempotent: safe to run multiple times.
 */

import { db } from '../db/client';
import { getGraphAdapter } from './factory';
import { logger } from '../middleware/logger';
import type { GraphAdapter } from './interfaces';

export async function migrateExistingDataToGraph(): Promise<{
  episodesMigrated: number;
  factsMigrated: number;
  conceptsMigrated: number;
  edgesCreated: number;
}> {
  const graph = await getGraphAdapter();
  let episodesMigrated = 0;
  let factsMigrated = 0;
  let conceptsMigrated = 0;
  let edgesCreated = 0;

  logger.info('[GraphMigrator] Starting migration...');

  // ===========================================================================
  // MIGRATE CONVERSATION TURNS -> Episode nodes
  // ===========================================================================
  const turnsResult = await db.query(`
    SELECT * FROM conversation_turns 
    WHERE NOT EXISTS (
      SELECT 1 FROM cognitive_graph_references 
      WHERE table_name = 'conversation_turns' AND row_id = conversation_turns.turn_id
    )
    ORDER BY timestamp ASC
    LIMIT 5000
  `);

  const episodeNodes: Array<{ nodeId: string; turnId: string; studentId: string; timestamp: Date }> = [];

  for (const turn of turnsResult.rows) {
    const embedding = turn.embedding
      ? JSON.parse(`[${(turn.embedding as string).slice(1, -1)}]`)
      : undefined;

    const node = await graph.createNode({
      labels: ['Episode'],
      properties: {
        turn_id: turn.turn_id,
        student_message: turn.student_message,
        tutor_response: turn.tutor_response,
        topic: turn.topic,
        subject: turn.subject,
        modality: turn.modality,
        mastery_evidenced: turn.mastery_evidenced,
        model_used: turn.model_used,
        latency_ms: turn.latency_ms,
        tokens_in: turn.tokens_in,
        tokens_out: turn.tokens_out,
        cost_usd: turn.cost_usd,
        tools_used: turn.tools_used,
        emotional_valence: turn.emotional_valence,
        cognitive_load_estimate: turn.cognitive_load_estimate,
        is_boundary_turn: turn.is_boundary_turn,
      },
      embedding,
      event_time: new Date(turn.timestamp),
      student_id: turn.student_id,
      source: 'whatsapp',
    });

    await db.query(
      `INSERT INTO cognitive_graph_references (node_id, table_name, row_id)
       VALUES ($1, 'conversation_turns', $2)
       ON CONFLICT DO NOTHING`,
      [node.id, turn.turn_id]
    );

    episodeNodes.push({
      nodeId: node.id,
      turnId: turn.turn_id,
      studentId: turn.student_id,
      timestamp: new Date(turn.timestamp),
    });

    episodesMigrated++;
  }

  // Create EPISODIC_SEQUENTIAL edges between consecutive turns in same session
  const sessionGroups = new Map<string, typeof episodeNodes>();
  for (const ep of episodeNodes) {
    const existing = sessionGroups.get(ep.studentId) || [];
    existing.push(ep);
    sessionGroups.set(ep.studentId, existing);
  }

  for (const [, eps] of sessionGroups) {
    eps.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    for (let i = 1; i < eps.length; i++) {
      await graph.createEdge({
        source_id: eps[i - 1].nodeId,
        target_id: eps[i].nodeId,
        type: 'EPISODIC_SEQUENTIAL',
        properties: { order: i, student_id: eps[i].studentId },
        student_id: eps[i].studentId,
      });
      edgesCreated++;
    }
  }

  logger.info(`[GraphMigrator] Migrated ${episodesMigrated} episodes`);

  // ===========================================================================
  // MIGRATE STUDENT ATTRIBUTES -> Fact nodes
  // ===========================================================================
  const attrsResult = await db.query(`
    SELECT * FROM student_attributes
    WHERE NOT EXISTS (
      SELECT 1 FROM cognitive_graph_references 
      WHERE table_name = 'student_attributes' AND row_id = student_attributes.id::text
    )
    LIMIT 5000
  `);

  for (const attr of attrsResult.rows) {
    const node = await graph.createNode({
      labels: ['Fact'],
      properties: {
        attribute_key: attr.attribute_key,
        attribute_value: attr.attribute_value,
        confidence: attr.confidence,
        category: attr.category,
        evidence_json: attr.evidence_json,
        is_active: attr.is_active,
      },
      event_time: new Date(attr.first_observed),
      validity_window: [new Date(attr.first_observed), attr.is_active ? null : new Date(attr.last_updated)],
      student_id: attr.student_id,
      source: 'attribute_extraction',
    });

    await db.query(
      `INSERT INTO cognitive_graph_references (node_id, table_name, row_id)
       VALUES ($1, 'student_attributes', $2)
       ON CONFLICT DO NOTHING`,
      [node.id, attr.id]
    );

    // Link fact to student
    const studentNodes = await graph.searchNodes({ labels: ['Student'], student_id: attr.student_id }, 1);
    if (studentNodes.length > 0) {
      await graph.createEdge({
        source_id: studentNodes[0].id,
        target_id: node.id,
        type: 'HAS_FACT',
        properties: { confidence: attr.confidence },
        student_id: attr.student_id,
      });
      edgesCreated++;
    }

    factsMigrated++;
  }

  logger.info(`[GraphMigrator] Migrated ${factsMigrated} facts`);

  // ===========================================================================
  // MIGRATE CONCEPT PROGRESS -> Concept nodes
  // ===========================================================================
  const profilesResult = await db.query(`
    SELECT student_id, concept_progress FROM student_profiles
    WHERE concept_progress IS NOT NULL AND jsonb_typeof(concept_progress) = 'object'
  `);

  for (const profile of profilesResult.rows) {
    const progress = profile.concept_progress as Record<string, Record<string, unknown>>;
    for (const [conceptName, conceptData] of Object.entries(progress)) {
      const existing = await graph.searchNodes({
        labels: ['Concept'],
        student_id: profile.student_id,
        name: conceptName,
      }, 1);

      if (existing.length > 0) continue; // Already migrated

      const node = await graph.createNode({
        labels: ['Concept'],
        properties: {
          name: conceptName,
          subject: conceptData.subject || 'General',
          mastery_estimate: conceptData.masteryLevel || 0.1,
          bloom_level: conceptData.bloomLevel || 'remember',
          success_count: conceptData.successCount || 0,
          attempt_count: conceptData.attemptCount || 0,
          misconceptions: conceptData.misconceptions || [],
        },
        student_id: profile.student_id,
        source: 'bkt_migration',
      });

      // Link student to concept
      const studentNodes = await graph.searchNodes({ labels: ['Student'], student_id: profile.student_id }, 1);
      if (studentNodes.length > 0) {
        await graph.createEdge({
          source_id: studentNodes[0].id,
          target_id: node.id,
          type: 'HAS_MASTERY',
          properties: {
            probability: conceptData.masteryLevel || 0.1,
            updated_at: (conceptData.lastPracticed as string) || new Date().toISOString(),
          },
          student_id: profile.student_id,
        });
        edgesCreated++;
      }

      conceptsMigrated++;
    }
  }

  logger.info(`[GraphMigrator] Migrated ${conceptsMigrated} concepts`);

  logger.info('[GraphMigrator] Migration complete');
  return { episodesMigrated, factsMigrated, conceptsMigrated, edgesCreated };
}

export async function ensureStudentGraphNode(studentId: string): Promise<void> {
  const graph = await getGraphAdapter();
  const existing = await graph.searchNodes({ labels: ['Student'], student_id: studentId }, 1);
  if (existing.length === 0) {
    await graph.createNode({
      labels: ['Student'],
      properties: { student_id: studentId },
      student_id: studentId,
      source: 'system',
    });
    logger.info(`[GraphMigrator] Created Student node for ${studentId}`);
  }
}