import { retrieve } from './retriever.js';
import { generateAnswer } from './llm.js';
import config from '../config/env.js';

export const runRagPipeline = async (query, options = {}) => {
  // 1 & 2. Embed and Retrieve
  const retrievedChunks = await retrieve(query, 5);

  // 3 & 4. Call LLM with generation parameters
  const answer = await generateAnswer(query, retrievedChunks, options);

  // 5. Build sources array
  const sourcesMap = new Map();
  retrievedChunks.forEach(chunk => {
    const m = chunk.metadata;
    if (!sourcesMap.has(m.documentId)) {
      sourcesMap.set(m.documentId, {
        documentId: m.documentId,
        title: m.documentTitle,
        effectiveDate: m.effectiveDate,
        status: m.status
      });
    }
  });

  return {
    answer,
    sources: Array.from(sourcesMap.values()),
    retrievedChunks: retrievedChunks.length,
    confidence: 0.9, // mock confidence
    demoMode: config.DEMO_MODE,
    generationOptions: options
  };
};
