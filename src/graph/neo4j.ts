/**
 * WaxPrep v3.0 — Neo4j Graph Adapter
 * Implements the GraphAdapter interface for Neo4j.
 * This is a STUB with full interface compliance. When NEO4J_URI is set,
 * swap the factory to use this adapter. All business logic remains unchanged.
 */

import type { GraphAdapter } from './interfaces';
import type {
  GraphNode,
  GraphEdge,
  GraphPath,
  NodeCreateInput,
  EdgeCreateInput,
  TraversalOptions,
  SimilaritySearchOptions,
  BiTemporalQueryOptions,
} from './types';
import { logger } from '../middleware/logger';

export class Neo4jGraphAdapter implements GraphAdapter {
  readonly name = 'neo4j';
  private driver: unknown | null = null;
  private connected = false;

  async connect(): Promise<void> {
    try {
      // Dynamic import to avoid bundling neo4j-driver when not used
      const neo4j = await import('neo4j-driver');
      const uri = process.env.NEO4J_URI;
      const user = process.env.NEO4J_USER || 'neo4j';
      const password = process.env.NEO4J_PASSWORD;

      if (!uri) {
        throw new Error('NEO4J_URI not configured');
      }

      this.driver = neo4j.default.driver(uri, neo4j.default.auth.basic(user, password));
      await (this.driver as { verifyConnectivity: () => Promise<unknown> }).verifyConnectivity();
      this.connected = true;
      logger.info('[Neo4jGraph] Connected');
    } catch (err) {
      logger.error({ err }, '[Neo4jGraph] Connection failed');
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.driver) {
      await (this.driver as { close: () => Promise<void> }).close();
      this.connected = false;
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.connected || !this.driver) return false;
    try {
      const session = (this.driver as { session: () => unknown }).session();
      await (session as { run: (q: string) => Promise<unknown> }).run('RETURN 1');
      await (session as { close: () => Promise<void> }).close();
      return true;
    } catch {
      return false;
    }
  }

  async createNode(input: NodeCreateInput): Promise<GraphNode> {
    if (!this.driver) throw new Error('Neo4j not connected');
    const labels = input.labels.join(':');
    const session = (this.driver as { session: () => unknown }).session();
    try {
      const result = await (session as { run: (q: string, p: Record<string, unknown>) => Promise<{ records: Array<{ get: (k: string) => unknown }> }> }).run(
        `CREATE (n:${labels} $props) RETURN n`,
        { props: { ...input.properties, _embedding: input.embedding, _student_id: input.student_id, _source: input.source, _event_time: input.event_time?.toISOString() } }
      );
      const record = result.records[0].get('n') as Record<string, unknown>;
      return this.mapNeo4jNode(record);
    } finally {
      await (session as { close: () => Promise<void> }).close();
    }
  }

  async createNodes(inputs: NodeCreateInput[]): Promise<GraphNode[]> {
    const nodes: GraphNode[] = [];
    for (const input of inputs) {
      nodes.push(await this.createNode(input));
    }
    return nodes;
  }

  async getNode(id: string): Promise<GraphNode | null> {
    if (!this.driver) throw new Error('Neo4j not connected');
    const session = (this.driver as { session: () => unknown }).session();
    try {
      const result = await (session as { run: (q: string, p: Record<string, unknown>) => Promise<{ records: Array<{ get: (k: string) => unknown }> }> }).run(
        `MATCH (n) WHERE n.id = $id RETURN n`,
        { id }
      );
      if (result.records.length === 0) return null;
      return this.mapNeo4jNode(result.records[0].get('n') as Record<string, unknown>);
    } finally {
      await (session as { close: () => Promise<void> }).close();
    }
  }

  async updateNode(id: string, updates: Partial<GraphNode>): Promise<GraphNode> {
    if (!this.driver) throw new Error('Neo4j not connected');
    const session = (this.driver as { session: () => unknown }).session();
    try {
      const setClauses: string[] = [];
      const params: Record<string, unknown> = { id };
      if (updates.properties) {
        setClauses.push('n += $props');
        params.props = updates.properties;
      }
      const result = await (session as { run: (q: string, p: Record<string, unknown>) => Promise<{ records: Array<{ get: (k: string) => unknown }> }> }).run(
        `MATCH (n) WHERE n.id = $id SET ${setClauses.join(', ')} RETURN n`,
        params
      );
      return this.mapNeo4jNode(result.records[0].get('n') as Record<string, unknown>);
    } finally {
      await (session as { close: () => Promise<void> }).close();
    }
  }

  async deleteNode(id: string): Promise<void> {
    if (!this.driver) throw new Error('Neo4j not connected');
    const session = (this.driver as { session: () => unknown }).session();
    try {
      await (session as { run: (q: string, p: Record<string, unknown>) => Promise<unknown> }).run(
        `MATCH (n) WHERE n.id = $id DETACH DELETE n`,
        { id }
      );
    } finally {
      await (session as { close: () => Promise<void> }).close();
    }
  }

  async searchNodes(filters: Record<string, unknown>, limit = 50): Promise<GraphNode[]> {
    if (!this.driver) throw new Error('Neo4j not connected');
    const session = (this.driver as { session: () => unknown }).session();
    try {
      const conditions: string[] = [];
      const params: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(filters)) {
        conditions.push(`n.${key} = $${key}`);
        params[key] = val;
      }
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const result = await (session as { run: (q: string, p: Record<string, unknown>) => Promise<{ records: Array<{ get: (k: string) => unknown }> }> }).run(
        `MATCH (n) ${whereClause} RETURN n LIMIT $limit`,
        { ...params, limit }
      );
      return result.records.map(r => this.mapNeo4jNode(r.get('n') as Record<string, unknown>));
    } finally {
      await (session as { close: () => Promise<void> }).close();
    }
  }

  async createEdge(input: EdgeCreateInput): Promise<GraphEdge> {
    if (!this.driver) throw new Error('Neo4j not connected');
    const session = (this.driver as { session: () => unknown }).session();
    try {
      const result = await (session as { run: (q: string, p: Record<string, unknown>) => Promise<{ records: Array<{ get: (k: string) => unknown }> }> }).run(
        `MATCH (a) WHERE a.id = $sourceId
         MATCH (b) WHERE b.id = $targetId
         CREATE (a)-[r:${input.type} $props]->(b)
         RETURN r, a.id as source_id, b.id as target_id`,
        {
          sourceId: input.source_id,
          targetId: input.target_id,
          props: { ...input.properties, _student_id: input.student_id, _event_time: input.event_time?.toISOString() },
        }
      );
      const record = result.records[0];
      return this.mapNeo4jEdge(record.get('r') as Record<string, unknown>, input.source_id, input.target_id);
    } finally {
      await (session as { close: () => Promise<void> }).close();
    }
  }

  async createEdges(inputs: EdgeCreateInput[]): Promise<GraphEdge[]> {
    const edges: GraphEdge[] = [];
    for (const input of inputs) {
      edges.push(await this.createEdge(input));
    }
    return edges;
  }

  async getEdge(id: string): Promise<GraphEdge | null> {
    if (!this.driver) throw new Error('Neo4j not connected');
    const session = (this.driver as { session: () => unknown }).session();
    try {
      const result = await (session as { run: (q: string, p: Record<string, unknown>) => Promise<{ records: Array<{ get: (k: string) => unknown }> }> }).run(
        `MATCH ()-[r]->() WHERE r._id = $id RETURN r, startNode(r).id as source_id, endNode(r).id as target_id`,
        { id }
      );
      if (result.records.length === 0) return null;
      const record = result.records[0];
      return this.mapNeo4jEdge(
        record.get('r') as Record<string, unknown>,
        record.get('source_id') as string,
        record.get('target_id') as string
      );
    } finally {
      await (session as { close: () => Promise<void> }).close();
    }
  }

  async getEdges(nodeId: string, direction: 'out' | 'in' | 'both', type?: string): Promise<GraphEdge[]> {
    if (!this.driver) throw new Error('Neo4j not connected');
    const session = (this.driver as { session: () => unknown }).session();
    try {
      let query: string;
      if (direction === 'out') {
        query = `MATCH (n)-[r${type ? `:${type}` : ''}]->(m) WHERE n.id = $id RETURN r, n.id as source_id, m.id as target_id`;
      } else if (direction === 'in') {
        query = `MATCH (n)<-[r${type ? `:${type}` : ''}]-(m) WHERE n.id = $id RETURN r, m.id as source_id, n.id as target_id`;
      } else {
        query = `MATCH (n)-[r${type ? `:${type}` : ''}]-(m) WHERE n.id = $id RETURN r, 
          CASE WHEN startNode(r).id = n.id THEN m.id ELSE startNode(r).id END as source_id,
          CASE WHEN endNode(r).id = n.id THEN m.id ELSE endNode(r).id END as target_id`;
      }
      const result = await (session as { run: (q: string, p: Record<string, unknown>) => Promise<{ records: Array<{ get: (k: string) => unknown }> }> }).run(query, { id: nodeId });
      return result.records.map(r =>
        this.mapNeo4jEdge(r.get('r') as Record<string, unknown>, r.get('source_id') as string, r.get('target_id') as string)
      );
    } finally {
      await (session as { close: () => Promise<void> }).close();
    }
  }

  async updateEdge(id: string, updates: Partial<GraphEdge>): Promise<GraphEdge> {
    if (!this.driver) throw new Error('Neo4j not connected');
    const session = (this.driver as { session: () => unknown }).session();
    try {
      const result = await (session as { run: (q: string, p: Record<string, unknown>) => Promise<{ records: Array<{ get: (k: string) => unknown }> }> }).run(
        `MATCH ()-[r]->() WHERE r._id = $id SET r += $props RETURN r, startNode(r).id as source_id, endNode(r).id as target_id`,
        { id, props: updates.properties || {} }
      );
      const record = result.records[0];
      return this.mapNeo4jEdge(record.get('r') as Record<string, unknown>, record.get('source_id') as string, record.get('target_id') as string);
    } finally {
      await (session as { close: () => Promise<void> }).close();
    }
  }

  async invalidateEdge(id: string, reason?: string): Promise<void> {
    if (!this.driver) throw new Error('Neo4j not connected');
    const session = (this.driver as { session: () => unknown }).session();
    try {
      await (session as { run: (q: string, p: Record<string, unknown>) => Promise<unknown> }).run(
        `MATCH ()-[r]->() WHERE r._id = $id SET r._invalidated = true, r._invalidation_reason = $reason`,
        { id, reason: reason || 'superseded' }
      );
    } finally {
      await (session as { close: () => Promise<void> }).close();
    }
  }

  async deleteEdge(id: string): Promise<void> {
    if (!this.driver) throw new Error('Neo4j not connected');
    const session = (this.driver as { session: () => unknown }).session();
    try {
      await (session as { run: (q: string, p: Record<string, unknown>) => Promise<unknown> }).run(
        `MATCH ()-[r]->() WHERE r._id = $id DELETE r`,
        { id }
      );
    } finally {
      await (session as { close: () => Promise<void> }).close();
    }
  }

  async traverse(startNodeId: string, options: TraversalOptions): Promise<GraphPath[]> {
    if (!this.driver) throw new Error('Neo4j not connected');
    const { edgeTypes = [], maxDepth = 3, direction = 'out' } = options;
    const session = (this.driver as { session: () => unknown }).session();
    try {
      const typeFilter = edgeTypes.length > 0 ? `:${edgeTypes.join('|')}` : '';
      let relPattern: string;
      if (direction === 'out') relPattern = `-[r${typeFilter}*1..${maxDepth}]->`;
      else if (direction === 'in') relPattern = `<-[r${typeFilter}*1..${maxDepth}]-`;
      else relPattern = `-[r${typeFilter}*1..${maxDepth}]-`;

      const result = await (session as { run: (q: string, p: Record<string, unknown>) => Promise<{ records: Array<{ get: (k: string) => unknown }> }> }).run(
        `MATCH path = (start)${relPattern}(end)
         WHERE start.id = $id
         RETURN path
         LIMIT 100`,
        { id: startNodeId }
      );

      return result.records.map(r => {
        const path = r.get('path') as unknown as {
          segments: Array<{
            start: Record<string, unknown>;
            relationship: Record<string, unknown>;
            end: Record<string, unknown>;
          }>;
        };
        const nodes: GraphNode[] = [];
        const edges: GraphEdge[] = [];
        for (const seg of path.segments) {
          if (nodes.length === 0) nodes.push(this.mapNeo4jNode(seg.start));
          nodes.push(this.mapNeo4jNode(seg.end));
          edges.push(this.mapNeo4jEdge(seg.relationship, '', ''));
        }
        return { nodes, edges, length: edges.length };
      });
    } finally {
      await (session as { close: () => Promise<void> }).close();
    }
  }

  async shortestPath(startNodeId: string, endNodeId: string, edgeTypes?: string[]): Promise<GraphPath | null> {
    if (!this.driver) throw new Error('Neo4j not connected');
    const session = (this.driver as { session: () => unknown }).session();
    try {
      const typeFilter = edgeTypes && edgeTypes.length > 0 ? `:${edgeTypes.join('|')}` : '';
      const result = await (session as { run: (q: string, p: Record<string, unknown>) => Promise<{ records: Array<{ get: (k: string) => unknown }> }> }).run(
        `MATCH path = shortestPath((a)${typeFilter.length > 0 ? `-[${typeFilter}*]-` : '-[*]-'}(b))
         WHERE a.id = $startId AND b.id = $endId
         RETURN path`,
        { startId: startNodeId, endId: endNodeId }
      );
      if (result.records.length === 0) return null;
      const path = result.records[0].get('path') as unknown as {
        segments: Array<{
          start: Record<string, unknown>;
          relationship: Record<string, unknown>;
          end: Record<string, unknown>;
        }>;
      };
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];
      for (const seg of path.segments) {
        if (nodes.length === 0) nodes.push(this.mapNeo4jNode(seg.start));
        nodes.push(this.mapNeo4jNode(seg.end));
        edges.push(this.mapNeo4jEdge(seg.relationship, '', ''));
      }
      return { nodes, edges, length: edges.length };
    } finally {
      await (session as { close: () => Promise<void> }).close();
    }
  }

  async findSimilar(options: SimilaritySearchOptions): Promise<GraphNode[]> {
    logger.warn('[Neo4jGraph] Vector similarity search requires GDS plugin. Falling back to label filter.');
    return this.searchNodes({ student_id: options.studentId }, options.limit);
  }

  async queryBiTemporal(options: BiTemporalQueryOptions): Promise<GraphNode[]> {
    if (!this.driver) throw new Error('Neo4j not connected');
    const session = (this.driver as { session: () => unknown }).session();
    try {
      const result = await (session as { run: (q: string, p: Record<string, unknown>) => Promise<{ records: Array<{ get: (k: string) => unknown }> }> }).run(
        `MATCH (n:${options.nodeLabel})
         WHERE n._student_id = $studentId
           AND n._event_time <= $atTime
           AND (n._valid_to IS NULL OR n._valid_to >= $atTime)
         RETURN n
         ORDER BY n._event_time DESC`,
        { studentId: options.studentId, atTime: options.atTime.toISOString() }
      );
      return result.records.map(r => this.mapNeo4jNode(r.get('n') as Record<string, unknown>));
    } finally {
      await (session as { close: () => Promise<void> }).close();
    }
  }

  async executeBatch<T>(operations: Array<() => Promise<T>>): Promise<T[]> {
    if (!this.driver) throw new Error('Neo4j not connected');
    const session = (this.driver as { session: () => unknown }).session();
    try {
      const results: T[] = [];
      for (const op of operations) {
        results.push(await op());
      }
      return results;
    } finally {
      await (session as { close: () => Promise<void> }).close();
    }
  }

  private mapNeo4jNode(record: Record<string, unknown>): GraphNode {
    const props = (record.properties || record) as Record<string, unknown>;
    return {
      id: (props.id || props._id || 'unknown') as string,
      labels: (record.labels || ['Node']) as string[],
      properties: props,
      embedding: props._embedding as number[] | undefined,
      event_time: new Date((props._event_time as string) || Date.now()),
      ingest_time: new Date((props._ingest_time as string) || Date.now()),
      student_id: (props._student_id as string) || undefined,
      source: (props._source as string) || undefined,
      created_at: new Date((props._created_at as string) || Date.now()),
    };
  }

  private mapNeo4jEdge(record: Record<string, unknown>, sourceId: string, targetId: string): GraphEdge {
    const props = (record.properties || record) as Record<string, unknown>;
    return {
      id: (props._id || props.id || 'unknown') as string,
      source_id: sourceId,
      target_id: targetId,
      type: (props.type || record.type || 'RELATED') as string,
      properties: props,
      event_time: new Date((props._event_time as string) || Date.now()),
      ingest_time: new Date((props._ingest_time as string) || Date.now()),
      student_id: (props._student_id as string) || undefined,
      created_at: new Date((props._created_at as string) || Date.now()),
    };
  }
}