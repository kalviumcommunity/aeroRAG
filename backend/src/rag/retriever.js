import { generateEmbedding } from './embedder.js';
import { querySimilar } from './vectorStore.js';

export const retrieve = async (query, topK = 5) => {
  const queryEmbedding = await generateEmbedding(query);
  const results = await querySimilar(queryEmbedding, topK * 2); // Get more to filter
  
  // Prefer CURRENT status documents
  let processedResults = results.map(r => {
    let boost = r.metadata.status === 'CURRENT' ? 0.2 : 0;
    // Note: If using Chroma distance, we'd need to subtract. Let's assume we sort by our custom logic anyway.
    return { ...r, finalScore: r.score + boost };
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

  // Re-sort and slice to topK
  processedResults.sort((a, b) => b.finalScore - a.finalScore);
  return processedResults.slice(0, topK);
};
