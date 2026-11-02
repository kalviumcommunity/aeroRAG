import { generateEmbedding } from './embedder.js';
import { querySimilar } from './vectorStore.js';
import config from '../config/env.js';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'at', 'be', 'by', 'does', 'for', 'from', 'how', 'i',
  'in', 'is', 'it', 'of', 'on', 'or', 'the', 'to', 'was', 'what', 'when', 'where',
  'which', 'who', 'why', 'with'
]);

export function lexicalOverlap(query, result) {
  const queryTerms = new Set(
    query.toLowerCase().match(/[a-z0-9]+/g)?.filter(term => term.length > 2 && !STOP_WORDS.has(term)) ?? []
  );
  if (queryTerms.size === 0) return 0;
  const content = (result.document || '')
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? [];
  const contentTerms = new Set(content);
  let matches = 0;
  for (const term of queryTerms) {
    if (contentTerms.has(term)) matches++;
  }
  return matches / queryTerms.size;
}

export const retrieve = async (query, topK = 5) => {
  const queryEmbedding = await generateEmbedding(query);
  const results = await querySimilar(queryEmbedding, Math.max(topK * 2, 10));

  // Score adjustments: boost CURRENT/APPROVED docs, slightly discount SUPERSEDED/EXPIRED
  let processedResults = results.map(r => {
    const status = (r.metadata.status || 'UNKNOWN').toUpperCase();
    let statusWeight = 0;
    if (status === 'CURRENT' || status === 'APPROVED' || status === 'ACTIVE') {
      statusWeight = 0.2;
    } else if (status === 'SUPERSEDED') {
      statusWeight = -0.05;
    } else if (status === 'EXPIRED') {
      statusWeight = -0.1;
    }

    const documentId = r.metadata.documentId ?? r.metadata.source;
    return {
      ...r,
      metadata: { ...r.metadata, documentId, status },
      finalScore: (r.score || 0) + statusWeight,
      lexicalScore: config.DEMO_MODE ? lexicalOverlap(query, r) : null
    };
  });

  if (config.DEMO_MODE) {
    processedResults = processedResults.filter(result => result.lexicalScore > 0);
    processedResults.sort((a, b) => b.lexicalScore - a.lexicalScore || b.finalScore - a.finalScore);
    return processedResults.slice(0, topK);
  }

  // Re-sort and slice to topK
  processedResults.sort((a, b) => b.finalScore - a.finalScore);
  return processedResults.slice(0, topK);
};
