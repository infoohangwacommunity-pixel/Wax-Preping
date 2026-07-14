import axios from 'axios';
import { logger } from '../middleware/logger';

const EMBEDDING_DIM = 384;

export async function embed(text: string): Promise<number[]> {
  const hfKey = process.env.HF_API_KEY;

  if (hfKey) {
    try {
      const response = await axios.post(
        'https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2',
        { inputs: text, options: { wait_for_model: true } },
        {
          headers: { Authorization: `Bearer ${hfKey}` },
          timeout: 15_000,
        }
      );

      const data = response.data;
      if (Array.isArray(data) && Array.isArray(data[0])) {
        return data[0] as number[];
      }
      if (Array.isArray(data)) {
        return data as number[];
      }
    } catch (err) {
      logger.warn('[Embeddings] HuggingFace failed — using fallback');
    }
  }

  // Deterministic fallback — better than random, consistent across calls
  return deterministicEmbed(text);
}

function deterministicEmbed(text: string): number[] {
  const vector = new Array(EMBEDDING_DIM).fill(0);
  const normalized = text.toLowerCase().trim();

  for (let i = 0; i < normalized.length; i++) {
    const charCode = normalized.charCodeAt(i);
    const positions = [
      i % EMBEDDING_DIM,
      (i * 3) % EMBEDDING_DIM,
      (i * 7 + charCode) % EMBEDDING_DIM,
    ];
    for (const pos of positions) {
      vector[pos] = (vector[pos] + Math.sin(charCode * (pos + 1))) / 2;
    }
  }

  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map(v => v / magnitude);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
}