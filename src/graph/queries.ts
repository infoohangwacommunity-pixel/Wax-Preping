/**
 * WaxPrep v3.0 — Reusable Graph Query Patterns
 * High-level queries that combine multiple graph operations into
 * meaningful tutoring-context retrievals.
 */

import type { GraphAdapter } from './interfaces';
import type { GraphNode, GraphPath } from '../types/cognitive';
import { logger } from '../middleware/logger';

/**
 * Find all episodes related to a concept, ordered by recency.
 */
export async function findConceptEpisodes(
  graph: GraphAdapter,
  studentId: string,
  conceptName: string,
  limit = 10
): Promise<GraphNode[]> {
  const conceptNodes = await graph.searchNodes({
    labels: ['Concept'],
    student_id: studentId,
    name: conceptName,
  }, 1);

  if (conceptNodes.length === 0) return [];

  const episodes = await graph.traverse(conceptNodes[0].id, {
    edgeTypes: ['DISCUSSED', 'HAS_MASTERY', 'EPISODIC_SEQUENTIAL'],
    maxDepth: 2,
    direction: 'both',
  });

  const episodeNodes = episodes
    .flatMap(p => p.nodes)
    .filter(n => n.labels.includes('Episode'))
    .sort((a, b) => b.event_time.getTime() - a.event_time.getTime());

  // Deduplicate by ID
  const seen = new Set<string>();
  return episodeNodes.filter(n => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    return true;
  }).slice(0, limit);
}

/**
 * Find prerequisite gaps: concepts the student has struggled with
 * that are prerequisites for their current concept.
 */
export async function findPrerequisiteGaps(
  graph: GraphAdapter,
  studentId: string,
  currentConcept: string
): Promise<Array<{ concept: GraphNode; mastery: number; lastStruggled: Date | null }>> {
  const conceptNodes = await graph.searchNodes({
    labels: ['Concept'],
    student_id: studentId,
    name: currentConcept,
  }, 1);

  if (conceptNodes.length === 0) return [];

  const prereqs = await graph.traverse(conceptNodes[0].id, {
    edgeTypes: ['PREREQUISITE_FOR'],
    maxDepth: 2,
    direction: 'in',
  });

  const gaps: Array<{ concept: GraphNode; mastery: number; lastStruggled: Date | null }> = [];

  for (const path of prereqs) {
    const prereqNode = path.nodes[path.nodes.length - 1];
    if (!prereqNode.labels.includes('Concept')) continue;

    const masteryEdges = await graph.getEdges(prereqNode.id, 'in', 'HAS_MASTERY');
    const masteryEdge = masteryEdges.find(e => e.properties.student_id === studentId);
    const mastery = (masteryEdge?.properties.probability as number) || 0;

    if (mastery < 0.4) {
      const struggleEpisodes = await graph.traverse(prereqNode.id, {
        edgeTypes: ['DISCUSSED'],
        maxDepth: 1,
        direction: 'both',
      });

      const lastStruggled = struggleEpisodes
        .flatMap(p => p.nodes)
        .filter(n => n.labels.includes('Episode'))
        .sort((a, b) => b.event_time.getTime() - a.event_time.getTime())[0]?.event_time || null;

      gaps.push({ concept: prereqNode, mastery, lastStruggled });
    }
  }

  return gaps;
}

/**
 * Find mistake patterns: repeated errors across different contexts.
 */
export async function findMistakePatterns(
  graph: GraphAdapter,
  studentId: string,
  limit = 5
): Promise<Array<{ pattern: string; count: number; contexts: string[] }>> {
  const errorNodes = await graph.searchNodes({
    labels: ['Episode'],
    student_id: studentId,
    has_error: true,
  }, 100);

  const patterns = new Map<string, { count: number; contexts: Set<string> }>();

  for (const node of errorNodes) {
    const errorType = node.properties.error_type as string;
    const context = node.properties.topic as string;
    if (!errorType) continue;

    const existing = patterns.get(errorType) || { count: 0, contexts: new Set<string>() };
    existing.count++;
    if (context) existing.contexts.add(context);
    patterns.set(errorType, existing);
  }

  return Array.from(patterns.entries())
    .filter(([, data]) => data.count >= 2)
    .map(([pattern, data]) => ({
      pattern,
      count: data.count,
      contexts: Array.from(data.contexts),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Find the student's emotional trajectory over recent sessions.
 */
export async function findEmotionalTrajectory(
  graph: GraphAdapter,
  studentId: string,
  sessionCount = 5
): Promise<Array<{ timestamp: Date; valence: number; arousal: number; frustration: number; concept: string }>> {
  const stateNodes = await graph.searchNodes({
    labels: ['State'],
    student_id: studentId,
  }, sessionCount * 3);

  return stateNodes
    .filter(n => n.properties.valence !== undefined)
    .sort((a, b) => b.event_time.getTime() - a.event_time.getTime())
    .slice(0, sessionCount * 3)
    .map(n => ({
      timestamp: n.event_time,
      valence: (n.properties.valence as number) || 0,
      arousal: (n.properties.arousal as number) || 0,
      frustration: (n.properties.frustration_level as number) || 0,
      concept: (n.properties.current_concept as string) || 'unknown',
    }));
}

/**
 * Find breakthrough moments: episodes with high positive emotional valence
 * and mastery evidence.
 */
export async function findBreakthroughs(
  graph: GraphAdapter,
  studentId: string,
  limit = 5
): Promise<GraphNode[]> {
  const episodes = await graph.searchNodes({
    labels: ['Episode'],
    student_id: studentId,
    mastery_evidenced: true,
  }, 50);

  return episodes
    .filter(n => (n.properties.emotional_valence as number) > 0.5)
    .sort((a, b) => b.event_time.getTime() - a.event_time.getTime())
    .slice(0, limit);
}

/**
 * Get the full learning path for a concept: from first encounter to current state.
 */
export async function getConceptLearningPath(
  graph: GraphAdapter,
  studentId: string,
  conceptName: string
): Promise<GraphPath | null> {
  const conceptNodes = await graph.searchNodes({
    labels: ['Concept'],
    student_id: studentId,
    name: conceptName,
  }, 1);

  if (conceptNodes.length === 0) return null;

  // Find first episode mentioning this concept
  const firstEpisodes = await graph.traverse(conceptNodes[0].id, {
    edgeTypes: ['DISCUSSED'],
    maxDepth: 1,
    direction: 'both',
  });

  const firstEpisode = firstEpisodes
    .flatMap(p => p.nodes)
    .filter(n => n.labels.includes('Episode'))
    .sort((a, b) => a.event_time.getTime() - b.event_time.getTime())[0];

  if (!firstEpisode) return null;

  // Trace forward from first episode
  const paths = await graph.traverse(firstEpisode.id, {
    edgeTypes: ['EPISODIC_SEQUENTIAL', 'DISCUSSED', 'HAS_MASTERY'],
    maxDepth: 10,
    direction: 'out',
  });

  // Find the path that reaches the concept node
  return paths.find(p => p.nodes.some(n => n.id === conceptNodes[0].id)) || paths[0] || null;
}
