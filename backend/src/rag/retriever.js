import { generateEmbedding } from './embedder.js';
import { querySimilar } from './vectorStore.js';
import config from '../config/env.js';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'at', 'be', 'by', 'does', 'for', 'from', 'how', 'i',
  'in', 'is', 'it', 'of', 'on', 'or', 'the', 'to', 'was', 'what', 'when', 'where',
  'which', 'who', 'why', 'with'
]);

function lexicalOverlap(query, result) {
  const queryTerms = new Set(
    query.toLowerCase().match(/[a-z0-9]+/g)?.filter(term => term.length > 2 && !STOP_WORDS.has(term)) ?? []
  );
  if (queryTerms.size === 0) return 0;
  const content = result.document
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
  const results = await querySimilar(queryEmbedding, topK * 2); // Get more to filter
  
  // Prefer CURRENT status documents
  let processedResults = results.map(r => {
    const status = r.metadata.status;
    const boost = status === 'CURRENT' ? 0.2 : 0;
    // Note: If using Chroma distance, we'd need to subtract. Let's assume we sort by our custom logic anyway.
    const documentId = r.metadata.documentId ?? r.metadata.source;
    return {
      ...r,
      metadata: { ...r.metadata, documentId },
      finalScore: r.score + boost,
      lexicalScore: config.DEMO_MODE ? lexicalOverlap(query, r) : null
    };
  });

  // Filter out SUPERSEDED if a CURRENT doc explicitly supersedes it and is in the result set
  const currentDocs = processedResults.filter(r => r.metadata.status === 'CURRENT');
  const supersedingIds = currentDocs.flatMap(r => r.metadata.supersedes ? r.metadata.supersedes.split(',') : []);
  
  processedResults = processedResults.filter(r => {
    if (r.metadata.status === 'SUPERSEDED' && supersedingIds.includes(r.metadata.documentId)) {
      return false; // Skip it
    }
    return true;
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
